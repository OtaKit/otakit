import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const IGNORED = ['node_modules/**', '.next/**'];
const DATABASE_TESTS = ['**/*.integration.test.ts', 'lib/mcp/oauth-schema.test.ts'];

export default defineConfig({
  resolve: {
    alias: {
      '@': packageRoot,
    },
  },
  test: {
    environment: 'node',
    env: {
      BETTER_AUTH_URL: 'https://console.example',
      NEXT_PUBLIC_APP_URL: 'https://console.example',
    },
    restoreMocks: true,
    // Include lists live in the projects: extended lists would be merged.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['**/*.test.ts'],
          exclude: [...IGNORED, ...DATABASE_TESTS],
        },
      },
      {
        // These share one PostgreSQL database and some read it whole (due
        // notification deliveries, config files to repair), so they run one
        // file at a time.
        extends: true,
        test: {
          name: 'database',
          include: DATABASE_TESTS,
          exclude: IGNORED,
          fileParallelism: false,
        },
      },
    ],
  },
});
