import { Command } from 'commander';

import { PROJECT_CONFIG_LABEL, readProjectConfig, resolveConfigSnapshot } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';

type ConfigResolveOptions = {
  appId?: string;
  server?: string;
  outputDir?: string;
  channel?: string;
  json?: boolean;
};

type ConfigValidateOptions = {
  json?: boolean;
};

function formatMaybe(value: string | null): string {
  return value ?? '(unset)';
}

function formatAuthSource(source: string | null): string {
  if (!source) {
    return 'none';
  }
  if (source === 'env_token') {
    return 'env (OTAKIT_TOKEN)';
  }
  return source;
}

const resolveSubcommand = new Command('resolve')
  .description('Resolve effective config values and their sources')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .option('--output-dir <path>', 'Output directory override')
  .option('--channel <channel>', 'Channel override')
  .option('--json', 'Print machine-readable JSON output')
  .action(async (options: ConfigResolveOptions) => {
    await runCommand(async () => {
      const snapshot = await resolveConfigSnapshot({
        appId: options.appId,
        serverUrl: options.server,
        outputDir: options.outputDir,
        channel: options.channel,
      });

      const jsonPayload = {
        configFile: snapshot.configFile,
        appId: snapshot.appId,
        serverUrl: snapshot.serverUrl,
        outputDir: snapshot.outputDir,
        channel: snapshot.channel,
        runtimeVersion: snapshot.runtimeVersion,
        auth: {
          present: snapshot.authToken.value !== null,
          source: snapshot.authSource ?? 'none',
        },
      };

      if (options.json) {
        console.log(JSON.stringify(jsonPayload, null, 2));
        return;
      }

      console.log(`config file: ${snapshot.configFile.path}`);
      console.log(`config found: ${snapshot.configFile.found ? 'yes' : 'no'}`);
      console.log(`appId: ${formatMaybe(snapshot.appId.value)} (${snapshot.appId.source})`);
      console.log(`serverUrl: ${snapshot.serverUrl.value} (${snapshot.serverUrl.source})`);
      console.log(
        `outputDir: ${formatMaybe(snapshot.outputDir.value)} (${snapshot.outputDir.source})`,
      );
      console.log(`channel: ${formatMaybe(snapshot.channel.value)} (${snapshot.channel.source})`);
      console.log(
        `runtimeVersion: ${formatMaybe(snapshot.runtimeVersion.value)} (${snapshot.runtimeVersion.source})`,
      );
      console.log(
        `auth token: ${snapshot.authToken.value ? 'present' : 'missing'} (${formatAuthSource(
          snapshot.authSource,
        )})`,
      );

      if (!snapshot.appId.value) {
        console.log('fix appId: export OTAKIT_APP_ID=<app-id>');
      }
      if (!snapshot.authToken.value) {
        console.log('fix auth: export OTAKIT_TOKEN=<token>  # or run: otakit login');
      }
    });
  });

const validateSubcommand = new Command('validate')
  .description('Validate capacitor.config.* OtaKit settings in the current project')
  .option('--json', 'Print machine-readable JSON output')
  .action(async (options: ConfigValidateOptions) => {
    await runCommand(async () => {
      try {
        const config = await readProjectConfig();

        if (!config) {
          const message = `No ${PROJECT_CONFIG_LABEL} found in the current directory or its parents.`;
          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  ok: false,
                  error: message,
                },
                null,
                2,
              ),
            );
            process.exitCode = 2;
            return;
          }

          throw new CliError(
            [
              message,
              'Add OtaKit plugin config to capacitor.config.ts, or pass flags/env directly.',
            ].join('\n'),
            2,
          );
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                config,
              },
              null,
              2,
            ),
          );
          return;
        }

        console.log(`${PROJECT_CONFIG_LABEL} OtaKit settings are valid.`);
      } catch (error) {
        if (!options.json) {
          throw error;
        }

        const message = error instanceof Error ? error.message : 'Config validation failed.';
        console.log(
          JSON.stringify(
            {
              ok: false,
              error: message,
            },
            null,
            2,
          ),
        );
        process.exitCode = 1;
      }
    });
  });

export const configCommand = new Command('config')
  .description('Validate and inspect resolved CLI configuration')
  .addCommand(validateSubcommand)
  .addCommand(resolveSubcommand);
