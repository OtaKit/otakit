#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

await validate();

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Agent Skill, plugin, and MCP registry metadata are consistent.');
}

async function validate() {
  const cliPackage = await readJson('packages/cli/package.json');
  const registry = await readJson('server.json');
  const plugin = await readJson('.codex-plugin/plugin.json');
  const mcp = await readJson('.mcp.json');
  const skillText = await readText('skills/otakit/SKILL.md');

  if (!cliPackage || !registry || !plugin || !mcp || skillText === null) return;

  const frontmatter = parseFrontmatter(skillText);
  expect(frontmatter.name === 'otakit', 'Skill frontmatter name must be `otakit`');
  expect(
    typeof frontmatter.description === 'string' && frontmatter.description.length > 0,
    'Skill frontmatter requires a description',
  );
  expect(
    String(frontmatter.description ?? '').length <= 1024,
    'Skill description must be no longer than 1024 characters',
  );
  expect(frontmatter.license === 'MIT', 'Skill license must match the repository MIT license');

  const referenceLinks = [...skillText.matchAll(/\]\((references\/[^)]+\.md)\)/g)].map(
    (match) => match[1],
  );
  expect(referenceLinks.length === 4, 'SKILL.md must route to exactly four reference files');
  for (const reference of referenceLinks) {
    await expectFile(path.posix.join('skills/otakit', reference));
  }

  const versions = [cliPackage.version, registry.version, plugin.version, frontmatter.version];
  expect(
    versions.every((version) => version === versions[0]),
    `CLI, registry, plugin, and Skill versions must match (found ${versions.join(', ')})`,
  );

  expect(
    cliPackage.mcpName === registry.name,
    'packages/cli/package.json mcpName must match server.json name',
  );
  expect(plugin.name === 'otakit', 'Codex plugin name must be `otakit`');
  expect(plugin.skills === './skills/', 'Codex plugin must use the canonical skills directory');
  expect(plugin.mcpServers === './.mcp.json', 'Codex plugin must point to .mcp.json');
  expect(
    plugin.interface?.privacyPolicyURL === 'https://otakit.app/policy',
    'Codex plugin must declare the public privacy policy',
  );
  expect(
    plugin.interface?.termsOfServiceURL === 'https://otakit.app/terms',
    'Codex plugin must declare the public terms',
  );

  const remote = mcp.mcpServers?.otakit;
  expect(remote?.type === 'http', 'Plugin MCP definition must use HTTP transport');
  expect(
    remote?.url === 'https://console.otakit.app/mcp',
    'Plugin MCP definition must use the canonical hosted endpoint',
  );

  expect(
    registry.$schema ===
      'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    'server.json must use the pinned MCP Registry schema',
  );
  const npmPackage = registry.packages?.find(
    (entry) => entry.registryType === 'npm' && entry.identifier === '@otakit/cli',
  );
  expect(Boolean(npmPackage), 'server.json must declare the @otakit/cli npm package');
  expect(npmPackage?.version === cliPackage.version, 'Registry npm version must match CLI version');
  expect(npmPackage?.transport?.type === 'stdio', 'Registry npm transport must be stdio');
  expect(
    npmPackage?.packageArguments?.some(
      (argument) => argument.type === 'positional' && argument.value === 'mcp',
    ),
    'Registry npm package must launch the `mcp` subcommand',
  );
  expect(
    registry.remotes?.some(
      (remoteEntry) =>
        remoteEntry.type === 'streamable-http' &&
        remoteEntry.url === 'https://console.otakit.app/mcp',
    ),
    'server.json must declare the canonical Streamable HTTP endpoint',
  );
}

async function readJson(relativePath) {
  const text = await readText(relativePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    errors.push(`${relativePath} must contain valid JSON`);
    return null;
  }
}

async function readText(relativePath) {
  try {
    return await readFile(path.join(ROOT, relativePath), 'utf8');
  } catch {
    errors.push(`${relativePath} is required`);
    return null;
  }
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    errors.push('skills/otakit/SKILL.md requires YAML frontmatter');
    return {};
  }

  const result = {};
  let section = result;
  for (const line of match[1].split('\n')) {
    const nested = line.match(/^\s{2}([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (nested) {
      section[nested[1]] = unquote(nested[2]);
      continue;
    }
    const top = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!top) continue;
    if (top[2] === '') {
      section = {};
      result[top[1]] = section;
    } else {
      result[top[1]] = unquote(top[2]);
      section = result;
    }
  }
  return { ...result, version: result.metadata?.version };
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function expectFile(relativePath) {
  try {
    const details = await stat(path.join(ROOT, relativePath));
    expect(details.isFile(), `${relativePath} must be a file`);
  } catch {
    errors.push(`${relativePath} is required`);
  }
}

function expect(condition, message) {
  if (!condition) errors.push(message);
}
