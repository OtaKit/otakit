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
  failOnIncompatible?: boolean;
  ignoreCompat?: boolean;
  packageJson?: string;
  nodeModules?: string;
  forceImmediate?: boolean;
  encrypt?: boolean;
};

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
  .option('--fail-on-incompatible', 'Exit non-zero when native compatibility check fails')
  .option('--ignore-compat', 'Skip the native compatibility check')
  .option('--package-json <path>', 'package.json used for native dependency detection')
  .option('--node-modules <path>', 'node_modules used for native dependency detection')
  .option(
    '--force-immediate',
    'With --release: devices apply and reload on their next check (emergency fixes)',
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

      const spinner = ora('Creating zip archive...').start();

      const bundle = await (async () => {
        try {
          const result = await runUploadWorkflow({
            api,
            sourcePath,
            version,
            runtimeVersion: config.runtimeVersion,
            releaseChannel,
            nativePackages,
            forceImmediate: options.forceImmediate === true,
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
