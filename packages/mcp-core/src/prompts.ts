import { z } from 'zod';

import type { OtaKitMcpMode } from './contracts';

/**
 * Discoverable entry points. Clients surface these as slash commands, so the
 * common jobs stop depending on someone knowing what to type. Each one is a
 * starting instruction, not an action: every prompt still routes through the
 * same approval boundary the Skill describes.
 */
export type OtaKitPromptDefinition = {
  name: string;
  title: string;
  description: string;
  modes: readonly OtaKitMcpMode[];
  argsSchema?: z.ZodObject<z.ZodRawShape>;
  render: (args: Record<string, string | undefined>) => string;
};

const both = ['local', 'remote'] as const;
const local = ['local'] as const;

const channelArg = z.object({
  channel: z.string().optional().describe('Named channel, or leave empty for the base channel'),
});

export const OTAKIT_PROMPTS: readonly OtaKitPromptDefinition[] = [
  {
    name: 'check',
    title: 'Check this project',
    description: 'Read-only readiness check: configuration, lane, and native compatibility.',
    modes: local,
    render: () =>
      [
        'Check whether this Capacitor project is ready to ship an OtaKit update.',
        '',
        'Use get_context for the bound organization, app, and lane, then inspect_project,',
        'then check_compatibility against the current release for that exact lane.',
        'Report configuration problems, the current release, and the compatibility result.',
        'Do not upload, publish, or change anything.',
      ].join('\n'),
  },
  {
    name: 'release',
    title: 'Release an update',
    description: 'Upload the built web assets and prepare a release for approval.',
    modes: local,
    argsSchema: channelArg,
    render: ({ channel }) =>
      [
        `Ship an OtaKit update${channel ? ` to the ${channel} channel` : ' to the base channel'}.`,
        '',
        'Follow the review-first workflow: inspect the project, check native compatibility,',
        'upload the built web directory without publishing, then prepare_release for the',
        'exact lane. Show me the approval block with the current and proposed bundle, the',
        'lane, force-immediate, auto-revert, and the compatibility decision.',
        '',
        'Stop there and wait for my approval before publishing.',
      ].join('\n'),
  },
  {
    name: 'rollout',
    title: 'Check rollout health',
    description: 'Summarise recent client-reported events for the current release.',
    modes: both,
    argsSchema: channelArg,
    render: ({ channel }) =>
      [
        `Summarise the rollout of the current OtaKit release${channel ? ` on the ${channel} channel` : ''}.`,
        '',
        'Resolve the current release for the exact lane, read its health, and list recent',
        'events. These are event records, not devices, users, or adoption — describe them',
        'that way. Call out download errors and rollbacks, and say whether analytics is',
        'unavailable rather than reporting zero.',
      ].join('\n'),
  },
  {
    name: 'revert',
    title: 'Revert a release',
    description: 'Prepare a revert of the current release for approval.',
    modes: both,
    argsSchema: channelArg,
    render: ({ channel }) =>
      [
        `Prepare a revert of the current OtaKit release${channel ? ` on the ${channel} channel` : ''}.`,
        '',
        'Resolve the current release for the exact lane and call prepare_revert. Show me the',
        'release that would become current — or the built-in fallback — the lane, and whether',
        'force-immediate will reload running apps.',
        '',
        'Do not execute the revert until I approve it.',
      ].join('\n'),
  },
];

export function promptsForMode(mode: OtaKitMcpMode): readonly OtaKitPromptDefinition[] {
  return OTAKIT_PROMPTS.filter((prompt) => prompt.modes.includes(mode));
}
