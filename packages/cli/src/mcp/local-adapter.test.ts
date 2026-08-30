import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OtaKitApiError } from '../lib/api.js';
import {
  createLocalToolAuthorization,
  LocalOtaKitToolAdapter,
  publishUploadedBundle,
  type LocalMcpConnectionContext,
} from './local-adapter.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'otakit-mcp-test-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'www'));
  await writeFile(
    join(root, 'capacitor.config.json'),
    JSON.stringify({
      appId: 'com.example.app',
      webDir: 'www',
      plugins: {
        OtaKit: {
          appId: '7bb828f1-797c-4d07-8254-068cac664f69',
          channel: 'staging',
          runtimeVersion: 'ios-1',
        },
      },
    }),
  );
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { '@otakit/capacitor-updater': '^1.4.0' } }),
  );
  await writeFile(
    join(root, 'src', 'main.ts'),
    "import { OtaKit } from '@otakit/capacitor-updater';\nvoid OtaKit.notifyAppReady();\n",
  );
  return root;
}

function connection(projectRoot: string): LocalMcpConnectionContext {
  return {
    serverUrl: 'https://console.example.test',
    authToken: 'not-returned',
    authSource: 'env_token',
    organization: { id: 'org-1', name: 'Example' },
    actor: { type: 'user', id: 'user-1', label: 'user@example.test', role: 'owner' },
    capabilities: { analytics: true, organizationKey: false, releaseReliability: true },
    projectRoot,
  };
}

describe('local OtaKit MCP adapter', () => {
  it('returns a reusable uploaded bundle state when publication loses its expected lane', async () => {
    const release = async () => {
      throw new OtaKitApiError(
        409,
        'The release lane changed after preview',
        'STALE_RELEASE_STATE',
      );
    };

    await expect(
      publishUploadedBundle({
        api: { release } as never,
        channel: 'staging',
        bundleId: '7bb828f1-797c-4d07-8254-068cac664f69',
        expectedCurrentReleaseId: null,
        idempotencyKey: 'release-attempt-1',
        compatibilityDecision: 'block',
        options: { autoRevert: true, autoRevertRatePercent: 10, autoRevertMinSample: 25 },
      }),
    ).resolves.toEqual({ publicationStatus: 'not_published_stale_state', release: null });
  });

  it('does not register user-account tools for organization-key connections', async () => {
    const root = await fixture();
    const keyConnection: LocalMcpConnectionContext = {
      ...connection(root),
      actor: { type: 'key', id: 'key-1', label: 'Organization key', role: null },
      capabilities: { analytics: true, organizationKey: true, releaseReliability: true },
    };
    const authorization = createLocalToolAuthorization(keyConnection);

    expect(authorization.canRegister?.('get_context')).toBe(true);
    expect(authorization.canRegister?.('get_account_status')).toBe(false);
    expect(authorization.canRegister?.('list_audit_log')).toBe(false);
  });

  it('inspects bounded project facts without returning source or credentials', async () => {
    const root = await fixture();
    const adapter = new LocalOtaKitToolAdapter(connection(root));

    const result = await adapter.invoke('inspect_project', {}, {} as never);
    expect(result.data).toMatchObject({
      projectRoot: realpathSync(root),
      pluginVersion: '^1.4.0',
      buildOutput: { exists: true },
      notifyAppReady: { found: true, evidencePath: 'src/main.ts' },
    });
    expect(JSON.stringify(result)).not.toContain('not-returned');
    expect(JSON.stringify(result)).not.toContain('void OtaKit.notifyAppReady');
  });

  it('searches bundled docs and refuses paths outside the selected project root', async () => {
    const root = await fixture();
    const adapter = new LocalOtaKitToolAdapter(connection(root));

    const docs = await adapter.invoke('search_docs', { query: 'auto revert' }, {} as never);
    expect(docs.data).toMatchObject({ results: expect.any(Array) });

    await expect(
      adapter.invoke(
        'upload_bundle',
        {
          appId: '7bb828f1-797c-4d07-8254-068cac664f69',
          sourcePath: tmpdir(),
        },
        {} as never,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PROJECT_PATH' });
  });
});
