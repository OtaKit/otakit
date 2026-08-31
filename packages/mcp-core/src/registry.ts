import { McpServer, type CallToolResult, type ServerContext } from '@modelcontextprotocol/server';
import type { z } from 'zod';

import { OTAKIT_TOOL_CATALOG, toolDefinitionsForMode } from './catalog';
import {
  PublicToolError,
  toolEnvelopeSchema,
  type OtaKitMcpMode,
  type OtaKitToolName,
  type ToolEnvelope,
} from './contracts';

export type OtaKitToolAdapter = {
  invoke(
    name: OtaKitToolName,
    input: Record<string, unknown>,
    context: ServerContext,
  ): Promise<ToolEnvelope>;
};

export type OtaKitToolAuthorization = {
  canRegister?(name: OtaKitToolName): boolean;
  authorize?(name: OtaKitToolName, context: ServerContext): void | Promise<void>;
};

type RegisterTool = (
  name: string,
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodObject<z.ZodRawShape>;
    annotations: (typeof OTAKIT_TOOL_CATALOG)[number]['annotations'];
  },
  callback: (input: Record<string, unknown>, context: ServerContext) => Promise<CallToolResult>,
) => unknown;

/**
 * The envelope's summary, warnings, and next actions are written for the agent
 * reading the result, so they lead. The payload follows as JSON on its own line
 * for anything parsing it. `structuredContent` still carries the whole envelope.
 */
function renderEnvelope(envelope: ToolEnvelope): string {
  const lines = [envelope.summary];
  for (const warning of envelope.warnings) lines.push(`Warning: ${warning}`);
  lines.push(JSON.stringify(envelope.data));
  for (const link of envelope.links) lines.push(`${link.label}: ${link.url}`);
  for (const action of envelope.nextActions) lines.push(`Next: ${action}`);
  return lines.join('\n');
}

function toolErrorResult(error: unknown): CallToolResult {
  if (error instanceof PublicToolError) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: error.code,
            message: error.message,
            ...(error.nextStep ? { nextStep: error.nextStep } : {}),
          }),
        },
      ],
    };
  }

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          code: 'INTERNAL_ERROR',
          message: 'OtaKit could not complete this tool call',
          nextStep: 'Retry once. If the problem continues, check the OtaKit server logs.',
        }),
      },
    ],
  };
}

/** What this connection is already bound to, stated up front. */
export type ServerBinding = {
  serverOrigin: string;
  organizationName: string;
  projectRoot?: string;
  appSlug?: string | null;
  appId?: string | null;
  channel?: string | null;
  runtimeVersion?: string | null;
  releaseWritesEnabled?: boolean;
};

function bindingSentence(binding: ServerBinding): string {
  const parts = [`Connected to ${binding.organizationName} at ${binding.serverOrigin}.`];
  if (binding.projectRoot) parts.push(`Project ${binding.projectRoot}.`);
  if (binding.appId) {
    const lane = [
      binding.channel ? `channel ${binding.channel}` : 'base channel',
      binding.runtimeVersion ? `runtime ${binding.runtimeVersion}` : 'default runtime',
    ].join(', ');
    parts.push(
      `Default app ${binding.appSlug ?? binding.appId} (${binding.appId}); ${lane}. Tools that take appId use it unless you pass another.`,
    );
  }
  if (binding.releaseWritesEnabled === false) {
    parts.push(
      'Release writes are not enabled on this server, so publish and revert will fail — say so before uploading anything.',
    );
  }
  return parts.join(' ');
}

export function serverInstructions(mode: OtaKitMcpMode, binding?: ServerBinding): string {
  const shared =
    'Use OtaKit to inspect and manage Capacitor OTA updates. Start with read-only context and compatibility checks. Before publish, revert, or delete, resolve the exact organization, app, channel, runtime version, bundle, and current state; show the proposed change and obtain explicit user approval. Uploading a bundle does not publish it. Do not treat raw event counts as unique devices.';
  const modeGuidance =
    mode === 'local'
      ? 'This local connection is fixed to one project and organization for its lifetime. Local file operations must stay inside the bound project root.'
      : 'This remote connection is fixed to the authorized organization and cannot read local project files. Inspecting a project, checking native compatibility, and uploading bundles are only available on a local connection started with `otakit mcp` in the repository.';
  // Stating the binding here saves the agent a discovery round-trip on every
  // session, and makes the defaults visible rather than implicit.
  const context = binding ? `\n\n${bindingSentence(binding)}` : '';
  return `${shared}\n\n${modeGuidance}${context}`;
}

export function createOtaKitMcpServer(options: {
  mode: OtaKitMcpMode;
  version: string;
  binding?: ServerBinding;
  adapter: OtaKitToolAdapter;
  authorization?: OtaKitToolAuthorization;
  onError?: (error: unknown, tool: OtaKitToolName) => void;
}): McpServer {
  const server = new McpServer(
    { name: options.mode === 'local' ? 'otakit-local' : 'otakit-remote', version: options.version },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: serverInstructions(options.mode, options.binding),
    },
  );
  const registerTool = server.registerTool.bind(server) as RegisterTool;

  for (const definition of toolDefinitionsForMode(options.mode)) {
    if (options.authorization?.canRegister?.(definition.name) === false) {
      continue;
    }

    registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        // Deliberately no outputSchema. Every tool returns the same envelope
        // whose payload is an untyped JSON value, so declaring it repeated one
        // identical, information-free schema on every tool — 44% of the whole
        // tools/list payload. Bring it back per-tool if `data` ever gets typed.
        annotations: definition.annotations,
      },
      async (input, context) => {
        try {
          await options.authorization?.authorize?.(definition.name, context);
          const output = await options.adapter.invoke(definition.name, input, context);
          const parsed = toolEnvelopeSchema.parse(output);
          return {
            content: [{ type: 'text', text: renderEnvelope(parsed) }],
            structuredContent: parsed,
          };
        } catch (error) {
          options.onError?.(error, definition.name);
          return toolErrorResult(error);
        }
      },
    );
  }

  return server;
}
