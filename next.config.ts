import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    // Imports upload files to a Server Action. Vercel caps request bodies at about 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
  partialPrefetching: true,
  // Conflicts, gaps and the message list moved off /ledger to pages of their own (one page per
  // step). Old links still land in the right place; query values and #fragments carry over.
  async redirects() {
    return [
      { source: "/ledger", has: [{ type: "query", key: "tab", value: "docket" }], destination: "/check", permanent: false },
      { source: "/ledger", has: [{ type: "query", key: "tab", value: "gaps" }], destination: "/check", permanent: false },
      { source: "/ledger", has: [{ type: "query", key: "tab", value: "timeline" }], destination: "/messages", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
