import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let buildDirectory: string;
let cliBundle: string;

function childEnvironment(overrides: Record<string, string>): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete inherited.OTAKIT_APP_ID;
  delete inherited.OTAKIT_ORGANIZATION_ID;
  delete inherited.OTAKIT_TOKEN;
  return { ...inherited, ...overrides };
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

async function runMcpConnection(options: {
  appId?: string;
  environmentOrganizationId?: string;
  storedOrganizationId: string;
}): Promise<{ requestUrl: string; organizationHeader: string | undefined; toolNames: string[] }> {
  let requestUrl = '';
  let organizationHeader: string | undefined;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requestUrl = request.url ?? '';
    organizationHeader = request.headers['x-otakit-organization-id'] as string | undefined;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        organization: { id: 'org-resolved', name: 'Resolved Organization' },
        actor: { type: 'user', id: 'user-1', label: 'user@example.com', role: 'owner' },
        capabilities: { analytics: true, organizationKey: true, releaseReliability: true },
      }),
    );
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));

  const address = server.address() as AddressInfo;
  const serverUrl = `http://127.0.0.1:${address.port}`;
  const testRoot = await mkdtemp(join(buildDirectory, 'connection-'));
  const projectRoot = join(testRoot, 'project');
  const configRoot = join(testRoot, 'config');
  await mkdir(projectRoot, { recursive: true });
  await mkdir(join(configRoot, 'otakit'), { recursive: true });
  if (options.appId) {
    await writeFile(
      join(projectRoot, 'capacitor.config.json'),
      JSON.stringify({ plugins: { OtaKit: { appId: options.appId } } }),
    );
  }
  await writeFile(
    join(configRoot, 'otakit', 'auth.json'),
    JSON.stringify({
      version: 2,
      profiles: {
        [serverUrl]: {
          token: 'user-access-token',
          userId: 'user-1',
          organizationId: options.storedOrganizationId,
        },
      },
    }),
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliBundle, 'mcp', '--project-root', projectRoot],
    cwd: packageRoot,
    env: childEnvironment({
      OTAKIT_SERVER_URL: serverUrl,
      XDG_CONFIG_HOME: configRoot,
      APPDATA: configRoot,
      ...(options.environmentOrganizationId
        ? { OTAKIT_ORGANIZATION_ID: options.environmentOrganizationId }
        : {}),
    }),
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const client = new Client({ name: 'otakit-cli-e2e', version: '1.0.0' });

  try {
    await client.connect(transport);
    expect(client.getInstructions()).toContain('Uploading a bundle does not publish it.');
    const tools = await client.listTools();
    return {
      requestUrl,
      organizationHeader,
      toolNames: tools.tools.map((tool) => tool.name),
    };
  } catch (error) {
    throw new Error(`MCP child process failed: ${String(error)}\n${stderr}`);
  } finally {
    await client.close().catch(() => undefined);
    await closeServer(server);
    await rm(testRoot, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  buildDirectory = await mkdtemp(join(packageRoot, '.mcp-e2e-'));
  cliBundle = join(buildDirectory, 'cli.mjs');
  await build({
    entryPoints: [join(packageRoot, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    alias: { '@otakit/mcp-core': resolve(packageRoot, '../mcp-core/src/index.ts') },
    outfile: cliBundle,
  });
});

afterAll(async () => {
  await rm(buildDirectory, { recursive: true, force: true });
});

describe('local MCP CLI process', () => {
  it('lets the configured app resolve organization context without leaking the CLI default', async () => {
    const result = await runMcpConnection({
      appId: 'app-project',
      environmentOrganizationId: 'org-environment',
      storedOrganizationId: 'org-default',
    });

    expect(result.requestUrl).toBe('/api/v1/context?appId=app-project');
    expect(result.organizationHeader).toBeUndefined();
    expect(result.toolNames).toContain('get_context');
  });

  it('sends the named CLI default for an app-less project', async () => {
    const result = await runMcpConnection({ storedOrganizationId: 'org-default' });

    expect(result.requestUrl).toBe('/api/v1/context');
    expect(result.organizationHeader).toBe('org-default');
    expect(result.toolNames).toContain('get_context');
  });
});
