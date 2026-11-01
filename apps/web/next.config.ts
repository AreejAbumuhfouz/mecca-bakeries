import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mecca/shared'],
  poweredByHeader: false,
};

export default nextConfig;
