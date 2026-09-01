import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readCliVersion(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    // TypeScript emits this module under dist/lib, while the publish build
    // bundles it into dist/index.js. Support both artifact layouts.
    for (const packageJsonPath of [
      resolve(currentDir, '../package.json'),
      resolve(currentDir, '../../package.json'),
    ]) {
      try {
        const raw = readFileSync(packageJsonPath, 'utf-8');
        const parsed = JSON.parse(raw) as { version?: unknown };
        if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
          return parsed.version.trim();
        }
      } catch {
        // Try the other supported build layout.
      }
    }
  } catch {
    // Fall back to a safe version value when package metadata is unavailable.
  }

  return '0.0.0';
}

export const CLI_VERSION = readCliVersion();

export function getCliUserAgent(version: string = CLI_VERSION): string {
  return `otakit-cli/${version}`;
}
