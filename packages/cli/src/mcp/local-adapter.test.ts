import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkCompatibilityAgainstChannel: vi.fn(),
  findLaneState: vi.fn(),
  runUploadWorkflow: vi.fn(),
}));

vi.mock('../lib/compat-check.js', () => ({
  checkCompatibilityAgainstChannel: mocks.checkCompatibilityAgainstChannel,
  findLaneState: mocks.findLaneState,
}));
vi.mock('../lib/upload-workflow.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/upload-workflow.js')>();
  return { ...original, runUploadWorkflow: mocks.runUploadWorkflow };
});

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
  await mkdir(join(root, 'node_modules'));
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
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

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

  it('refuses paths outside the selected project root', async () => {
    const root = await fixture();
    const adapter = new LocalOtaKitToolAdapter(connection(root));

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

  it('uploads for later review without checking an unrelated release lane', async () => {
    const root = await fixture();
    mocks.runUploadWorkflow.mockResolvedValue({
      bundle: {
        id: 'f32627ca-9e8c-4358-90d8-bde732400081',
        version: '1.0.0',
      },
    });
    const adapter = new LocalOtaKitToolAdapter(connection(root));

    const result = await adapter.invoke(
      'upload_bundle',
      {
        appId: '7bb828f1-797c-4d07-8254-068cac664f69',
        sourcePath: 'www',
        version: '1.0.0',
      },
      {
        mcpReq: {
          _meta: {},
          notify: vi.fn(),
          signal: new AbortController().signal,
        },
      } as never,
    );

    expect(mocks.checkCompatibilityAgainstChannel).not.toHaveBeenCalled();
    expect(mocks.runUploadWorkflow).toHaveBeenCalledOnce();
    expect(result.data).toMatchObject({
      publicationStatus: 'uploaded',
      compatibility: { status: 'not_checked', reason: 'upload_only', findings: [] },
    });
    expect(result.data).not.toHaveProperty('progress');
  });

  it('does not claim the user skipped compatibility when the lane has no baseline', async () => {
    const root = await fixture();
    mocks.checkCompatibilityAgainstChannel.mockResolvedValue({ status: 'skipped', findings: [] });
    mocks.runUploadWorkflow.mockResolvedValue({
      bundle: {
        id: 'f32627ca-9e8c-4358-90d8-bde732400081',
        version: '1.0.0',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          release: { id: 'a320a13e-5f0e-4e2c-bd12-f60c5b63eab2' },
          publicationStatus: 'published',
        }),
      ),
    );
    const adapter = new LocalOtaKitToolAdapter(connection(root));

    const result = await adapter.invoke(
      'upload_and_publish_bundle',
      {
        appId: '7bb828f1-797c-4d07-8254-068cac664f69',
        version: '1.0.0',
        channel: 'new-lane',
        expectedCurrentReleaseId: null,
        idempotencyKey: 'release-attempt-1',
        compatibilityDecision: 'block',
      },
      {
        mcpReq: {
          _meta: {},
          notify: vi.fn(),
          signal: new AbortController().signal,
        },
      } as never,
    );

    expect(result.warnings).toEqual([
      'No native-package baseline was available for this exact release lane.',
    ]);
  });

  it('blocks an upload before it starts when publishing would collide with a rollout', async () => {
    const root = await fixture();
    const stable = {
      id: '0f5c1f55-9d3a-4a36-9b0e-6d7f2b1c0a01',
      channel: 'staging',
      runtimeVersion: 'ios-1',
      bundleId: '5cb6b30f-54c6-434f-8fe3-fc20a345852f',
      bundleVersion: '1.4.1',
      rolloutPercent: 100,
      promotedAt: '2026-09-28T00:00:00.000Z',
      revertedAt: null,
    };
    mocks.findLaneState.mockResolvedValue({
      current: {
        ...stable,
        id: 'a320a13e-5f0e-4e2c-bd12-f60c5b63eab2',
        bundleId: 'f32627ca-9e8c-4358-90d8-bde732400081',
        bundleVersion: '1.4.2',
        rolloutPercent: 10,
      },
      stable,
      complete: true,
    });
    mocks.checkCompatibilityAgainstChannel.mockResolvedValue({
      status: 'compatible',
      findings: [],
    });
    const adapter = new LocalOtaKitToolAdapter(connection(root));

    await expect(
      adapter.invoke(
        'upload_and_publish_bundle',
        {
          appId: '7bb828f1-797c-4d07-8254-068cac664f69',
          version: '1.0.0',
          channel: 'staging',
          expectedCurrentReleaseId: 'a320a13e-5f0e-4e2c-bd12-f60c5b63eab2',
          idempotencyKey: 'release-attempt-1',
        },
        {
          mcpReq: { _meta: {}, notify: vi.fn(), signal: new AbortController().signal },
        } as never,
      ),
    ).rejects.toMatchObject({ code: 'ROLLOUT_IN_PROGRESS' });
    // Native changes are compared with the stable release most devices run.
    expect(mocks.checkCompatibilityAgainstChannel).toHaveBeenCalledWith(
      expect.objectContaining({ baseline: stable }),
    );
    expect(mocks.runUploadWorkflow).not.toHaveBeenCalled();
  });
});
