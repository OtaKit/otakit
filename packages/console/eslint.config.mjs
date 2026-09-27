import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Push notifications are an add-on with a hard boundary: only lib/push/** talks to
// @otakit/push-server, and only the push routes use lib/push. Everything else in
// the console stays unaware of push (plans/roadmap-2026-q4/03, "Architecture").
const pushServerImport = {
  group: ['@otakit/push-server', '@otakit/push-server/*'],
  message: 'Only lib/push/** may import @otakit/push-server.',
};
const pushAdapterImport = {
  group: ['@/lib/push', '@/lib/push/*'],
  message: 'Only the push API routes may use lib/push; the UI talks to the HTTP API.',
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'no-restricted-imports': ['error', { patterns: [pushServerImport, pushAdapterImport] }],
    },
  },
  {
    files: ['app/api/**/push/**', 'app/api/cron/push/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [pushServerImport] }],
    },
  },
  {
    files: ['lib/push/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
