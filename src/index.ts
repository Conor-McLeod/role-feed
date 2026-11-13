import { handleApi } from "./api";
import { enqueueAll, logUnhealthy, pollCompany } from "./poll";
import { getCompany, recordError, recordGaveUp } from "./store";
import type { FetchMessage } from "./types";

const DEAD_LETTER_QUEUE = "role-feed-dlq";

export default {
  async fetch(req, env) {
    // Static assets are served before the Worker runs; only /api/* gets here.
    return handleApi(req, env);
  },

  // Daily cron: report yesterday's problems, then queue one message per company.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const unhealthy = await logUnhealthy(env);
        const queued = await enqueueAll(env);
        console.log({ event: "enqueue", trigger: "cron", queued, unhealthy });
      })(),
    );
  },

  async queue(batch, env) {
    // Retries exhausted: record it on the company and drop the message.
    if (batch.queue === DEAD_LETTER_QUEUE) {
      for (const msg of batch.messages) {
        await recordGaveUp(env.DB, msg.body.key, new Date().toISOString());
        console.error({ event: "poll_gave_up", company: msg.body.key });
        msg.ack();
      }
      return;
    }

    // Fetch queue: one company per invocation (max_batch_size: 1).
    for (const msg of batch.messages) {
      const company = await getCompany(env.DB, msg.body.key);
      if (!company?.enabled) {
        msg.ack(); // paused (or gone) since it was queued
        continue;
      }
      try {
        await pollCompany(env, company);
        msg.ack();
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error({ event: "poll_failed", company: msg.body.key, attempt: msg.attempts, error });
        await recordError(env.DB, msg.body.key, error, new Date().toISOString());
        msg.retry({ delaySeconds: 300 });
      }
    }
  },
} satisfies ExportedHandler<Env, FetchMessage>;
