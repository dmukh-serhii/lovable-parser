import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Fully dynamic app (all routes are force-dynamic, reading Neon live), so no
// incremental/ISR cache override is needed.
export default defineCloudflareConfig({});
