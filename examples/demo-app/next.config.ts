import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  // Capacitor serves from file:// so we need relative paths
  assetPrefix: './',
  // Generate build timestamp at build time
  env: {
    BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
