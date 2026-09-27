import { randomUUID } from 'node:crypto';

import { Command } from 'commander';

import {
  ApiClient,
  OtaKitApiError,
  type PushAudienceInput,
  type PushCampaign,
} from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { confirm } from '../lib/prompt.js';
import { parsePositiveInteger } from '../lib/validate.js';

type CommonOptions = { appId?: string; server?: string };

type SendOptions = CommonOptions & {
  title: string;
  body: string;
  url?: string;
  data?: string[];
  platform?: string[];
  channel?: string[];
  topic?: string[];
  user?: string[];
  yes?: boolean;
  json?: boolean;
};

// Push is an add-on; when it is off the server says how to turn it on.
function runPushCommand(action: () => Promise<void>): Promise<void> {
  return runCommand(async () => {
    try {
      await action();
    } catch (error) {
      if (error instanceof OtaKitApiError && error.nextStep) {
        throw new CliError(`${error.message}\n${error.nextStep}`);
      }
      throw error;
    }
  });
}

const collect = (value: string, previous: string[] = []) => [...previous, value];

function parseData(entries: string[] | undefined): Record<string, string> | undefined {
  if (!entries?.length) return undefined;
  const data: Record<string, string> = {};
  for (const entry of entries) {
    const index = entry.indexOf('=');
    if (index <= 0) throw new CliError(`Invalid --data "${entry}". Use key=value.`);
    data[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return data;
}

function devices(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'device' : 'devices'}`;
}

function describe(campaign: PushCampaign): string {
  const lines = [
    `${campaign.id}  ${campaign.status}  "${campaign.payload.title}"`,
    `  targeted ${campaign.targeted} · accepted ${campaign.accepted} · failed ${campaign.failed} · invalid tokens removed ${campaign.invalidRemoved}`,
  ];
  if (campaign.failureReason) lines.push(`  ${campaign.failureReason}`);
  if (campaign.errorSummary && Object.keys(campaign.errorSummary).length > 0) {
    lines.push(
      `  ${Object.entries(campaign.errorSummary)
        .map(([reason, count]) => `${reason}: ${count}`)
        .join(' · ')}`,
    );
  }
  return lines.join('\n');
}

const sendCommand = new Command('send')
  .description('Send a push notification to your app users')
  .requiredOption('--title <title>', 'Notification title')
  .requiredOption('--body <body>', 'Notification text')
  .option('--url <url>', 'Path or https link the app opens (sent as data.url)')
  .option('--data <key=value>', 'Extra data (repeatable)', collect)
  .option('--platform <platform>', 'ios or android (repeatable; default both)', collect)
  .option('--channel <channel>', 'Only devices on this OTA channel (repeatable)', collect)
  .option('--topic <topic>', 'Only devices subscribed to this topic (repeatable)', collect)
  .option('--user <id>', 'Only this user ID (repeatable)', collect)
  .option('--yes', 'Send without asking for confirmation')
  .option('--json', 'Print the campaign as JSON')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .action(async (options: SendOptions) => {
    await runPushCommand(async () => {
      const config = await requireConfig({ appId: options.appId, serverUrl: options.server });
      const api = new ApiClient(config);

      const platforms = options.platform?.map((platform) => platform.toLowerCase());
      if (platforms?.some((platform) => platform !== 'ios' && platform !== 'android')) {
        throw new CliError('--platform must be ios or android.');
      }
      const audience: PushAudienceInput = {
        ...(platforms?.length ? { platforms: platforms as Array<'ios' | 'android'> } : {}),
        ...(options.channel?.length ? { channels: options.channel } : {}),
        ...(options.topic?.length ? { topics: options.topic } : {}),
        ...(options.user?.length ? { userIds: options.user } : {}),
      };
      const payload = {
        title: options.title,
        body: options.body,
        ...(options.url ? { url: options.url } : {}),
        ...(parseData(options.data) ? { data: parseData(options.data) } : {}),
      };

      const preview = await api.previewPush({ payload, audience });
      for (const warning of preview.warnings) console.error(`Warning: ${warning}`);
      const total = preview.audienceCount.total;
      if (total === 0) throw new CliError('No devices match this audience.');

      if (!options.yes) {
        if (!process.stdin.isTTY) {
          throw new CliError(`This would send to ${devices(total)}. Re-run with --yes to send.`);
        }
        const ok = await confirm(`Send "${options.title}" to ${devices(total)}?`);
        if (!ok) {
          console.log('Not sent.');
          return;
        }
      }

      const { campaign } = await api.sendPush({
        payload,
        audience,
        expectedAudience: total,
        idempotencyKey: randomUUID(),
      });
      if (options.json) {
        console.log(JSON.stringify(campaign, null, 2));
        return;
      }
      console.log(`Sending to ${devices(campaign.targeted)}. Campaign ${campaign.id}`);
      console.log(`Check progress: otakit push campaign ${campaign.id}`);
    });
  });

const campaignsCommand = new Command('campaigns')
  .description('List recent push campaigns')
  .option('--limit <n>', 'Number of campaigns', '10')
  .option('--json', 'Print JSON')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .action(async (options: CommonOptions & { limit: string; json?: boolean }) => {
    await runPushCommand(async () => {
      const config = await requireConfig({ appId: options.appId, serverUrl: options.server });
      const api = new ApiClient(config);
      const limit = Math.min(parsePositiveInteger(options.limit, 'limit'), 100);
      const { campaigns } = await api.listPushCampaigns(limit);
      if (options.json) {
        console.log(JSON.stringify(campaigns, null, 2));
        return;
      }
      if (campaigns.length === 0) {
        console.log('No push campaigns yet.');
        return;
      }
      for (const campaign of campaigns) console.log(describe(campaign));
    });
  });

const campaignCommand = new Command('campaign')
  .description('Show one push campaign')
  .argument('<campaignId>', 'Campaign ID')
  .option('--json', 'Print JSON')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .action(async (campaignId: string, options: CommonOptions & { json?: boolean }) => {
    await runPushCommand(async () => {
      const config = await requireConfig({ appId: options.appId, serverUrl: options.server });
      const { campaign } = await new ApiClient(config).getPushCampaign(campaignId);
      console.log(options.json ? JSON.stringify(campaign, null, 2) : describe(campaign));
    });
  });

export const pushCommand = new Command('push')
  .description('Send and track push notifications')
  .addCommand(sendCommand)
  .addCommand(campaignsCommand)
  .addCommand(campaignCommand);
