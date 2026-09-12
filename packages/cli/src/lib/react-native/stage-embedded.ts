import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { rnCaseFoldingJSON } from '@otakit/rn-protocol';
import { hashBuffer, hashFile } from '../hash.js';
import { assertOutputOutside } from './completed-build.js';
import { readEmbeddedExport } from './export-receipt.js';
import { hostConfigurationHash, parseHostConfiguration } from './host-configuration.js';
import { withReceiptLock } from './receipts.js';

type Inventory = Map<string, { size: number; sha256: string }>;

async function verifyStagedDirectory(root: string, expected: Inventory): Promise<void> {
  const remaining = new Set(expected.keys());
  const directories = new Set(['']);
  for (const path of expected.keys()) {
    for (let parent = dirname(path); parent !== '.'; parent = dirname(parent))
      directories.add(parent);
  }
  async function walk(path: string): Promise<void> {
    const absolute = join(root, path);
    const info = await lstat(absolute);
    if (info.isDirectory() && directories.has(path)) {
      for (const name of await readdir(absolute)) await walk(path ? `${path}/${name}` : name);
    } else {
      const file = expected.get(path);
      if (
        !info.isFile() ||
        !file ||
        info.size !== file.size ||
        (await hashFile(absolute)) !== file.sha256
      )
        throw new Error('Existing staged resources differ; select a new output directory');
      remaining.delete(path);
    }
  }
  await walk('');
  if (remaining.size) throw new Error('Staged resources are incomplete');
}

/** Prepare the complete resource folder before the platform build consumes it. Never merge trees. */
export async function stageEmbedded(options: {
  embeddedExport: string;
  configuration: string;
  output: string;
}): Promise<{ output: string; nativeBuildId: string }> {
  const output = resolve(options.output);
  await assertOutputOutside(options.embeddedExport, output);
  await assertOutputOutside(output, options.embeddedExport);
  await assertOutputOutside(output, options.configuration);
  const { receipt, nativeBuild } = await readEmbeddedExport(options.embeddedExport);
  const resourceDirectory = nativeBuild.identity.nativeConfiguration.otakitResourceDirectory;
  if (
    typeof resourceDirectory !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(resourceDirectory) ||
    basename(output) !== resourceDirectory
  )
    throw new Error('Output folder must match the recorded otakitResourceDirectory');
  const config = parseHostConfiguration(await readFile(options.configuration));
  if (
    !nativeBuild.identity.hostConfigurationHash ||
    hostConfigurationHash(config) !== nativeBuild.identity.hostConfigurationHash
  )
    throw new Error(
      'Host configuration must match the export’s recorded otakitHostConfigurationFile',
    );
  const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const resources = new Map([
    [
      'configuration.json',
      json({
        ...config,
        embeddedReceipt: receipt.embeddedReceipt,
        nativeBuildId: receipt.nativeBuildId,
        reactNativeVersion: nativeBuild.identity.reactNativeVersion,
        hermesBytecodeVersion: nativeBuild.identity.hermesCompiler.bytecodeVersion,
      }),
    ],
    ['otakit-embedded.json', json(receipt.embeddedReceipt)],
    ['case-folding.json', Buffer.from(rnCaseFoldingJSON + '\n')],
  ]);
  const expected: Inventory = new Map(receipt.files.map((file) => [`payload/${file.path}`, file]));
  for (const [path, bytes] of resources)
    expected.set(path, { size: bytes.length, sha256: hashBuffer(bytes) });

  return withReceiptLock(output, async () => {
    const result = { output, nativeBuildId: receipt.nativeBuildId };
    let exists = true;
    try {
      await lstat(output);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      exists = false;
    }
    if (exists) {
      await verifyStagedDirectory(output, expected);
      return result;
    }
    const temporary = await mkdtemp(join(dirname(output), `.${basename(output)}-stage-`));
    try {
      for (const file of receipt.files) {
        const bytes = await readFile(join(options.embeddedExport, 'payload', file.path));
        if (bytes.length !== file.size || hashBuffer(bytes) !== file.sha256)
          throw new Error('Embedded payload changed during staging');
        const destination = join(temporary, 'payload', file.path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: 'wx' });
      }
      for (const [path, bytes] of resources)
        await writeFile(join(temporary, path), bytes, { flag: 'wx', mode: 0o600 });
      await verifyStagedDirectory(temporary, expected);
      // Publish a complete folder on the same filesystem; a failed preparation leaves no partial output.
      await rename(temporary, output);
      return result;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
