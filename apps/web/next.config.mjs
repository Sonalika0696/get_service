/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The token and api-client packages ship raw TypeScript (no build step),
  // so Next must transpile them from source.
  transpilePackages: ['@sft/tokens', '@sft/api-client'],
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Barrel-optimise the big libraries so each route compiles only the
    // icons/components it actually imports instead of the whole package.
    // This is the main lever on per-route dev compile time (and prod bundle
    // size): lucide-react alone is ~1k modules if pulled in whole.
    optimizePackageImports: ['lucide-react', 'recharts', 'framer-motion', '@tanstack/react-query'],
  },
};

export default nextConfig;
