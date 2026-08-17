import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next build` and `next dev` share ./.next by default, so running a gate build while a dev
  // server is up wipes the directory underneath it and kills the server — it has broken a local
  // preview and failed a push (Playwright then cold-starts its own server and hits the 120s
  // webServer timeout). Setting NEXT_DIST_DIR sends a build to its own directory instead:
  //     NEXT_DIST_DIR=.next-check npm run build
  // Unset everywhere else — including Vercel — so production builds still use .next unchanged.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
