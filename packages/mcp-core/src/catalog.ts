import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';

import {
  appIdSchema,
  bundleIdSchema,
  channelSchema,
  cursorSchema,
  expectedCurrentReleaseIdSchema,
  idempotencyKeySchema,
  paginationShape,
  releaseIdSchema,
  releaseOptionsShape,
  runtimeVersionSchema,
  uploadShape,
  type OtaKitMcpMode,
  type OtaKitToolName,
} from './contracts.js';

export type OtaKitToolDefinition = {
  name: OtaKitToolName;
  title: string;
  description: string;
  modes: readonly OtaKitMcpMode[];
  inputSchema: z.ZodObject<z.ZodRawShape>;
  annotations: ToolAnnotations;
  oauthScopes: readonly string[];
  allowOrganizationKey: boolean;
  ownerAdminOnly?: boolean;
};

const both = ['local', 'remote'] as const;
const local = ['local'] as const;
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} satisfies ToolAnnotations;
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} satisfies ToolAnnotations;
const idempotentWrite = {
  ...write,
  idempotentHint: true,
} satisfies ToolAnnotations;
const destructive = {
  ...idempotentWrite,
  destructiveHint: true,
} satisfies ToolAnnotations;
const destructiveNonIdempotent = {
  ...write,
  destructiveHint: true,
} satisfies ToolAnnotations;

export const OTAKIT_TOOL_CATALOG: readonly OtaKitToolDefinition[] = [
  {
    name: 'search_docs',
    title: 'Search OtaKit documentation',
    description:
      'Search the bundled current OtaKit documentation by customer terminology. Use before guessing setup, configuration, or CLI behavior.',
    modes: both,
    inputSchema: z.object({
      query: z.string().trim().min(1).max(300),
      limit: z.number().int().min(1).max(8).optional(),
    }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'read_doc_page',
    title: 'Read an OtaKit documentation page',
    description:
      'Read a bounded Markdown chunk from a known OtaKit documentation route returned by search_docs. Arbitrary URLs and filesystem paths are rejected.',
    modes: both,
    inputSchema: z.object({ path: z.string().startsWith('/').max(300), cursor: cursorSchema }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'get_context',
    title: 'Show the active OtaKit context',
    description:
      'Show the fixed server origin, organization, actor, role, scopes, mode, and capabilities without exposing credentials.',
    modes: both,
    inputSchema: z.object({}),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'get_account_status',
    title: 'Get OtaKit account and usage status',
    description:
      'Return the safe customer-facing plan, usage, limit, period, and overage state needed to explain upload or release failures. Provider IDs are excluded.',
    modes: both,
    inputSchema: z.object({}),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: false,
  },
  {
    name: 'list_apps',
    title: 'List OtaKit apps',
    description:
      'List apps in the connection-bound organization, optionally requiring an exact slug. Never guesses an app when the slug is absent.',
    modes: both,
    inputSchema: z.object({
      slug: z.string().trim().min(1).max(200).optional(),
      cursor: cursorSchema,
      limit: z.number().int().min(1).max(50).optional(),
    }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'create_app',
    title: 'Create an OtaKit app',
    description:
      'Register a validated app slug in the current organization and return its ID and minimal Capacitor configuration. Does not edit local files.',
    modes: both,
    inputSchema: z.object({ slug: z.string().trim().min(1).max(200) }),
    annotations: write,
    oauthScopes: ['otakit:app:write'],
    allowOrganizationKey: true,
  },
  {
    name: 'list_bundles',
    title: 'List OtaKit bundles',
    description:
      'List safe bundle metadata and release-artifact history for one app, with bounded pagination and optional exact version.',
    modes: both,
    inputSchema: z.object({
      appId: appIdSchema,
      version: z.string().trim().min(1).max(120).optional(),
      ...paginationShape,
    }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'get_bundle',
    title: 'Get OtaKit bundle metadata',
    description:
      'Get authorized safe metadata for a known bundle, including bounded native-package metadata and encryption presence but never keys or storage URLs.',
    modes: both,
    inputSchema: z.object({ appId: appIdSchema, bundleId: bundleIdSchema }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'delete_bundle',
    title: 'Delete an unused OtaKit bundle',
    description:
      'Delete a bundle only when it is absent from all release history. The exact app and bundle IDs are required and the operation is audited.',
    modes: both,
    inputSchema: z.object({ appId: appIdSchema, bundleId: bundleIdSchema }),
    annotations: destructive,
    oauthScopes: ['otakit:bundle:write'],
    allowOrganizationKey: true,
  },
  {
    name: 'list_releases',
    title: 'List OtaKit release history',
    description:
      'List bounded release history for an app, optionally filtered to a channel, while preserving runtime-lane identity and all release options.',
    modes: both,
    inputSchema: z.object({
      appId: appIdSchema,
      channel: channelSchema.optional(),
      ...paginationShape,
    }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'get_release_state',
    title: 'Get current OtaKit release state',
    description:
      'Resolve the exact current release for one (app, channel, runtimeVersion) lane. Returns null rather than selecting another lane.',
    modes: both,
    inputSchema: z.object({
      appId: appIdSchema,
      channel: channelSchema,
      runtimeVersion: runtimeVersionSchema,
    }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'prepare_release',
    title: 'Prepare an OtaKit release',
    description:
      'Preview the exact current and proposed lane state for a bundle and return expectedCurrentReleaseId. Makes no change.',
    modes: both,
    inputSchema: z.object({
      appId: appIdSchema,
      bundleId: bundleIdSchema,
      channel: channelSchema,
      compatibilityDecision: z.enum(['block', 'proceed', 'skip']).optional(),
      ...releaseOptionsShape,
    }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'publish_release',
    title: 'Publish an OtaKit release',
    description:
      'Publish a reviewed bundle to an exact lane. Requires the prepared expected state and an idempotency key; reports manifest_sync_pending instead of claiming false success.',
    modes: both,
    inputSchema: z.object({
      appId: appIdSchema,
      bundleId: bundleIdSchema,
      channel: channelSchema,
      expectedCurrentReleaseId: expectedCurrentReleaseIdSchema,
      idempotencyKey: idempotencyKeySchema,
      compatibilityDecision: z.enum(['block', 'proceed', 'skip']).optional(),
      ...releaseOptionsShape,
    }),
    annotations: destructive,
    oauthScopes: ['otakit:release:write'],
    allowOrganizationKey: true,
  },
  {
    name: 'get_release_health',
    title: 'Get OtaKit release event health',
    description:
      'Return bounded client-reported event counts, rollback share, auto-revert thresholds, and analytics availability for a release. Never calls counts devices or adoption.',
    modes: both,
    inputSchema: z.object({
      appId: appIdSchema,
      releaseId: releaseIdSchema,
      window: z.enum(['1h', '24h', '7d', '30d']).optional(),
    }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'list_events',
    title: 'List OtaKit client-reported events',
    description:
      'List a bounded filtered rollout timeline. Detail is preserved when requested and labelled as untrusted client-reported text.',
    modes: both,
    inputSchema: z.object({
      appId: appIdSchema,
      releaseId: releaseIdSchema.optional(),
      bundleVersion: z.string().trim().min(1).max(120).optional(),
      action: z.enum(['downloaded', 'applied', 'download_error', 'rollback']).optional(),
      platform: z.enum(['ios', 'android']).optional(),
      channel: channelSchema.optional(),
      runtimeVersion: runtimeVersionSchema.optional(),
      since: z.iso.datetime().optional(),
      timeframe: z.enum(['1h', '24h', '7d', '30d']).optional(),
      includeDetail: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'list_audit_log',
    title: 'List OtaKit audit activity',
    description:
      'List bounded organization audit activity for an owner or admin. Operational organization keys and member-role users cannot read it.',
    modes: both,
    inputSchema: z.object({ ...paginationShape }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: false,
    ownerAdminOnly: true,
  },
  {
    name: 'prepare_revert',
    title: 'Prepare an OtaKit revert',
    description:
      'Verify that a release is current and preview the exact release or built-in fallback that will become current. Makes no change.',
    modes: both,
    inputSchema: z.object({ appId: appIdSchema, releaseId: releaseIdSchema }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'revert_release',
    title: 'Revert an OtaKit release',
    description:
      'Revert the reviewed current release for its exact lane. Requires expected state and an idempotency key and reports pending manifest synchronization truthfully.',
    modes: both,
    inputSchema: z.object({
      appId: appIdSchema,
      releaseId: releaseIdSchema,
      expectedCurrentReleaseId: releaseIdSchema,
      idempotencyKey: idempotencyKeySchema,
      forceImmediate: z.boolean().optional(),
    }),
    annotations: destructive,
    oauthScopes: ['otakit:release:write'],
    allowOrganizationKey: true,
  },
  {
    name: 'inspect_project',
    title: 'Inspect a local Capacitor project',
    description:
      'Inspect the selected local project for Capacitor and OtaKit configuration, build output, plugin version, server target, and notifyAppReady evidence. Does not return source contents.',
    modes: local,
    inputSchema: z.object({}),
    annotations: { ...readOnly, openWorldHint: false },
    oauthScopes: [],
    allowOrganizationKey: true,
  },
  {
    name: 'check_compatibility',
    title: 'Check native update compatibility',
    description:
      'Compare local native dependencies with the current exact OtaKit release lane using the existing heuristic compatibility rules. Returns unknowns explicitly.',
    modes: local,
    inputSchema: z.object({
      appId: appIdSchema,
      packageJsonPath: z.string().min(1).max(4096).optional(),
      nodeModulesPath: z.string().min(1).max(4096).optional(),
      channel: channelSchema,
      runtimeVersion: runtimeVersionSchema,
    }),
    annotations: readOnly,
    oauthScopes: ['otakit:read'],
    allowOrganizationKey: true,
  },
  {
    name: 'upload_bundle',
    title: 'Upload an OtaKit bundle',
    description:
      'Package and upload the selected local web build using the existing zip/delta, native metadata, version, and encryption workflow without publishing it.',
    modes: local,
    inputSchema: z.object(uploadShape),
    annotations: write,
    oauthScopes: ['otakit:bundle:write'],
    allowOrganizationKey: true,
  },
  {
    name: 'upload_and_publish_bundle',
    title: 'Upload and publish an OtaKit bundle',
    description:
      'Run the existing combined local upload and release workflow with an explicit lane, compatibility decision, expected current release, complete release options, and idempotency key.',
    modes: local,
    inputSchema: z.object({
      ...uploadShape,
      channel: channelSchema,
      expectedCurrentReleaseId: expectedCurrentReleaseIdSchema,
      idempotencyKey: idempotencyKeySchema,
      ...releaseOptionsShape,
    }),
    // The publish phase is idempotent, but the preceding artifact upload is
    // not durably keyed. Callers must reuse the returned bundle after a partial
    // result instead of retrying the combined operation.
    annotations: destructiveNonIdempotent,
    oauthScopes: ['otakit:bundle:write', 'otakit:release:write'],
    allowOrganizationKey: true,
  },
] as const;

export function toolDefinitionsForMode(mode: OtaKitMcpMode): readonly OtaKitToolDefinition[] {
  return OTAKIT_TOOL_CATALOG.filter((definition) => definition.modes.includes(mode));
}

export function getToolDefinition(name: OtaKitToolName): OtaKitToolDefinition {
  const definition = OTAKIT_TOOL_CATALOG.find((entry) => entry.name === name);
  if (!definition) {
    throw new Error(`Unknown OtaKit tool definition: ${name}`);
  }
  return definition;
}
