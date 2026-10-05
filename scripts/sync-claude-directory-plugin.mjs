#!/usr/bin/env node

/**
 * Refresh the Claude directory plugin (plugins/claude-directory/otakit) from the
 * repository-root plugin: the Agent Skill, the license, and the version.
 * Its .mcp.json (the hosted server) and README are maintained by hand.
 */
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, 'plugins/claude-directory/otakit');

await rm(path.join(PLUGIN, 'skills'), { recursive: true, force: true });
await cp(path.join(ROOT, 'skills'), path.join(PLUGIN, 'skills'), { recursive: true });
await cp(path.join(ROOT, 'LICENSE'), path.join(PLUGIN, 'LICENSE'));

const rootManifest = JSON.parse(
  await readFile(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'),
);
const manifestPath = path.join(PLUGIN, '.claude-plugin/plugin.json');
// Replace only the version so the file keeps its Prettier formatting.
const manifest = await readFile(manifestPath, 'utf8');
await writeFile(
  manifestPath,
  manifest.replace(/"version": "[^"]*"/, `"version": "${rootManifest.version}"`),
);

console.log(`Synced ${path.relative(ROOT, PLUGIN)} to version ${rootManifest.version}.`);
