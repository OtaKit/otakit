#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const baseSha = process.env.CI_BASE_SHA?.trim();

if (mode !== 'format' && mode !== 'lint') {
  throw new Error('Usage: node scripts/check-changed-files.mjs <format|lint>');
}
if (!baseSha) {
  throw new Error('CI_BASE_SHA must identify the base commit for changed-file checks');
}

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const changedFiles = execFileSync(
  'git',
  ['diff', '--name-only', '--diff-filter=ACMR', baseSha, 'HEAD'],
  { cwd: ROOT, encoding: 'utf8' },
)
  .split('\n')
  .map((file) => file.trim())
  .filter((file) => file && existsSync(path.join(ROOT, file)));

if (changedFiles.length === 0) {
  console.log('No changed files to check.');
  process.exit(0);
}

if (mode === 'format') {
  run('pnpm', ['exec', 'prettier', '--check', '--ignore-unknown', ...changedFiles]);
  process.exit(0);
}

const lintableExtension = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;
const packageFiles = new Map();

for (const file of changedFiles) {
  if (!lintableExtension.test(file)) continue;
  const match = /^packages\/([^/]+)\/(.+)$/.exec(file);
  if (!match) continue;

  const packageRoot = path.join(ROOT, 'packages', match[1]);
  if (
    !['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'].some((config) =>
      existsSync(path.join(packageRoot, config)),
    )
  ) {
    continue;
  }

  const files = packageFiles.get(packageRoot) ?? [];
  files.push(match[2]);
  packageFiles.set(packageRoot, files);
}

for (const [packageRoot, files] of packageFiles) {
  run('pnpm', ['exec', 'eslint', '--no-warn-ignored', ...files], packageRoot);
}

console.log(`Linted changed files in ${packageFiles.size} workspace packages.`);
