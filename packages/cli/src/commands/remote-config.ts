import { readFile } from 'node:fs/promises';

import { Command } from 'commander';

import { ApiClient, type RemoteConfigWriteResult } from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { confirm } from '../lib/prompt.js';
import {
  channelLabel,
  describeKeyChanges,
  formatRemoteConfig,
  describeValue,
  formatRemoteConfigHistory,
  keyCount,
  parseConfigValue,
} from '../lib/remote-config.js';
import { normalizeChannel } from '../lib/validate.js';

type CommonOptions = {
  appId?: string;
  server?: string;
  channel?: string;
  json?: boolean;
};

type WriteOptions = CommonOptions & { message?: string; yes?: boolean };

/** Every subcommand works on one channel: `--channel <name>`, or the base channel. */
function withCommon(command: Command): Command {
  return command
    .option('--channel <channel>', 'Channel (default: the base channel)')
    .option('--json', 'Print machine-readable JSON output')
    .option('--app-id <id>', 'App ID override')
    .option('--server <url>', 'Server URL override');
}

async function client(options: CommonOptions): Promise<ApiClient> {
  return new ApiClient(await requireConfig({ appId: options.appId, serverUrl: options.server }));
}

function selectedChannel(options: CommonOptions): string | null {
  return options.channel === undefined ? null : normalizeChannel(options.channel);
}

function printWrite(result: RemoteConfigWriteResult, json?: boolean): void {
  for (const warning of result.warnings) console.error(`Warning: ${warning.message}`);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.changed) {
    console.log(
      `Nothing changed: ${channelLabel(result.config.channel)} already has these values (version ${result.config.version}).`,
    );
    return;
  }
  console.log(
    `Published version ${result.config.version} of ${channelLabel(result.config.channel)}'s config. Apps on plugin 3.4+ get it on their next fetch.`,
  );
  if (result.config.publicationStatus === 'pending') {
    console.error('Writing the file to the CDN failed; OtaKit retries within minutes.');
  }
}

async function confirmOrRequireYes(options: WriteOptions, question: string): Promise<boolean> {
  if (options.yes) return true;
  if (!process.stdin.isTTY) {
    throw new CliError(`${question} Re-run with --yes to confirm.`);
  }
  return confirm(question);
}

const listCommand = new Command('list')
  .description('List the channels that have remote config')
  .option('--json', 'Print machine-readable JSON output')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .action(async (options: CommonOptions) => {
    await runCommand(async () => {
      const { configs } = await (await client(options)).listRemoteConfigs();
      if (options.json) {
        console.log(JSON.stringify(configs, null, 2));
        return;
      }
      if (configs.length === 0) {
        console.log(
          'No remote config yet. Publish one with `otakit remote-config set <key> <value>`.',
        );
        return;
      }
      for (const config of configs) {
        const state =
          config.status === 'live'
            ? keyCount(config.values)
            : config.channel === null
              ? 'deleted (apps use their code defaults)'
              : 'deleted (uses the base config)';
        console.log(`${config.channel ?? 'base'}  v${config.version}  ${state}`);
      }
    });
  });

const getCommand = withCommon(
  new Command('get')
    .description("Show a channel's remote config")
    .option('--values', 'Print only the values as JSON (for `remote-config push`)'),
).action(async (options: CommonOptions & { values?: boolean }) => {
  await runCommand(async () => {
    const state = await (await client(options)).getRemoteConfig(selectedChannel(options));
    if (options.values) {
      console.log(JSON.stringify(state.status === 'live' ? (state.values ?? {}) : {}, null, 2));
    } else if (options.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(formatRemoteConfig(state));
    }
  });
});

const setCommand = withCommon(
  new Command('set')
    .description(
      'Set one key; the value is JSON when it parses (false, 5, {"a":1}), else text. A channel without its own config starts from the base values.',
    )
    .argument('<key>', 'Top-level key')
    .argument('<value>', 'New value')
    .option('--string', 'Store the value as text even if it looks like JSON')
    .option('--message <text>', 'Why it changes (history, audit log, notifications)'),
).action(async (key: string, value: string, options: WriteOptions & { string?: boolean }) => {
  await runCommand(async () => {
    const api = await client(options);
    const channel = selectedChannel(options);
    const current = await api.getRemoteConfig(channel);
    const parsed = parseConfigValue(value, options.string);
    if (!options.json) console.log(`${key} = ${describeValue(parsed)}`);
    printWrite(
      await api.patchRemoteConfig({
        channel,
        set: { [key]: parsed },
        expectedVersion: current.version,
        message: options.message,
      }),
      options.json,
    );
  });
});

const unsetCommand = withCommon(
  new Command('unset')
    .description('Remove keys')
    .argument('<keys...>', 'Top-level keys to remove')
    .option('--message <text>', 'Why it changes (history, audit log, notifications)'),
).action(async (keys: string[], options: WriteOptions) => {
  await runCommand(async () => {
    const api = await client(options);
    const channel = selectedChannel(options);
    const current = await api.getRemoteConfig(channel);
    printWrite(
      await api.patchRemoteConfig({
        channel,
        unset: keys,
        expectedVersion: current.version,
        message: options.message,
      }),
      options.json,
    );
  });
});

const pushCommand = withCommon(
  new Command('push')
    .description("Replace a channel's config with a JSON file")
    .argument('<file>', 'JSON object, such as the output of `remote-config get --values`')
    .option('--message <text>', 'Why it changes (history, audit log, notifications)')
    .option('--yes', 'Replace without asking for confirmation'),
).action(async (file: string, options: WriteOptions) => {
  await runCommand(async () => {
    let values: unknown;
    try {
      values = JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch (error) {
      throw new CliError(
        `Cannot read ${file} as JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
      throw new CliError(`${file} must contain a JSON object.`);
    }
    const api = await client(options);
    const channel = selectedChannel(options);
    const current = await api.getRemoteConfig(channel);
    const changes = describeKeyChanges(
      current.status === 'live' ? current.values : null,
      values as Record<string, unknown>,
    );
    if (
      !(await confirmOrRequireYes(
        options,
        `Replace ${channelLabel(channel)}'s config (${changes})?`,
      ))
    ) {
      console.log('Not changed.');
      return;
    }
    printWrite(
      await api.putRemoteConfig({
        channel,
        values: values as Record<string, unknown>,
        expectedVersion: current.version,
        message: options.message,
      }),
      options.json,
    );
  });
});

const historyCommand = withCommon(
  new Command('history').description("List a channel's config versions, newest first"),
).action(async (options: CommonOptions) => {
  await runCommand(async () => {
    const { versions } = await (
      await client(options)
    ).getRemoteConfigHistory(selectedChannel(options));
    console.log(
      options.json ? JSON.stringify(versions, null, 2) : formatRemoteConfigHistory(versions),
    );
  });
});

const restoreCommand = withCommon(
  new Command('restore')
    .description("Publish an earlier version's values again, as a new version")
    .argument('<version>', 'Version to restore')
    .option('--message <text>', 'Why (default: "Restored version N")'),
).action(async (version: string, options: WriteOptions) => {
  await runCommand(async () => {
    const number = Number(version.replace(/^v/i, ''));
    if (!Number.isInteger(number) || number < 1) {
      throw new CliError('Version must be a number, such as 12.');
    }
    const api = await client(options);
    const channel = selectedChannel(options);
    const current = await api.getRemoteConfig(channel);
    printWrite(
      await api.restoreRemoteConfig({
        channel,
        version: number,
        expectedVersion: current.version,
        message: options.message,
      }),
      options.json,
    );
  });
});

const deleteCommand = withCommon(
  new Command('delete')
    .description(
      "Delete a channel's config: its devices then use the base config (base: code defaults)",
    )
    .option('--message <text>', 'Why it changes (history, audit log, notifications)')
    .option('--yes', 'Delete without asking for confirmation'),
).action(async (options: WriteOptions) => {
  await runCommand(async () => {
    const api = await client(options);
    const channel = selectedChannel(options);
    const current = await api.getRemoteConfig(channel);
    if (current.status !== 'live') {
      throw new CliError(`${channelLabel(channel)} has no config to delete.`);
    }
    const effect =
      channel === null
        ? 'Apps will use their code defaults.'
        : "Its devices will use the base channel's config.";
    if (
      !(await confirmOrRequireYes(options, `Delete ${channelLabel(channel)}'s config? ${effect}`))
    ) {
      console.log('Not deleted.');
      return;
    }
    const result = await api.deleteRemoteConfig({
      channel,
      expectedVersion: current.version,
      message: options.message,
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(
      `Deleted ${channelLabel(channel)}'s config (version ${result.config.version}). ${effect}`,
    );
  });
});

export const remoteConfigCommand = new Command('remote-config')
  .description('Read and change remote config: values apps read with OtaKit.getConfig()')
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(setCommand)
  .addCommand(unsetCommand)
  .addCommand(pushCommand)
  .addCommand(historyCommand)
  .addCommand(restoreCommand)
  .addCommand(deleteCommand);
