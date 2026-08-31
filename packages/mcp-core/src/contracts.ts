import { z } from 'zod';

export const OTAKIT_TOOL_NAMES = [
  'get_context',
  'get_account_status',
  'list_apps',
  'create_app',
  'list_bundles',
  'get_bundle',
  'delete_bundle',
  'list_releases',
  'get_release_state',
  'prepare_release',
  'publish_release',
  'get_release_health',
  'list_events',
  'list_audit_log',
  'prepare_revert',
  'revert_release',
  'inspect_project',
  'check_compatibility',
  'upload_bundle',
  'upload_and_publish_bundle',
] as const;

export type OtaKitToolName = (typeof OTAKIT_TOOL_NAMES)[number];
export type OtaKitMcpMode = 'local' | 'remote';

export const toolLinkSchema = z.object({
  label: z.string(),
  url: z.string().url(),
});

export const toolEnvelopeSchema = z.object({
  summary: z.string(),
  data: z.json(),
  warnings: z.array(z.string()),
  links: z.array(toolLinkSchema),
  nextActions: z.array(z.string()).max(3),
});

export type ToolEnvelope = z.infer<typeof toolEnvelopeSchema>;

export function toolEnvelope(
  summary: string,
  data: ToolEnvelope['data'],
  options: Partial<Pick<ToolEnvelope, 'warnings' | 'links' | 'nextActions'>> = {},
): ToolEnvelope {
  return {
    summary,
    data,
    warnings: options.warnings ?? [],
    links: options.links ?? [],
    nextActions: options.nextActions ?? [],
  };
}

export class PublicToolError extends Error {
  readonly code: string;
  readonly nextStep?: string;

  constructor(code: string, message: string, nextStep?: string) {
    super(message);
    this.name = 'PublicToolError';
    this.code = code;
    this.nextStep = nextStep;
  }
}

export const appIdSchema = z.string().uuid().describe('OtaKit app ID');
/**
 * A local connection is bound to one project, and that project's
 * capacitor.config already names its app. Requiring the ID anyway forced an
 * extra discovery call before every read. Omitting it uses the bound app, and
 * the result always says which app it used — a stated default, not a hidden one.
 */
export const resolvedAppIdSchema = appIdSchema
  .optional()
  .describe(
    'OtaKit app ID. Optional on a local connection whose project configures one; required otherwise.',
  );
export const bundleIdSchema = z.string().uuid().describe('OtaKit bundle ID');
export const releaseIdSchema = z.string().uuid().describe('OtaKit release ID');
export const channelSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/)
  .nullable()
  .describe('Named channel, or null for the base channel');
export const runtimeVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/)
  .nullable()
  .describe('Native runtime lane, or null for the default runtime');
export const cursorSchema = z.string().min(1).max(256).optional();
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .describe('Stable key reused only when retrying this exact mutation');
export const expectedCurrentReleaseIdSchema = releaseIdSchema
  .nullable()
  .describe('Release ID shown by prepare, or null when the lane had no release');

export const releaseOptionsShape = {
  forceImmediate: z
    .boolean()
    .optional()
    .describe('Make devices apply and reload on their next check'),
  autoRevert: z
    .boolean()
    .optional()
    .describe('Enable rollback-share based automatic revert for this release'),
  autoRevertRatePercent: z.number().int().min(1).max(95).optional(),
  autoRevertMinSample: z.number().int().min(10).max(100000).optional(),
};

export const paginationShape = {
  cursor: cursorSchema,
  limit: z.number().int().min(1).max(200).optional(),
};

export const uploadShape = {
  appId: resolvedAppIdSchema,
  sourcePath: z.string().min(1).max(4096).optional(),
  version: z.string().trim().min(1).max(64).optional(),
  versionMode: z.enum(['strict', 'auto']).optional(),
  runtimeVersion: runtimeVersionSchema.optional(),
  strategy: z.enum(['zip', 'deltas']).optional(),
  encrypt: z.boolean().optional(),
  packageJsonPath: z.string().min(1).max(4096).optional(),
  nodeModulesPath: z.string().min(1).max(4096).optional(),
};
