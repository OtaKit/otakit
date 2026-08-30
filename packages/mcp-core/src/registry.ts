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
    outputSchema: typeof toolEnvelopeSchema;
    annotations: (typeof OTAKIT_TOOL_CATALOG)[number]['annotations'];
  },
  callback: (input: Record<string, unknown>, context: ServerContext) => Promise<CallToolResult>,
) => unknown;

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

export function createOtaKitMcpServer(options: {
  mode: OtaKitMcpMode;
  version: string;
  adapter: OtaKitToolAdapter;
  authorization?: OtaKitToolAuthorization;
  onError?: (error: unknown, tool: OtaKitToolName) => void;
}): McpServer {
  const server = new McpServer(
    { name: options.mode === 'local' ? 'otakit-local' : 'otakit-remote', version: options.version },
    { capabilities: { tools: { listChanged: false } } },
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
        outputSchema: toolEnvelopeSchema,
        annotations: definition.annotations,
      },
      async (input, context) => {
        try {
          await options.authorization?.authorize?.(definition.name, context);
          const output = await options.adapter.invoke(definition.name, input, context);
          const parsed = toolEnvelopeSchema.parse(output);
          return {
            content: [{ type: 'text', text: parsed.summary }],
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
