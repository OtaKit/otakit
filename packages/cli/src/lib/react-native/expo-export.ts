import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { RNDescriptor, RNPlatform } from '@otakit/rn-protocol';
import type { SourceMapping } from './artifacts.js';
import { prepareExpoEnvironment } from './expo-environment.js';

interface ExpoAsset {
  files: string[];
  scales: number[];
  [key: string]: unknown;
}

/** Adapter for the installed SDK 57 embed exporter, before any native asset copies occur. */
export async function exportExpoGraph(options: {
  project: string;
  entry: string;
  platform: RNPlatform;
  privateFiles: string;
  source: string;
  map: string;
  filterScales: (platform: string, scales: number[]) => number[];
}): Promise<{ mappings: SourceMapping[]; expo: NonNullable<RNDescriptor['expo']> }> {
  const { project, platform, privateFiles } = options;
  prepareExpoEnvironment(project);
  const require = createRequire(join(project, 'package.json'));
  const cliRoot = dirname(
    createRequire(require.resolve('expo/package.json')).resolve('@expo/cli/package.json'),
  );
  const cliRequire = createRequire(join(cliRoot, 'package.json'));
  const { getConfig } = cliRequire('@expo/config');
  const { exp } = getConfig(project, { isPublicConfig: true });
  if (exp.experiments?.reactServerFunctions || exp.experiments?.reactServerComponentRoutes)
    throw new Error('Expo server components require a separate verified export adapter');
  const { exportEmbedBundleAndAssetsAsync } = cliRequire(
    './build/src/export/embed/exportEmbedAsync.js',
  );
  const { getAssetLocalPath } = cliRequire('./build/src/export/metroAssetLocalPath.js');
  let entryFile = resolve(project, options.entry);
  try {
    if (!(await stat(entryFile)).isFile()) throw new Error('Expo entry must be a file');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    entryFile = require.resolve(options.entry);
  }
  const result: {
    bundle: { code: unknown; map: unknown };
    assets: ExpoAsset[];
    files: Map<string, { contents: string | Buffer }>;
  } = await exportEmbedBundleAndAssetsAsync(project, {
    entryFile,
    platform,
    dev: false,
    minify: false,
    bytecode: false,
    // This enables collection of DOM assets into the returned files map; native assets
    // are still returned as source mappings, without the upstream copying step.
    assetsDest: join(privateFiles, 'expo-output'),
    sourcemapOutput: options.map,
    skipServer: true,
    maxWorkers: 2,
    // SDK 57 can reuse a Babel transform with stale inlined EXPO_PUBLIC values
    // after .env changes. A release export must rebuild that graph from its inputs.
    resetCache: true,
  });
  if (
    typeof result.bundle.code !== 'string' ||
    typeof result.bundle.map !== 'string' ||
    !Array.isArray(result.assets) ||
    !(result.files instanceof Map)
  )
    throw new Error('Expo embed exporter returned an unsupported output shape');
  await writeFile(options.source, result.bundle.code);
  await writeFile(options.map, result.bundle.map);
  const mappings: SourceMapping[] = [];
  for (const asset of result.assets) {
    if (
      !Array.isArray(asset.files) ||
      !Array.isArray(asset.scales) ||
      asset.files.length !== asset.scales.length
    )
      throw new Error('Expo did not expose the full native asset mapping');
    const scales = new Set(options.filterScales(platform, asset.scales));
    asset.scales.forEach((scale, index) => {
      if (scales.has(scale))
        mappings.push({
          source: asset.files[index],
          destination: getAssetLocalPath(asset, { platform, scale }),
        });
    });
  }
  const generated = join(privateFiles, 'expo-generated');
  await mkdir(generated);
  const configuration = join(generated, 'configuration.json');
  await writeFile(configuration, JSON.stringify(exp) + '\n');
  mappings.push({ source: configuration, destination: 'expo-config.json' });
  let hasDom = false;
  let index = 0;
  for (const [name, file] of result.files) {
    // SDK 57 returns both /www.bundle/... and www.bundle/... keys. Normalize only
    // that documented exporter root, then let the shared inventory reject aliases.
    const destination = name.startsWith('/www.bundle/') ? name.slice(1) : name;
    if (!destination.startsWith('www.bundle/'))
      throw new Error(`Unexpected Expo embed output outside www.bundle: ${name}`);
    if (typeof file.contents !== 'string' && !Buffer.isBuffer(file.contents))
      throw new Error(`Unsupported Expo output contents: ${name}`);
    const source = join(generated, `${index++}${destination.endsWith('.map') ? '.map' : '.asset'}`);
    let contents = file.contents;
    if (destination.endsWith('.js'))
      contents = contents.toString().replace(/^\/\/[#@] sourceMappingURL=.*$/gm, '');
    if (destination.endsWith('.css'))
      contents = contents.toString().replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '');
    await writeFile(source, contents);
    if (destination.endsWith('.map')) continue; // Source maps stay in the private archive.
    mappings.push({ source, destination });
    hasDom = true;
  }
  if (hasDom) {
    const { getPublicFolderPath } = cliRequire('./build/src/export/publicFolder.js');
    const publicRoot: string = getPublicFolderPath(project);
    async function publicFiles(directory: string, prefix: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (directory === publicRoot && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const source = join(directory, entry.name);
        const destination = `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink())
          throw new Error(`Expo public assets cannot contain symlinks: ${source}`);
        if (entry.isDirectory()) await publicFiles(source, destination);
        else if (entry.isFile()) {
          if (entry.name.endsWith('.map'))
            throw new Error('Move source maps out of the Expo public directory');
          mappings.push({ source, destination });
        } else throw new Error(`Unsupported Expo public asset: ${source}`);
      }
    }
    await publicFiles(publicRoot, 'www.bundle');
  }
  // The same full pre-copy collision/path/inventory checks handle native, DOM and public assets.
  return {
    mappings,
    expo: { configFile: 'expo-config.json', ...(hasDom ? { domRoot: 'www.bundle' } : {}) },
  };
}
