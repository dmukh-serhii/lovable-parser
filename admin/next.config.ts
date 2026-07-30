import type { NextConfig } from "next";
import { config } from "dotenv";
import fs from "fs";
import path from "path";

// Local dev/start only: share the pipeline's root .env (DATABASE_URL,
// ADMIN_DATABASE_URL, CRAWLER_DATABASE_URL). On Cloudflare there is no parent
// .env — env comes from the Worker's secrets/vars instead — so only load it
// when the file actually exists.
const rootEnv = path.join(__dirname, "../.env");
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv });
}

const nextConfig: NextConfig = {
  // Production/verification builds write to a separate output dir so a
  // `next build` / `next start` never clobbers a running `next dev`'s .next
  // (the source of Windows `_buildManifest.js.tmp` ENOENT races).
  //   dev            → .next
  //   PROD_BUILD=1   → .next-prod
  distDir: process.env.PROD_BUILD ? ".next-prod" : ".next",
};

export default nextConfig;
