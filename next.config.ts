import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next build` and `next dev` share ./.next by default, so running a gate build while a dev
  // server is up wipes the directory underneath it and kills the server — it has broken a local
  // preview and failed a push (Playwright then cold-starts its own server and hits the 120s
  // webServer timeout). Setting NEXT_DIST_DIR sends a build to its own directory instead:
  //     NEXT_DIST_DIR=.next-check npm run build
  // Unset everywhere else — including Vercel — so production builds still use .next unchanged.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Short, sayable links to the engineering docs — for conversations where "let me send you the
  // repo path" loses the thread. openeventz.com/guardrails is a URL you can say out loud.
  async redirects() {
    const repo = 'https://github.com/santoshkopanathi/open-eventz/blob/master'
    return [
      { source: '/guardrails', destination: `${repo}/GUARDRAILS.md`, permanent: false },
      { source: '/build-log', destination: `${repo}/BUILD-LOG.md`, permanent: false },
      { source: '/evals', destination: `${repo}/EVALS.md`, permanent: false },
      {
        source: '/backlog',
        destination: 'https://github.com/santoshkopanathi/open-eventz-pm/blob/master/02-product/BACKLOG.md',
        permanent: false,
      },
    ]
  },
};

export default nextConfig;
