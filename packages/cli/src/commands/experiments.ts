import { readFile } from 'node:fs/promises';

import { experimentChangeSummary } from '@otakit/mcp-core';
import { Command } from 'commander';

import { ApiClient, type ExperimentChangeResult } from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { formatExperimentList, formatExperimentResults } from '../lib/experiments.js';
import { confirm } from '../lib/prompt.js';

type CommonOptions = { appId?: string; server?: string; json?: boolean };
type WriteOptions = CommonOptions & { yes?: boolean };

function withCommon(command: Command): Command {
  return command
    .option('--json', 'Print machine-readable JSON output')
    .option('--app-id <id>', 'App ID override')
    .option('--server <url>', 'Server URL override');
}

async function client(options: CommonOptions): Promise<ApiClient> {
  return new ApiClient(await requireConfig({ appId: options.appId, serverUrl: options.server }));
}

async function confirmOrRequireYes(options: WriteOptions, question: string): Promise<boolean> {
  if (options.yes) return true;
  if (!process.stdin.isTTY) throw new CliError(`${question} Re-run with --yes to confirm.`);
  return confirm(question);
}

function printChange(
  action: 'started' | 'stopped' | 'shipped',
  result: ExperimentChangeResult,
  json?: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (action === 'started') {
    console.log(
      `Started ${result.experiment.key}. Devices on plugin 3.4+ get their variant on their next config fetch.`,
    );
    if (result.publicationStatus === 'pending') {
      console.error('Writing the config file to the CDN failed; OtaKit retries within minutes.');
    }
    return;
  }
  const parts = experimentChangeSummary(action, result);
  for (const warning of parts.warnings) console.error(`Warning: ${warning}`);
  console.log(parts.summary);
}

const listCommand = withCommon(new Command('list').description("List the app's A/B tests")).action(
  async (options: CommonOptions) => {
    await runCommand(async () => {
      const { experiments } = await (await client(options)).listExperiments();
      console.log(
        options.json ? JSON.stringify(experiments, null, 2) : formatExperimentList(experiments),
      );
    });
  },
);

const resultsCommand = withCommon(
  new Command('results')
    .description('Show results: devices and conversion per variant, lift, errors and the verdict')
    .argument('<experiment>', 'A/B test key or ID'),
).action(async (experiment: string, options: CommonOptions) => {
  await runCommand(async () => {
    const result = await (await client(options)).getExperimentResults(experiment);
    console.log(options.json ? JSON.stringify(result, null, 2) : formatExperimentResults(result));
  });
});

const createCommand = withCommon(
  new Command('create')
    .description(
      'Create a draft A/B test from a JSON file: { key, name, channel?, audienceChannels?, runtimeVersions?, trafficPercent?, variants: [{ key, weight, overrides }], goalEvent, secondaryEvents? }',
    )
    .requiredOption('--file <path>', 'JSON file with the definition')
    .option('--start', 'Start it right away')
    .option('-y, --yes', 'Start without confirming'),
).action(async (options: WriteOptions & { file: string; start?: boolean }) => {
  await runCommand(async () => {
    let definition: unknown;
    try {
      definition = JSON.parse(await readFile(options.file, 'utf8'));
    } catch (error) {
      throw new CliError(
        `Could not read ${options.file} as JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      throw new CliError(`${options.file} must hold one JSON object`);
    }
    const api = await client(options);
    const { experiment } = await api.createExperiment(definition as Record<string, unknown>);
    if (!options.start) {
      console.log(
        options.json
          ? JSON.stringify({ experiment }, null, 2)
          : `Created the draft ${experiment.key}. Start it with \`otakit experiments start ${experiment.key}\`.`,
      );
      return;
    }
    if (
      !(await confirmOrRequireYes(
        options,
        `Start ${experiment.key}? Devices get their variant on their next config fetch.`,
      ))
    ) {
      console.log(`Created the draft ${experiment.key}; not started.`);
      return;
    }
    printChange('started', await api.startExperiment(experiment.id), options.json);
  });
});

const startCommand = withCommon(
  new Command('start')
    .description('Start a draft A/B test')
    .argument('<experiment>', 'A/B test key or ID')
    .option('-y, --yes', 'Start without confirming'),
).action(async (experiment: string, options: WriteOptions) => {
  await runCommand(async () => {
    if (
      !(await confirmOrRequireYes(
        options,
        `Start ${experiment}? Devices get their variant on their next config fetch.`,
      ))
    ) {
      return;
    }
    printChange('started', await (await client(options)).startExperiment(experiment), options.json);
  });
});

const stopCommand = withCommon(
  new Command('stop')
    .description('Stop a running A/B test; its devices get the normal config values again')
    .argument('<experiment>', 'A/B test key or ID')
    .option('-y, --yes', 'Stop without confirming'),
).action(async (experiment: string, options: WriteOptions) => {
  await runCommand(async () => {
    if (!(await confirmOrRequireYes(options, `Stop ${experiment}?`))) return;
    printChange('stopped', await (await client(options)).stopExperiment(experiment), options.json);
  });
});

const shipCommand = withCommon(
  new Command('ship')
    .description(
      "Ship a variant: its overrides become the config's values for every device, and the test ends",
    )
    .argument('<experiment>', 'A/B test key or ID')
    .requiredOption('--variant <key>', 'Variant to ship (control keeps the current values)')
    .option('-y, --yes', 'Ship without confirming'),
).action(async (experiment: string, options: WriteOptions & { variant: string }) => {
  await runCommand(async () => {
    if (
      !(await confirmOrRequireYes(
        options,
        `Ship ${options.variant} of ${experiment} to every device?`,
      ))
    ) {
      return;
    }
    printChange(
      'shipped',
      await (await client(options)).shipExperimentVariant(experiment, options.variant),
      options.json,
    );
  });
});

const deleteCommand = withCommon(
  new Command('delete')
    .description('Delete a test that is not running, with its results')
    .argument('<experiment>', 'A/B test key or ID')
    .option('-y, --yes', 'Delete without confirming'),
).action(async (experiment: string, options: WriteOptions) => {
  await runCommand(async () => {
    if (!(await confirmOrRequireYes(options, `Delete ${experiment} and its results?`))) return;
    const result = await (await client(options)).deleteExperiment(experiment);
    console.log(options.json ? JSON.stringify(result, null, 2) : `Deleted ${experiment}.`);
  });
});

export const experimentsCommand = new Command('experiments')
  .description('A/B tests on remote config (plugin 3.4+)')
  .addCommand(listCommand)
  .addCommand(resultsCommand)
  .addCommand(createCommand)
  .addCommand(startCommand)
  .addCommand(stopCommand)
  .addCommand(shipCommand)
  .addCommand(deleteCommand);
