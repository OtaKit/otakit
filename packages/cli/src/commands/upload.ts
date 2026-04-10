import { Command } from 'commander';

import ora from 'ora';

import { ApiClient } from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { runCommand } from '../lib/errors.js';
import { resolveBundlePath, resolveVersion, runUploadWorkflow } from '../lib/upload-workflow.js';
import { normalizeChannel, parsePositiveInteger } from '../lib/validate.js';

type UploadOptions = {
  appId?: string;
  server?: string;
  version?: string;
  strictVersion?: boolean;
  minNativeBuild?: string;
  release?: string | boolean;
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
  .option('--min-native-build <build>', 'Minimum native build number')
  .option('--release [channel]', 'Release after upload (base channel if omitted)')
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

      const minNativeBuild = options.minNativeBuild
        ? parsePositiveInteger(options.minNativeBuild, 'min-native-build')
        : undefined;
      const releaseChannel = resolveReleaseChannel(options.release);

      const spinner = ora('Creating zip archive...').start();

      const bundle = await (async () => {
        try {
          const result = await runUploadWorkflow({
            api,
            sourcePath,
            version,
            minNativeBuild,
            releaseChannel,
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
