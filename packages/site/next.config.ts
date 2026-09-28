import path from 'node:path';
import type { NextConfig } from 'next';

const repoRoot = path.join(__dirname, '../..');

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
  async redirects() {
    return [
      // The AI agents landing page was folded into the blog and docs (2026-09-28).
      {
        source: '/ai-agents',
        destination: '/blog/claude-code-capacitor-releases',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
