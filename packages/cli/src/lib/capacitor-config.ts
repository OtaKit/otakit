import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CAPACITOR_CONFIG_FILE_NAMES = [
  'capacitor.config.ts',
  'capacitor.config.js',
  'capacitor.config.mjs',
  'capacitor.config.cjs',
  'capacitor.config.json',
] as const;

type UnknownRecord = Record<string, unknown>;

export interface CapacitorProjectConfig {
  configPath: string;
  appId?: string;
  channel?: string;
  runtimeVersion?: string;
  configuredServerUrl?: string;
  outputDir?: string;
}

const baseRequire = createRequire(import.meta.url);

export async function readCapacitorProjectConfig(
  cwd: string = process.cwd(),
): Promise<CapacitorProjectConfig | null> {
  const configPath = findCapacitorConfigPath(cwd);
  if (!configPath) {
    return null;
  }

  const rawConfig = await loadCapacitorConfigFile(configPath);
  return extractProjectConfig(configPath, rawConfig);
}

export function findCapacitorConfigPath(cwd: string = process.cwd()): string | null {
  let currentDir = resolve(cwd);

  while (true) {
    for (const fileName of CAPACITOR_CONFIG_FILE_NAMES) {
      const candidate = resolve(currentDir, fileName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

async function loadCapacitorConfigFile(configPath: string): Promise<unknown> {
  const extension = extname(configPath).toLowerCase();

  if (extension === '.json') {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown parse error';
      throw new Error(`${configPath} is not valid JSON: ${reason}`);
    }
  }

  if (extension === '.ts') {
    return loadTypeScriptConfigModule(configPath);
  }

  return loadJavaScriptConfigModule(configPath);
}

function loadTypeScriptConfigModule(configPath: string): unknown {
  const source = readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '');
  const tsPath = resolveNode(dirname(configPath), 'typescript');
  if (!tsPath) {
    throw new Error(
      `Could not find installation of TypeScript. To use ${configPath}, install TypeScript in your project.`,
    );
  }

  try {
    const ts = baseRequire(tsPath) as {
      ModuleKind: { CommonJS: number };
      ModuleResolutionKind: { NodeJs: number };
      ScriptTarget: { ES2017: number };
      transpileModule: (
        sourceText: string,
        options: {
          fileName: string;
          compilerOptions: Record<string, unknown>;
          reportDiagnostics: boolean;
        },
      ) => { outputText: string };
    };

    const transpiled = ts.transpileModule(source, {
      fileName: configPath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        strict: true,
        target: ts.ScriptTarget.ES2017,
      },
      reportDiagnostics: true,
    });

    return unwrapModuleExport(compileCommonJsModule(configPath, transpiled.outputText));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown evaluation error';
    throw new Error(`${configPath} could not be loaded. ${reason}`);
  }
}

async function loadJavaScriptConfigModule(configPath: string): Promise<unknown> {
  try {
    const loaded = await import(`${pathToFileURL(configPath).href}?otakit=${Date.now()}`);
    return unwrapModuleExport(loaded);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown evaluation error';
    throw new Error(`${configPath} could not be loaded. ${reason}`);
  }
}

function compileCommonJsModule(configPath: string, sourceText: string): unknown {
  const Module = baseRequire('node:module') as {
    new (id: string): {
      filename: string;
      paths: string[];
      _compile(code: string, filename: string): void;
      exports: unknown;
    };
    _nodeModulePaths(from: string): string[];
  };

  const mod = new Module(configPath);
  mod.filename = configPath;
  mod.paths = Module._nodeModulePaths(dirname(configPath));
  mod._compile(sourceText, configPath);
  return mod.exports;
}

function unwrapModuleExport(loaded: unknown): unknown {
  if (loaded && typeof loaded === 'object' && 'default' in loaded) {
    return (loaded as { default: unknown }).default;
  }
  return loaded;
}

function resolveNode(rootDir: string, id: string): string | null {
  try {
    return baseRequire.resolve(id, { paths: [rootDir] });
  } catch {
    return null;
  }
}

function extractProjectConfig(configPath: string, rawConfig: unknown): CapacitorProjectConfig {
  if (!isRecord(rawConfig)) {
    throw new Error(`${configPath} must export a config object.`);
  }

  const plugins = asOptionalRecord(rawConfig.plugins, `${configPath}.plugins`);
  const otaKitConfig = asOptionalRecord(plugins?.OtaKit, `${configPath}.plugins.OtaKit`);

  return {
    configPath,
    appId: readOptionalString(otaKitConfig?.appId, `${configPath}.plugins.OtaKit.appId`),
    channel: readOptionalString(otaKitConfig?.channel, `${configPath}.plugins.OtaKit.channel`),
    runtimeVersion: readOptionalString(
      otaKitConfig?.runtimeVersion,
      `${configPath}.plugins.OtaKit.runtimeVersion`,
    ),
    configuredServerUrl: readOptionalString(
      otaKitConfig?.serverUrl,
      `${configPath}.plugins.OtaKit.serverUrl`,
    ),
    outputDir: readOptionalString(rawConfig.webDir, `${configPath}.webDir`),
  };
}

function asOptionalRecord(value: unknown, fieldPath: string): UnknownRecord | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${fieldPath} must be an object.`);
  }
  return value;
}

function readOptionalString(value: unknown, fieldPath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldPath} must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
