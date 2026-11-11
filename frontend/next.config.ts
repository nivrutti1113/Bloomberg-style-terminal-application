import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return [
      {
        source: "/api/company/:path*",
        destination: `${backendUrl}/api/company/:path*`,
      },
      {
        source: "/company/:path*",
        destination: `${backendUrl}/company/:path*`,
      },
      {
        source: "/candles",
        destination: `${backendUrl}/candles`,
      },
      {
        source: "/prices",
        destination: `${backendUrl}/prices`,
      },
      {
        source: "/metrics",
        destination: `${backendUrl}/metrics`,
      },
      {
        source: "/time",
        destination: `${backendUrl}/time`,
      },
      {
        source: "/api/time",
        destination: `${backendUrl}/api/time`,
      },
      {
        source: "/analytics/:path*",
        destination: `${backendUrl}/analytics/:path*`,
      },
    ];
  },
};

export default nextConfig;
