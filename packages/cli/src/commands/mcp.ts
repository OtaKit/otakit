import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { createOtaKitMcpServer } from '@otakit/mcp-core';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Command } from 'commander';

import { ApiClient, OtaKitApiError } from '../lib/api.js';
import { resolveConfigSnapshot, resolveOrganizationOverride } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { CLI_VERSION } from '../lib/version.js';
import {
  createLocalToolAuthorization,
  LocalOtaKitToolAdapter,
  type LocalMcpConnectionContext,
} from '../mcp/local-adapter.js';

type McpOptions = {
  projectRoot?: string;
  server?: string;
  appId?: string;
  organizationId?: string;
};

type ConnectionResponse = Pick<
  LocalMcpConnectionContext,
  'organization' | 'actor' | 'capabilities'
>;

export function localMcpContextPath(appId: string | null): string {
  const normalizedAppId = appId?.trim();
  if (!normalizedAppId) return '/api/v1/context';
  return `/api/v1/context?${new URLSearchParams({ appId: normalizedAppId }).toString()}`;
}

export const mcpCommand = new Command('mcp')
  .description('Run the local OtaKit MCP server over stdio')
  .option(
    '--project-root <path>',
    'Project root available to local tools (default: current directory)',
  )
  .option('--server <url>', 'OtaKit console URL override')
  .option('--app-id <id>', 'Default app ID override for project configuration')
  .option('--organization-id <id>', 'Organization override for app-less automation')
  .action(async (options: McpOptions) => {
    await runCommand(async () => {
      const selectedRoot = resolve(options.projectRoot ?? process.cwd());
      let projectRoot: string;
      try {
        projectRoot = realpathSync(selectedRoot);
        if (!statSync(projectRoot).isDirectory()) throw new Error('not a directory');
      } catch {
        throw new CliError(`Project root is not a readable directory: ${selectedRoot}`);
      }
      const snapshot = await resolveConfigSnapshot({
        cwd: projectRoot,
        appId: options.appId,
        serverUrl: options.server,
      });
      if (!snapshot.authToken.value || !snapshot.authSource) {
        throw new CliError('Not authenticated. Run `otakit login`, or set OTAKIT_TOKEN.');
      }

      const explicitOrganizationId = options.organizationId?.trim();
      if (snapshot.appId.value && explicitOrganizationId) {
        throw new CliError(
          '`--organization-id` is only valid for app-less projects. Remove it; the configured app selects its owning organization.',
        );
      }
      const organizationId = snapshot.appId.value
        ? undefined
        : (resolveOrganizationOverride(explicitOrganizationId) ??
          snapshot.authOrganizationId ??
          undefined);
      const probe = new ApiClient(
        {
          appId: snapshot.appId.value ?? '00000000-0000-0000-0000-000000000000',
          serverUrl: snapshot.serverUrl.value,
          authToken: snapshot.authToken.value,
          authSource: snapshot.authSource,
        },
        CLI_VERSION,
        { organizationId },
      );
      let fixed: ConnectionResponse;
      try {
        fixed = await probe.request<ConnectionResponse>(localMcpContextPath(snapshot.appId.value));
      } catch (error) {
        if (error instanceof OtaKitApiError) {
          if (!snapshot.appId.value && organizationId && error.status === 404) {
            throw new CliError(
              'The selected organization is unavailable. Run `otakit organization select`, then restart this MCP server.',
            );
          }
          if (error.nextStep) throw new CliError(`${error.message}\n${error.nextStep}`);
        }
        throw error;
      }
      const connection: LocalMcpConnectionContext = {
        serverUrl: snapshot.serverUrl.value,
        authToken: snapshot.authToken.value,
        authSource: snapshot.authSource,
        organization: fixed.organization,
        actor: fixed.actor,
        capabilities: fixed.capabilities,
        projectRoot,
      };
      const adapter = new LocalOtaKitToolAdapter(connection);
      const handle = serveStdio(
        () =>
          createOtaKitMcpServer({
            mode: 'local',
            version: CLI_VERSION,
            adapter,
            authorization: createLocalToolAuthorization(connection),
            onError: (error, tool) => {
              if (error instanceof Error && error.name === 'PublicToolError') return;
              console.error(`[OtaKit MCP] ${tool} failed`, error);
            },
          }),
        {
          onerror: (error) => console.error('[OtaKit MCP] transport error', error),
        },
      );

      const close = async () => {
        await handle.close();
      };
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
    });
  });
