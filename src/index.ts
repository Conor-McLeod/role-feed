import { handleApi } from "./api";
import { BY_KEY, enqueueAll, pollCompany } from "./poll";
import { recordError } from "./store";
import type { FetchMessage } from "./types";

export default {
  async fetch(req, env) {
    // Static assets are served before the Worker runs; only /api/* gets here.
    return handleApi(req, env);
  },

  // Daily cron: queue one message per company.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(enqueueAll(env).then((n) => console.log(`queued ${n} companies`)));
  },

  // One company per invocation (max_batch_size: 1).
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const company = BY_KEY.get(msg.body.key);
      if (!company) {
        msg.ack(); // removed from companies.json since it was queued
        continue;
      }
      try {
        await pollCompany(env, company);
        msg.ack();
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`${msg.body.key}: ${error}`);
        await recordError(env.DB, msg.body.key, error, new Date().toISOString());
        msg.retry({ delaySeconds: 300 });
      }
    }
  },
} satisfies ExportedHandler<Env, FetchMessage>;
