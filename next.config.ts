import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Covers are hotlinked with a plain <img> (not next/image) so OpenNext/Cloudflare
  // does not need to proxy Cover Art Archive or archive.org thumbnail hosts.
  // remotePatterns document the allowed origins if next/image is used later.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "coverartarchive.org" },
      { protocol: "https", hostname: "archive.org" },
    ],
  },
};

export default nextConfig;
