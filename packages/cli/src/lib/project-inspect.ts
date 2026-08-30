import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { readCapacitorProjectConfig } from './capacitor-config.js';
import { resolveConfigSnapshot } from './config.js';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.next',
  'android',
  'build',
  'dist',
  'ios',
  'node_modules',
]);
const MAX_SCANNED_FILES = 2_000;
const MAX_SOURCE_BYTES = 1_000_000;

function extension(path: string): string {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index) : '';
}

function findNotifyAppReady(root: string): string | null {
  const queue = [root];
  let scanned = 0;
  while (queue.length > 0 && scanned < MAX_SCANNED_FILES) {
    const directory = queue.shift();
    if (!directory) break;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
        queue.push(path);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extension(entry.name))) {
        continue;
      }
      scanned += 1;
      try {
        if (
          statSync(path).size <= MAX_SOURCE_BYTES &&
          readFileSync(path, 'utf8').includes('notifyAppReady')
        ) {
          return relative(root, path).split(sep).join('/');
        }
      } catch {
        // An unreadable source file is simply not evidence of integration.
      }
    }
  }
  return null;
}

function pluginVersion(projectRoot: string): string | null {
  const packageJsonPath = join(projectRoot, 'package.json');
  if (!existsSync(packageJsonPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return (
      parsed.dependencies?.['@otakit/capacitor-updater'] ??
      parsed.devDependencies?.['@otakit/capacitor-updater'] ??
      null
    );
  } catch {
    return null;
  }
}

export async function inspectOtaKitProject(projectRoot: string) {
  const root = resolve(projectRoot);
  const [capacitor, snapshot] = await Promise.all([
    readCapacitorProjectConfig(root),
    resolveConfigSnapshot({ cwd: root }),
  ]);
  const configDirectory = capacitor ? dirname(capacitor.configPath) : root;
  const outputPath = snapshot.outputDir.value
    ? resolve(configDirectory, snapshot.outputDir.value)
    : null;
  const notifyAppReadyPath = findNotifyAppReady(root);
  const findings: Array<{ level: 'error' | 'warning' | 'info'; message: string }> = [];

  if (!capacitor) findings.push({ level: 'error', message: 'No capacitor.config.* file found.' });
  if (!snapshot.appId.value) {
    findings.push({ level: 'error', message: 'plugins.OtaKit.appId is not configured.' });
  }
  if (!pluginVersion(root)) {
    findings.push({ level: 'error', message: '@otakit/capacitor-updater is not in package.json.' });
  }
  if (!outputPath) {
    findings.push({ level: 'warning', message: 'No Capacitor webDir/build output is configured.' });
  } else if (!existsSync(outputPath)) {
    findings.push({
      level: 'warning',
      message: `Configured build output does not exist: ${outputPath}`,
    });
  }
  if (!notifyAppReadyPath) {
    findings.push({
      level: 'warning',
      message: 'No notifyAppReady() call was found in the bounded project source scan.',
    });
  }

  return {
    projectRoot: root,
    capacitorConfig: capacitor
      ? {
          path: capacitor.configPath,
          appId: capacitor.appId ?? null,
          channel: capacitor.channel ?? null,
          runtimeVersion: capacitor.runtimeVersion ?? null,
          updateStrategy: capacitor.updateStrategy ?? 'zip',
          serverUrl: snapshot.serverUrl.value,
          serverUrlSource: snapshot.serverUrl.source,
        }
      : null,
    pluginVersion: pluginVersion(root),
    buildOutput: outputPath ? { path: outputPath, exists: existsSync(outputPath) } : null,
    notifyAppReady: {
      found: notifyAppReadyPath !== null,
      evidencePath: notifyAppReadyPath,
    },
    authenticated: snapshot.authToken.value !== null,
    findings,
  };
}
