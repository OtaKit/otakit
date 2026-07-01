import { Command } from 'commander';

import { ApiClient } from '../lib/api.js';
import { checkCompatibilityAgainstChannel } from '../lib/compat-check.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { collectNativePackages, formatCompatibilityReport } from '../lib/native-deps.js';
import { normalizeChannel } from '../lib/validate.js';

type CompatibilityOptions = {
  appId?: string;
  server?: string;
  channel?: string;
  failOnIncompatible?: boolean;
  packageJson?: string;
  nodeModules?: string;
};

export const compatibilityCommand = new Command('compatibility')
  .description("Compare local native dependencies against a channel's current release")
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .option('--channel <name>', 'Release channel to compare against (default: base channel)')
  .option('--fail-on-incompatible', 'Exit non-zero when the check reports incompatible')
  .option('--package-json <path>', 'package.json used for native dependency detection')
  .option('--node-modules <path>', 'node_modules used for native dependency detection')
  .action(async (options: CompatibilityOptions) => {
    await runCommand(async () => {
      const config = await requireConfig({
        appId: options.appId,
        serverUrl: options.server,
      });
      const api = new ApiClient(config);

      const channel = options.channel === undefined ? null : normalizeChannel(options.channel);

      const nativePackages = collectNativePackages({
        packageJsonPath: options.packageJson,
        nodeModulesPath: options.nodeModules,
      });

      const result = await checkCompatibilityAgainstChannel({
        api,
        channel,
        runtimeVersion: config.runtimeVersion,
        nativePackages,
      });

      console.log(formatCompatibilityReport(result));

      if (result.status === 'incompatible' && options.failOnIncompatible) {
        throw new CliError('Incompatible native changes detected.');
      }
    });
  });
