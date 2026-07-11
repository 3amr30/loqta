import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@loqta/core"],
  images: {
    // Supplier images come from arbitrary domains during MVP.
    // Tighten this once images are re-hosted on Supabase Storage (process-image job).
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
