import { Command } from 'commander';

import ora from 'ora';

import { ApiClient } from '../lib/api.js';
import { checkCompatibilityAgainstChannel } from '../lib/compat-check.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import {
  collectNativePackages,
  formatCompatibilityReport,
  type NativePackage,
} from '../lib/native-deps.js';
import { resolveBundlePath, resolveVersion, runUploadWorkflow } from '../lib/upload-workflow.js';
import { normalizeChannel } from '../lib/validate.js';

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
  encrypt?: boolean;
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

      if (nativePackages && !options.ignoreCompat) {
        // Compare against the channel this bundle is headed for; a plain
        // upload without --release is checked against the base channel.
        const targetChannel = releaseChannel === undefined ? null : releaseChannel;
        const result = await checkCompatibilityAgainstChannel({
          api,
          channel: targetChannel,
          runtimeVersion: config.runtimeVersion,
          nativePackages,
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

      const bundle = await (async () => {
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
            encrypt: options.encrypt,
            onStatus: (message) => {
              spinner.text = message;
            },
          });
          return result.bundle;
        } catch (error) {
          if (spinner.isSpinning) {
            spinner.fail('Upload failed.');
          }
          throw error;
        }
      })();

      if (releaseChannel !== undefined) {
        spinner.succeed(
          `Uploaded ${bundle.version} (${bundle.id}) and released to ${releaseChannel ?? 'base channel'}.`,
        );
      } else {
        spinner.succeed(`Uploaded ${bundle.version} (${bundle.id}).`);
      }
    });
  });
