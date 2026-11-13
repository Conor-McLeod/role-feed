import { cloudflare } from "@cloudflare/vite-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// One dev server for both halves: Vite serves the Svelte UI (ui/, entry
// index.html) and the Cloudflare plugin runs the Worker from wrangler.jsonc
// in workerd, with local D1/Queues. `vite build` writes the UI and Worker to
// dist/ plus a generated wrangler.json that `wrangler deploy` picks up.
export default defineConfig({
  plugins: [svelte(), cloudflare()],
  server: { port: 8787 },
});
