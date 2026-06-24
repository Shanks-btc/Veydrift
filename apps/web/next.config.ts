import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@veydrift/shared"],
  webpack: (config) => {
    // Allow TypeScript ESM packages to use .js extension aliases in imports.
    // Next.js webpack doesn't resolve .js → .ts automatically for transpilePackages.
    config.resolve ??= {};
    config.resolve.extensionAlias ??= {};
    config.resolve.extensionAlias[".js"] = [".ts", ".tsx", ".js"];
    return config;
  },
};

export default nextConfig;
