import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OTAKIT_TOOL_CATALOG, toolDefinitionsForMode } from './catalog';
import { OTAKIT_TOOL_NAMES, PublicToolError, toolEnvelope, type OtaKitToolName } from './contracts';
import { createOtaKitMcpServer } from './registry';

describe('OtaKit MCP tool catalog', () => {
  it('defines every planned tool exactly once and keeps local/remote mode boundaries', () => {
    expect(OTAKIT_TOOL_CATALOG).toHaveLength(20);
    expect(new Set(OTAKIT_TOOL_CATALOG.map((tool) => tool.name)).size).toBe(20);
    expect(OTAKIT_TOOL_CATALOG.map((tool) => tool.name)).toEqual([...OTAKIT_TOOL_NAMES]);
    expect(toolDefinitionsForMode('local')).toHaveLength(20);
    expect(toolDefinitionsForMode('remote')).toHaveLength(16);
    expect(toolDefinitionsForMode('remote').map((tool) => tool.name)).not.toContain(
      'inspect_project',
    );
  });

  it('marks destructive and reviewed release writes accurately', () => {
    const byName = new Map(OTAKIT_TOOL_CATALOG.map((tool) => [tool.name, tool]));
    expect(byName.get('delete_bundle')?.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(byName.get('revert_release')?.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(byName.get('publish_release')?.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(byName.get('upload_bundle')?.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(byName.get('upload_and_publish_bundle')?.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(
      byName.get('publish_release')?.inputSchema.safeParse({
        appId: '7bb828f1-797c-4d07-8254-068cac664f69',
        bundleId: 'f32627ca-9e8c-4358-90d8-bde732400081',
        channel: null,
        expectedCurrentReleaseId: null,
        idempotencyKey: 'release-attempt-1',
        autoRevert: true,
        autoRevertRatePercent: 20,
        autoRevertMinSample: 50,
      }).success,
    ).toBe(true);
    expect(
      byName.get('get_release_state')?.inputSchema.safeParse({
        appId: '7bb828f1-797c-4d07-8254-068cac664f69',
        channel: 'base',
        runtimeVersion: null,
      }).success,
    ).toBe(true);
  });

  it('keeps upload-only inputs separate from release approval and enforces API bounds', () => {
    const byName = new Map(OTAKIT_TOOL_CATALOG.map((tool) => [tool.name, tool]));
    const appId = '7bb828f1-797c-4d07-8254-068cac664f69';

    expect(
      byName.get('upload_bundle')?.inputSchema.parse({
        appId,
        compatibilityDecision: 'skip',
      }),
    ).not.toHaveProperty('compatibilityDecision');
    expect(
      byName.get('upload_and_publish_bundle')?.inputSchema.parse({
        appId,
        channel: null,
        expectedCurrentReleaseId: null,
        idempotencyKey: 'release-attempt-1',
        compatibilityDecision: 'skip',
      }),
    ).toHaveProperty('compatibilityDecision', 'skip');
    expect(
      byName.get('upload_bundle')?.inputSchema.safeParse({ appId, version: 'v'.repeat(65) })
        .success,
    ).toBe(false);
    expect(byName.get('create_app')?.inputSchema.safeParse({ slug: 'bad slug' }).success).toBe(
      false,
    );
  });
});

describe('OtaKit MCP registry transport', () => {
  const closeCallbacks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  });

  async function connect(
    options: {
      mode?: 'local' | 'remote';
      invoke?: (
        name: OtaKitToolName,
      ) => ReturnType<typeof toolEnvelope> | Promise<ReturnType<typeof toolEnvelope>>;
      authorize?: (name: OtaKitToolName) => void;
    } = {},
  ) {
    const invoke = vi.fn(
      options.invoke ?? ((name: OtaKitToolName) => toolEnvelope(`Called ${name}`, { tool: name })),
    );
    const server = createOtaKitMcpServer({
      mode: options.mode ?? 'remote',
      version: 'test',
      adapter: {
        invoke: async (name) => invoke(name),
      },
      authorization: options.authorize
        ? { authorize: async (name) => options.authorize?.(name) }
        : undefined,
    });
    const client = new Client({ name: 'otakit-test-client', version: 'test' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeCallbacks.push(async () => {
      await client.close();
      await server.close();
    });
    return { client, invoke };
  }

  it('negotiates, lists the remote catalog, validates input, and returns structured content', async () => {
    const { client, invoke } = await connect();
    const listed = await client.listTools();
    expect(client.getInstructions()).toContain('Uploading a bundle does not publish it.');
    expect(client.getInstructions()).toContain('remote connection');
    expect(listed.tools).toHaveLength(16);
    expect(listed.tools.find((tool) => tool.name === 'get_context')).toMatchObject({
      annotations: { readOnlyHint: true },
    });

    const result = await client.callTool({ name: 'get_context', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      summary: 'Called get_context',
      data: { tool: 'get_context' },
      warnings: [],
    });
    expect(result.content).toHaveLength(1);
    const text = result.content[0];
    expect(text?.type).toBe('text');
    // The summary leads; the payload follows as JSON for anything parsing it.
    const rendered = text?.type === 'text' ? text.text : '';
    expect(rendered.split('\n')[0]).toBe('Called get_context');
    expect(JSON.parse(rendered.split('\n')[1])).toEqual({ tool: 'get_context' });

    // No outputSchema: it was one identical, information-free schema per tool.
    expect(listed.tools.every((tool) => tool.outputSchema === undefined)).toBe(true);
    expect(invoke).toHaveBeenCalledWith('get_context');

    const invalid = await client.callTool({ name: 'list_apps', arguments: { limit: 0 } });
    expect(invalid).toMatchObject({ isError: true });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('returns safe public tool errors without putting them in successful data', async () => {
    const { client } = await connect({
      authorize: () => {
        throw new PublicToolError(
          'INSUFFICIENT_SCOPE',
          'This connection cannot publish releases',
          'Reconnect with otakit:release:write.',
        );
      },
    });

    const result = await client.callTool({ name: 'get_context', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          code: 'INSUFFICIENT_SCOPE',
          message: 'This connection cannot publish releases',
          nextStep: 'Reconnect with otakit:release:write.',
        }),
      },
    ]);
  });
});
