import path from 'node:path';
import type { NextConfig } from 'next';

const repoRoot = path.join(__dirname, '../..');

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
