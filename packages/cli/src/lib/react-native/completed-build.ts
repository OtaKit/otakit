import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJSON } from '@otakit/rn-protocol';
import { hashBuffer } from '../hash.js';
import {
  assertSameNativeBuild,
  captureNativeBuild,
  type NativeBuildInputs,
  type NativeBuildRecord,
} from './build-record.js';
import { readEmbeddedExport, type EmbeddedExportReceipt } from './export-receipt.js';
import { verifyNativePackage, type NativePackageIdentity } from './native-package.js';
import { withReceiptLock, writeReceipt } from './receipts.js';

export interface CompletedNativeBuild {
  format: 'otakit-rn-completed-build';
  version: 1;
  nativeBuild: NativeBuildRecord;
  baseline: EmbeddedExportReceipt;
  binary: NativePackageIdentity;
}
export function completedBuildHash(receipt: CompletedNativeBuild): string {
  return hashBuffer(Buffer.from(canonicalJSON(receipt)));
}

/** Resolve existing ancestors too, so an output symlink cannot point back into an input. */
export async function assertOutputOutside(input: string, output: string): Promise<void> {
  async function location(path: string): Promise<string> {
    try {
      return await realpath(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(path);
      if (parent === path) throw error;
      return join(await location(parent), basename(path));
    }
  }
  const inputPath = await location(resolve(input));
  const outputPath = await location(resolve(output));
  const nested = relative(inputPath, outputPath);
  if (!nested || (nested !== '..' && !nested.startsWith(`..${sep}`) && !isAbsolute(nested)))
    throw new Error(
      'Keep generated output outside the selected native package or archived baseline',
    );
}

export function assertCompletedBuild(raw: unknown): asserts raw is CompletedNativeBuild {
  const receipt = raw as CompletedNativeBuild | null;
  if (
    !receipt ||
    receipt.format !== 'otakit-rn-completed-build' ||
    receipt.version !== 1 ||
    !receipt.nativeBuild ||
    !receipt.baseline ||
    !receipt.binary ||
    receipt.baseline.purpose !== 'embedded' ||
    receipt.binary.format !==
      (receipt.nativeBuild.identity?.platform === 'android' ? 'android-apk' : 'ios-app') ||
    receipt.binary.nativeApplicationId !== receipt.nativeBuild.identity?.nativeApplicationId ||
    typeof receipt.binary.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.binary.sha256)
  )
    throw new Error(
      'OTA export requires a verified completed native build, not a prepared input record',
    );
  assertSameNativeBuild(receipt.nativeBuild, receipt.nativeBuild);
}

export async function verifyCompletedBaseline(receipt: CompletedNativeBuild, directory: string) {
  assertCompletedBuild(receipt);
  const baseline = await readEmbeddedExport(directory);
  assertSameNativeBuild(receipt.nativeBuild, baseline.nativeBuild);
  if (canonicalJSON(receipt.baseline) !== canonicalJSON(baseline.receipt))
    throw new Error('Archived baseline differs from the selected completed native build');
  return baseline;
}

/** Run after a successful native build. This records local CI provenance, not store attestation. */
export async function sealNativeBuild(options: {
  project: string;
  nativeInputs: NativeBuildInputs;
  embeddedExport: string;
  binary: string;
  receiptPath: string;
  aapt2?: string;
}): Promise<CompletedNativeBuild> {
  await assertOutputOutside(options.binary, options.receiptPath);
  return withReceiptLock(options.receiptPath, async () => {
    const baseline = await readEmbeddedExport(options.embeddedExport);
    assertSameNativeBuild(
      baseline.nativeBuild,
      await captureNativeBuild(options.project, options.nativeInputs),
    );
    const binary = await verifyNativePackage({
      binary: options.binary,
      nativeBuild: baseline.nativeBuild,
      baseline: baseline.receipt,
      aapt2: options.aapt2,
    });
    assertSameNativeBuild(
      baseline.nativeBuild,
      await captureNativeBuild(options.project, options.nativeInputs),
    );
    const completed: CompletedNativeBuild = {
      format: 'otakit-rn-completed-build',
      version: 1,
      nativeBuild: baseline.nativeBuild,
      baseline: baseline.receipt,
      binary,
    };
    let previous: unknown;
    try {
      previous = JSON.parse(await readFile(options.receiptPath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (previous !== undefined) {
      if (canonicalJSON(previous) !== canonicalJSON(completed))
        throw new Error('Completed build receipt already records a different binary or baseline');
      return completed;
    }
    await writeReceipt(options.receiptPath, completed);
    return completed;
  });
}
