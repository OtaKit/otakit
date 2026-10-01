import { describeBundleDiff } from '@otakit/mcp-core';
import { Command } from 'commander';

import ora from 'ora';

import { ApiClient } from '../lib/api.js';
import { checkCompatibilityAgainstChannel, findLaneState } from '../lib/compat-check.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import {
  collectNativePackages,
  formatCompatibilityReport,
  type NativePackage,
} from '../lib/native-deps.js';
import {
  explainRolloutConflict,
  findRolloutConflict,
  rolloutConflictError,
  rolloutSuffix,
} from '../lib/rollout.js';
import { renderPreview } from '../lib/preview.js';
import { resolveBundlePath, resolveVersion, runUploadWorkflow } from '../lib/upload-workflow.js';
import { normalizeChannel, parseRolloutPercent } from '../lib/validate.js';

type UploadOptions = {
  appId?: string;
  server?: string;
  version?: string;
  strictVersion?: boolean;
  release?: string | boolean;
  strategy?: string;
  failOnIncompatible?: boolean;
  ignoreCompat?: boolean;
  packageJson?: string;
  nodeModules?: string;
  forceImmediate?: boolean;
  autoRevert?: boolean;
  autoRevertRate?: string;
  autoRevertMinSample?: string;
  rollout?: string;
  replaceRollout?: boolean;
  preview?: boolean;
  encrypt?: boolean;
  strictArtifacts?: boolean;
};

function parseAutoRevertThreshold(
  raw: string | undefined,
  flag: string,
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CliError(`${flag} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return value;
}

function resolveStrategy(
  flagValue: string | undefined,
  configValue: 'zip' | 'deltas' | undefined,
): 'zip' | 'deltas' {
  const raw = flagValue?.trim().toLowerCase();
  if (raw !== undefined && raw !== 'zip' && raw !== 'deltas') {
    throw new Error(`--strategy must be "zip" or "deltas" (got "${flagValue}")`);
  }
  return (raw as 'zip' | 'deltas' | undefined) ?? configValue ?? 'zip';
}

function resolveReleaseChannel(
  releaseOption: string | boolean | undefined,
): string | null | undefined {
  if (releaseOption === undefined || releaseOption === false) {
    return undefined;
  }

  if (releaseOption === true) {
    return null;
  }

  return normalizeChannel(releaseOption);
}

export const uploadCommand = new Command('upload')
  .description('Upload a new bundle')
  .argument('[path]', 'Path to the bundle directory')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .option('--version <version>', 'Version string (default: OTAKIT_VERSION, then auto-generated)')
  .option('--strict-version', 'Require explicit version (--version or OTAKIT_VERSION)')
  .option(
    '--strict-artifacts',
    'Fail before uploading on large bundles, native installers, .env files, .git or node_modules',
  )
  .option('--release [channel]', 'Release after upload (base channel if omitted)')
  .option(
    '--strategy <strategy>',
    'Upload strategy: "zip" (single archive, default) or "deltas" (per-file objects)',
  )
  .option('--fail-on-incompatible', 'Exit non-zero when native compatibility check fails')
  .option('--ignore-compat', 'Skip the native compatibility check')
  .option('--package-json <path>', 'package.json used for native dependency detection')
  .option('--node-modules <path>', 'node_modules used for native dependency detection')
  .option(
    '--force-immediate',
    'With --release: devices apply and reload on their next check (emergency fixes)',
  )
  .option(
    '--auto-revert',
    'With --release: automatically revert this release if too many devices roll back (24h window)',
  )
  .option(
    '--auto-revert-rate <percent>',
    'With --auto-revert: rollback share that triggers the revert (1-95, default 20)',
  )
  .option(
    '--auto-revert-min-sample <count>',
    'With --auto-revert: minimum applied+rollback events before the rate is trusted (10-100000, default 50)',
  )
  .option(
    '--rollout <percent>',
    'With --release: release to this share of devices first (1-100, default 100)',
  )
  .option(
    '--replace-rollout',
    "With --release: cancel the channel's active rollout and release this bundle in its place",
  )
  .option(
    '--preview',
    'Also create a preview link and QR code for the uploaded bundle (see `otakit preview`)',
  )
  .option(
    '--encrypt',
    'Encrypt the bundle with OTAKIT_ENCRYPTION_KEY (auto-enabled when the env var is set)',
  )
  .action(async (path: string | undefined, options: UploadOptions) => {
    await runCommand(async () => {
      const config = await requireConfig({
        appId: options.appId,
        serverUrl: options.server,
      });
      const api = new ApiClient(config);

      const sourcePath = resolveBundlePath(path, config);

      const resolvedVersion = await resolveVersion(options.version, {
        strict: options.strictVersion,
        bundlePath: sourcePath,
      });
      const version = resolvedVersion.value;

      if (resolvedVersion.source === 'auto') {
        console.log(`Using auto-generated version: ${version}`);
      }

      const releaseChannel = resolveReleaseChannel(options.release);
      const strategy = resolveStrategy(options.strategy, config.updateStrategy);

      // Always capture the native set so this upload becomes the baseline for
      // the next one; --ignore-compat only skips the comparison.
      let nativePackages: NativePackage[] | undefined;
      try {
        nativePackages = collectNativePackages({
          packageJsonPath: options.packageJson,
          nodeModulesPath: options.nodeModules,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Skipping native dependency detection: ${message}`);
      }

      // Compare against the channel this bundle is headed for; a plain
      // upload without --release is checked against the base channel.
      const targetChannel = releaseChannel === undefined ? null : releaseChannel;
      const checksCompatibility = nativePackages !== undefined && !options.ignoreCompat;
      const lane =
        checksCompatibility || releaseChannel !== undefined
          ? await findLaneState(api, targetChannel, config.runtimeVersion)
          : null;

      if (nativePackages && checksCompatibility) {
        const result = await checkCompatibilityAgainstChannel({
          api,
          channel: targetChannel,
          runtimeVersion: config.runtimeVersion,
          nativePackages,
          baseline: lane?.stable ?? null,
        });

        if (result.status === 'incompatible') {
          console.error(formatCompatibilityReport(result));
          if (options.failOnIncompatible) {
            throw new CliError('Upload blocked: incompatible native changes detected.');
          }
          console.warn('Continuing upload despite incompatible native changes (warning only).');
        } else if (result.status === 'skipped') {
          console.log('Native compatibility check skipped (no baseline on this channel/lane yet).');
        }
      }

      if (options.forceImmediate === true && releaseChannel === undefined) {
        console.warn('--force-immediate has no effect without --release; ignoring.');
      }

      if (
        options.autoRevert !== true &&
        (options.autoRevertRate !== undefined || options.autoRevertMinSample !== undefined)
      ) {
        throw new CliError(
          '--auto-revert-rate and --auto-revert-min-sample require --auto-revert.',
        );
      }
      if (options.autoRevert === true && releaseChannel === undefined) {
        console.warn('--auto-revert has no effect without --release; ignoring.');
      }
      if (
        (options.rollout !== undefined || options.replaceRollout === true) &&
        releaseChannel === undefined
      ) {
        console.warn('--rollout and --replace-rollout have no effect without --release; ignoring.');
      }
      const rolloutPercent =
        options.rollout === undefined || releaseChannel === undefined
          ? undefined
          : parseRolloutPercent(options.rollout, '--rollout');
      const replaceRollout = options.replaceRollout === true && releaseChannel !== undefined;
      if (releaseChannel !== undefined && lane) {
        const conflict = findRolloutConflict(lane, { rolloutPercent, replaceRollout });
        if (conflict) throw rolloutConflictError(conflict, releaseChannel);
      }
      if (rolloutPercent !== undefined && rolloutPercent < 100) {
        if ((await api.supportsRollouts()) === false) {
          throw new CliError(
            'This OtaKit server does not have percentage rollouts enabled (OTAKIT_RELEASE_RELIABILITY_ENABLED). Release without --rollout.',
          );
        }
      }
      const autoRevertRatePercent = parseAutoRevertThreshold(
        options.autoRevertRate,
        '--auto-revert-rate',
        1,
        95,
      );
      const autoRevertMinSample = parseAutoRevertThreshold(
        options.autoRevertMinSample,
        '--auto-revert-min-sample',
        10,
        100000,
      );

      const spinner = ora(
        strategy === 'deltas' ? 'Hashing bundle files...' : 'Creating zip archive...',
      ).start();

      const uploadResult = await (async () => {
        try {
          const result = await runUploadWorkflow({
            api,
            sourcePath,
            version,
            runtimeVersion: config.runtimeVersion,
            releaseChannel,
            strategy,
            nativePackages,
            forceImmediate: options.forceImmediate === true,
            autoRevert: options.autoRevert === true,
            autoRevertRatePercent,
            autoRevertMinSample,
            rolloutPercent,
            replaceRollout: replaceRollout || undefined,
            encrypt: options.encrypt,
            strictArtifacts: options.strictArtifacts,
            onStatus: (message) => {
              spinner.text = message;
            },
          });
          return result;
        } catch (error) {
          if (spinner.isSpinning) {
            spinner.fail('Upload failed.');
          }
          throw releaseChannel === undefined
            ? error
            : explainRolloutConflict(error, releaseChannel);
        }
      })();
      const bundle = uploadResult.bundle;

      if (uploadResult.release?.publicationStatus === 'manifest_sync_pending') {
        throw new CliError(
          `Bundle uploaded and release ${uploadResult.release.release.id} was recorded, but manifest synchronization is pending (operation ${uploadResult.release.operationId}). OtaKit will retry automatically; do not upload or publish it again.`,
        );
      }

      if (releaseChannel !== undefined) {
        const share = uploadResult.release ? rolloutSuffix(uploadResult.release.release) : '';
        spinner.succeed(
          `Uploaded ${bundle.version} (${bundle.id}) and released to ${releaseChannel ?? 'base channel'}${share}.`,
        );
      } else {
        spinner.succeed(`Uploaded ${bundle.version} (${bundle.id}).`);
      }

      // What changed against the bundle the targeted lane runs; informational only.
      const baseline = lane?.stable ?? null;
      if (baseline && baseline.bundleId !== bundle.id) {
        const laneLabel = `${targetChannel ?? 'base channel'} (${baseline.bundleVersion ?? baseline.bundleId})`;
        try {
          const diff = await api.diffBundle(bundle.id, { against: baseline.bundleId });
          console.log(describeBundleDiff(diff, { baseLabel: laneLabel }));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`Could not compare with ${laneLabel}: ${reason}`);
        }
      }

      if (options.preview) {
        // The upload (and release) already succeeded; a missing preview link only warns.
        try {
          const { preview } = await api.createPreview(bundle.id);
          console.log(await renderPreview(preview));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(
            `Warning: the preview link was not created: ${reason}\nRetry with \`otakit preview ${bundle.id}\`.`,
          );
        }
      }
    });
  });
