import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

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
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    restoreMocks: true,
  },
});
