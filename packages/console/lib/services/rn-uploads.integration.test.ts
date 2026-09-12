import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  schema: `rn_upload_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  access: vi.fn(),
  objects: new Map<string, string>(),
  put: vi.fn(),
  purge: vi.fn(),
  sizes: new Map<string, number>(),
  presign: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({
  BUNDLE_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  getMaxBundleSize: () =>
    process.env.RUN_RN_UPLOAD_CLI_TESTS === '1' ? 100 * 1024 * 1024 : 100_000,
  createPresignedUpload: storage.presign,
  createPresignedFileUpload: async (key: string) => ({
    presignedUrl: `https://upload.example/${key}`,
    expiresAt: new Date(Date.now() + 3600_000),
  }),
  inspectUploadedObject: async (key: string) => ({ size: storage.sizes.get(key) ?? 0 }),
  statStorageObject: async (key: string) =>
    storage.sizes.has(key) ? { size: storage.sizes.get(key) } : null,
  UploadedObjectNotFoundError: class extends Error {},
  putTextObject: storage.put,
  getTextObject: async (key: string) => storage.objects.get(key),
  buildPublicObjectUrl: (key: string) => `https://cdn.example/${key}`,
  buildFileObjectKey: (appId: string, hash: string) => `files/${appId}/${hash}`,
  listStorageKeys: async (prefix: string) =>
    [...storage.objects.keys()].filter((key) => key.startsWith(prefix)),
  deleteStorageObject: async (key: string) => {
    storage.objects.delete(key);
  },
}));
vi.mock('@/lib/cdn-purge', () => ({ purgeCdnUrls: storage.purge }));
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn(), accessActor: async () => actor }));
vi.mock('@/lib/organization-access', () => ({ resolveOrganizationAccess: storage.access }));
vi.mock('@/lib/release-audit', () => ({ resolveReleaseActor: async () => actor.actorLabel }));
vi.mock('@/lib/release-features', () => ({ isReleaseReliabilityEnabled: () => false }));
vi.mock('@/lib/db', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/unused');
  url.searchParams.set('schema', storage.schema);
  return { db: new PrismaClient({ datasourceUrl: url.toString() }) };
});

import { db } from '@/lib/db';
import { POST as prepareAdoption } from '@/app/api/v1/apps/[appId]/bundles/prepare-baseline-adoption/route';
import { DELETE as deleteBundle } from '@/app/api/v1/apps/[appId]/bundles/[bundleId]/route';
import { GET as listBundles } from '@/app/api/v1/apps/[appId]/bundles/route';
import { getRNBundleSummaries } from './rn-bundle-summaries';
import { POST as initiateZIP } from '@/app/api/v1/apps/[appId]/bundles/initiate/route';
import { POST as initiateDelta } from '@/app/api/v1/apps/[appId]/bundles/initiate-delta/route';
import { POST as finalizeZIP } from '@/app/api/v1/apps/[appId]/bundles/finalize/route';
import { POST as resumeZIP } from '@/app/api/v1/apps/[appId]/bundles/resume-upload/route';
import { POST as finalizeDelta } from '@/app/api/v1/apps/[appId]/bundles/finalize-delta/route';
import { computeFilesHash } from '@/lib/delta-files';
import { prepareRelease, publishRelease } from './releases';
import {
  prepareRNCollection,
  publishRNCollection,
} from '../../../cli/src/lib/react-native/collection';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;
const actor = { actorType: 'key' as const, actorId: 'rn-test-key', actorLabel: 'api-key:rn-test' };
const runtimeVersion = 'A'.repeat(43);
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const run = promisify(execFile);

databaseDescribe('RN upload handlers (PostgreSQL)', () => {
  let admin: PrismaClient;
  let database: PrismaClient;
  let organizationId: string;
  let appId: string;
  const schema = storage.schema;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    admin = new PrismaClient({ datasourceUrl: url.toString() });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('schema', schema);
    await run(
      process.execPath,
      [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        timeout: 60_000,
      },
    );
    database = db;
    vi.stubEnv(
      'MANIFEST_SIGNING_KEY',
      keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    vi.stubEnv('MANIFEST_SIGNING_KID', 'rn-fixture-key');
    vi.stubEnv('MANIFEST_SIGNING_DISABLED', 'false');
  }, 60_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    storage.objects.clear();
    storage.sizes.clear();
    storage.presign.mockImplementation(async (app: string, id: string) => ({
      storageKey: `bundles/${app}/${id}.zip`,
      presignedUrl: `https://upload.example/${id}`,
      expiresAt: new Date(Date.now() + 3600_000),
    }));
    storage.put.mockImplementation(
      async ({ storageKey, body }: { storageKey: string; body: string }) => {
        storage.objects.set(storageKey, body);
      },
    );
    storage.purge.mockResolvedValue(undefined);
    organizationId = randomUUID();
    appId = randomUUID();
    storage.access.mockResolvedValue({
      success: true,
      access: { organizationId, actorType: actor.actorType, actorId: actor.actorId, role: 'owner' },
    });
    await database.organization.create({
      data: {
        id: organizationId,
        name: 'RN release test',
        apps: { create: { id: appId, slug: 'com.example.rn', framework: 'react_native' } },
      },
    });
  });

  afterEach(async () => {
    await database.organization.delete({ where: { id: organizationId } });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });

  type Handler = typeof initiateZIP;
  const call = (handler: Handler, body: unknown) =>
    handler(
      new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ appId }) },
    );

  function declaration(version: string, strategy = 'zip') {
    const files = ['index.bundle', 'otakit-bundle.json'].map((path) => ({
      path,
      sha256: createHash('sha256').update(`${version}:${path}`).digest('hex'),
      size: 10,
      md5: Buffer.alloc(16, 1).toString('base64'),
    }));
    const contentHash = computeFilesHash(files);
    return {
      version,
      platform: 'ios',
      runtimeVersion,
      files,
      contentHash,
      size: 100,
      sha256: createHash('sha256').update(`${version}:${strategy}`).digest('hex'),
      embeddedReceipt: {
        appId,
        framework: 'react-native',
        platform: 'ios',
        runtimeVersion,
        version,
        embeddedContentHash: contentHash,
      },
    };
  }

  async function start(body: Record<string, unknown>, strategy = 'zip') {
    const response = await call(strategy === 'zip' ? initiateZIP : initiateDelta, body);
    expect(response.status).toBe(200);
    const result = await response.json();
    const session = await database.uploadSession.findUniqueOrThrow({
      where: { id: result.uploadId },
    });
    if (strategy === 'zip') storage.sizes.set(session.storageKey, session.expectedSize);
    else
      for (const file of body.files as Array<{ sha256: string; size: number }>) {
        storage.sizes.set(`files/${appId}/${file.sha256}`, file.size);
      }
    return session;
  }

  it('publishes a prepared collection across independent PostgreSQL lanes and replays a lost committed response', async () => {
    const bundleIds: string[] = [];
    for (const platform of ['ios', 'android']) {
      const baselineBody = declaration('baseline');
      baselineBody.platform = platform;
      baselineBody.embeddedReceipt.platform = platform;
      const baselineSession = await start(baselineBody);
      const baseline = await (await call(finalizeZIP, { uploadId: baselineSession.id })).json();
      const otaBody = {
        ...declaration('shared-ota'),
        platform,
        embeddedReceipt: undefined,
        baselineBundleId: baseline.id,
      };
      const otaSession = await start(otaBody);
      bundleIds.push((await (await call(finalizeZIP, { uploadId: otaSession.id })).json()).id);
    }
    const root = await mkdtemp(join(tmpdir(), 'otakit-rn-pg-collection-'));
    try {
      let commits = 0;
      const calls: unknown[] = [];
      const api = {
        prepareRNRelease: async (bundleId: string, channel: string | null) => {
          const prepared = await prepareRelease({
            organizationId,
            appId,
            bundleId,
            channel,
            actor,
          });
          if (
            !prepared.rnIntent ||
            !prepared.platform ||
            !prepared.runtimeVersion ||
            !prepared.baselineBundleId
          )
            throw new Error('Expected RN preparation');
          return {
            ...prepared,
            rnIntent: prepared.rnIntent,
            platform: prepared.platform,
            runtimeVersion: prepared.runtimeVersion,
            baselineBundleId: prepared.baselineBundleId,
          };
        },
        release: async (
          channel: string | null,
          bundleId: string,
          options: {
            idempotencyKey?: string;
            rnIntent?: unknown;
            expectedCurrentReleaseId?: string | null;
          } = {},
        ) => {
          calls.push({ channel, bundleId, ...options });
          const result = await publishRelease({
            organizationId,
            appId,
            bundleId,
            channel,
            actor,
            idempotencyKey: options.idempotencyKey,
            rnIntent: options.rnIntent,
            expectedCurrentReleaseId: options.expectedCurrentReleaseId,
          });
          if (++commits === 2) throw new Error('Response lost after PostgreSQL commit');
          return result;
        },
      };
      const options = {
        api,
        appId,
        organizationId,
        actorKey: `key:${actor.actorId}`,
        serverUrl: 'http://127.0.0.1',
        receiptPath: join(root, 'collection.json'),
      };
      await prepareRNCollection({ ...options, bundleIds, channel: null, forceImmediate: false });
      expect(await database.release.count({ where: { appId } })).toBe(0);
      await expect(publishRNCollection(options)).rejects.toThrow('INCOMPLETE');
      expect(await database.releaseMutation.count({ where: { appId } })).toBe(2);
      const completed = await publishRNCollection(options);
      await publishRNCollection(options);
      expect(completed.targets.every((target) => target.publication.state === 'committed')).toBe(
        true,
      );
      expect(calls).toHaveLength(3);
      expect(calls[1]).toEqual(calls[2]);
      expect(await database.releaseMutation.count({ where: { appId } })).toBe(2);
      expect(await database.release.count({ where: { appId, bundleId: { in: bundleIds } } })).toBe(
        2,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.env.RUN_RN_UPLOAD_CLI_TESTS !== '1')(
    'runs the compiled CLI against PostgreSQL with real archives, response loss and explicit encrypted adoption',
    async () => {
      if (!process.env.RN_OTA_EXPORT)
        throw new Error('Set RN_OTA_EXPORT to an archived OTA export');
      const exportDirectory = resolve(process.env.RN_OTA_EXPORT);
      const exported = JSON.parse(await readFile(join(exportDirectory, 'export.json'), 'utf8'));
      await database.app.delete({ where: { id: appId } });
      appId = exported.appId;
      await database.app.create({
        data: { id: appId, organizationId, slug: 'compiled-cli', framework: 'react_native' },
      });
      const root = await mkdtemp(join(tmpdir(), 'otakit-rn-cli-upload-'));
      const objects = new Map<string, Buffer>();
      const routes: Record<string, Handler> = {
        initiate: initiateZIP,
        'resume-upload': resumeZIP,
        finalize: finalizeZIP,
        'prepare-baseline-adoption': prepareAdoption,
      };
      let loseFinalization = true;
      let putCount = 0;
      let baseUrl: string;
      const server = createServer(async (request, response) => {
        try {
          const url = new URL(request.url!, baseUrl);
          if (url.pathname.startsWith('/objects/')) {
            expect(request.headers.authorization).toBeUndefined();
            const id = url.pathname.slice('/objects/'.length);
            if (request.method === 'PUT') {
              putCount += 1;
              const chunks: Buffer[] = [];
              for await (const chunk of request) chunks.push(Buffer.from(chunk));
              const bytes = Buffer.concat(chunks);
              objects.set(id, bytes);
              const session = await database.uploadSession.findUniqueOrThrow({ where: { id } });
              expect(createHash('sha256').update(bytes).digest('hex')).toBe(session.expectedSha256);
              storage.sizes.set(session.storageKey, bytes.length);
              response.writeHead(200).end();
              return;
            }
            response.writeHead(200).end(objects.get(id));
            return;
          }
          expect(request.headers.authorization).toBe('Bearer local-test-only');
          if (url.pathname === '/api/v1/context') {
            response.setHeader('content-type', 'application/json');
            response.end(
              JSON.stringify({
                organization: { id: organizationId },
                app: { id: appId },
                actor: { type: 'key', id: actor.actorId },
              }),
            );
            return;
          }
          const route = url.pathname.split('/').at(-1)!;
          if (!routes[route]) throw new Error(`Unexpected CLI endpoint: ${url.pathname}`);
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const result = await call(routes[route], JSON.parse(Buffer.concat(chunks).toString()));
          const body = await result.json();
          if (route === 'finalize' && result.ok && loseFinalization) {
            loseFinalization = false;
            response.destroy();
            return;
          }
          if (route === 'prepare-baseline-adoption' && result.ok) {
            const bundle = await database.bundle.findUniqueOrThrow({ where: { id: body.id } });
            const id = bundle.storageKey
              .split('/')
              .at(-1)!
              .replace(/\.zip$/, '');
            body.downloadUrl = `${baseUrl}/objects/${id}?rotating=adoption`;
          }
          response
            .writeHead(result.status, { 'content-type': 'application/json' })
            .end(JSON.stringify(body));
        } catch (error) {
          response.writeHead(500).end(JSON.stringify({ error: String(error) }));
        }
      });
      try {
        await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing local listener');
        baseUrl = `http://127.0.0.1:${address.port}`;
        storage.presign.mockImplementation(async (app: string, id: string) => ({
          storageKey: `bundles/${app}/${id}.zip`,
          presignedUrl: `${baseUrl}/objects/${id}?rotating=upload`,
          expiresAt: new Date(Date.now() + 3600_000),
        }));
        const cli = resolve('../cli/dist/index.js');
        const command = (...args: string[]) =>
          run(process.execPath, [cli, 'rn', ...args, '--server', baseUrl], {
            cwd: root,
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
            env: {
              ...process.env,
              OTAKIT_TOKEN: 'local-test-only',
              OTAKIT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
            },
          });
        const first = join(root, 'first');
        await command('prepare-upload', exportDirectory, '--receipt-dir', first, '--encrypt');
        expect(await database.uploadSession.count({ where: { appId } })).toBe(0);
        await expect(command('upload', first)).rejects.toThrow();
        const interrupted = JSON.parse(await readFile(join(first, 'upload.json'), 'utf8'));
        expect(interrupted.baseline.state).toBe('finalizing');
        expect(await database.bundle.count({ where: { appId } })).toBe(1);
        await command('upload', first);
        await command('upload', first);
        const finished = JSON.parse(await readFile(join(first, 'upload.json'), 'utf8'));
        expect(finished.ota.state).toBe('finalized');
        expect(finished.ota.bundle.baselineBundleId).toBe(finished.baseline.bundle.id);
        expect(await database.uploadSession.count({ where: { appId } })).toBe(2);
        expect(await database.bundle.count({ where: { appId } })).toBe(2);
        expect(await database.release.count({ where: { appId } })).toBe(0);
        const second = join(root, 'second');
        await command('prepare-upload', exportDirectory, '--receipt-dir', second, '--encrypt');
        await expect(command('upload', second)).rejects.toThrow();
        await command('adopt-baseline', second);
        const adopted = JSON.parse(await readFile(join(second, 'upload.json'), 'utf8'));
        expect(adopted.baseline.bundle.id).toBe(finished.baseline.bundle.id);
        expect(adopted.baseline.bundle.sha256).not.toBe(adopted.baseline.declaration.sha256);
        expect(adopted.baseline.adopted).toBe(true);
        expect(await readFile(join(second, 'adoption.json'), 'utf8')).not.toContain('rotating=');
        if (process.env.RN_OTA_COLLECTION_EXPORT) {
          const third = join(root, 'other-platform');
          const collection = join(root, 'upload-collection.json');
          await command(
            'prepare-upload',
            resolve(process.env.RN_OTA_COLLECTION_EXPORT),
            '--receipt-dir',
            third,
            '--encrypt',
          );
          await command(
            'prepare-upload-collection',
            first,
            third,
            '--receipt',
            collection,
            '--encrypt',
          );
          expect(await database.bundle.count({ where: { appId } })).toBe(2);
          const previousPuts = putCount;
          loseFinalization = true;
          await expect(command('upload-collection', collection)).rejects.toThrow(
            '1/2 targets finalized',
          );
          const pending = JSON.parse(await readFile(join(third, 'upload.json'), 'utf8'));
          expect(pending.baseline.state).toBe('finalizing');
          const uploaded = JSON.parse((await command('upload-collection', collection)).stdout);
          expect(
            new Set(uploaded.targets.map((target: { platform: string }) => target.platform)),
          ).toEqual(new Set(['ios', 'android']));
          expect(uploaded.targets[0].otaBundleId).toBe(finished.ota.bundle.id);
          await command('upload-collection', collection);
          expect(putCount).toBe(previousPuts + 2);
          expect(await database.bundle.count({ where: { appId } })).toBe(4);
          expect(await database.release.count({ where: { appId } })).toBe(0);
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
        await rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it('resumes the original RN ZIP declaration without creating a session or extending its lifetime', async () => {
    const body = declaration('baseline');
    const session = await start(body);
    storage.presign.mockClear();
    const response = await call(resumeZIP, { uploadId: session.id, sha256: 'ignored' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: 'pending',
      uploadId: session.id,
      presignedUrl: `https://upload.example/${session.id}`,
      expiresAt: session.expiresAt.toISOString(),
      declaration: {
        ...body,
        files: session.files,
        appId,
        framework: 'react-native',
        strategy: 'zip',
        encryption: null,
        baselineBundleId: null,
      },
    });
    expect(storage.presign).toHaveBeenCalledExactlyOnceWith(appId, session.id, body.size);
    expect(await database.uploadSession.count({ where: { appId } })).toBe(1);
    expect(
      (await database.uploadSession.findUniqueOrThrow({ where: { id: session.id } })).expiresAt,
    ).toEqual(session.expiresAt);
    const finalized = await call(finalizeZIP, { uploadId: session.id });
    const bundle = await finalized.json();
    await database.uploadSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(0) },
    });
    storage.presign.mockClear();
    const replay = await call(resumeZIP, { uploadId: session.id });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ state: 'finalized', uploadId: session.id, bundle });
    expect(storage.presign).not.toHaveBeenCalled();
  });

  it('rejects expired, foreign-app, delta and Capacitor resume attempts without issuing capabilities', async () => {
    const session = await start(declaration('baseline'));
    await database.uploadSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(0) },
    });
    storage.presign.mockClear();
    expect((await call(resumeZIP, { uploadId: session.id })).status).toBe(410);
    expect((await call(resumeZIP, { uploadId: 'foreign-session' })).status).toBe(404);
    const delta = await start(declaration('delta', 'deltas'), 'deltas');
    expect((await call(resumeZIP, { uploadId: delta.id })).status).toBe(404);
    const otherApp = await database.app.create({
      data: { organizationId, slug: 'other.rn', framework: 'react_native' },
    });
    const originalApp = appId;
    appId = otherApp.id;
    expect((await call(resumeZIP, { uploadId: session.id })).status).toBe(404);
    appId = originalApp;
    await database.app.update({ where: { id: appId }, data: { framework: 'capacitor' } });
    expect((await call(resumeZIP, { uploadId: session.id })).status).toBe(400);
    expect(storage.presign).not.toHaveBeenCalled();
  });

  it('rejects changed storage location, invalid input and denied access on resume', async () => {
    const session = await start(declaration('baseline'));
    storage.presign.mockResolvedValue({
      storageKey: 'different',
      presignedUrl: 'https://upload.example/different',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await call(resumeZIP, { uploadId: session.id })).status).toBe(409);
    expect((await call(resumeZIP, {})).status).toBe(400);
    storage.presign.mockClear();
    storage.access.mockResolvedValue({ success: false, status: 403, error: 'Forbidden' });
    expect((await call(resumeZIP, { uploadId: session.id })).status).toBe(403);
    expect(storage.presign).not.toHaveBeenCalled();
  });

  it.each(['zip', 'deltas'])(
    'finalizes a %s baseline and OTA through HTTP and publishes the bound baseline atomically',
    async (strategy) => {
      const finish = strategy === 'zip' ? finalizeZIP : finalizeDelta;
      const baselineSession = await start(declaration('baseline', strategy), strategy);
      const baselineResponse = await call(finish, { uploadId: baselineSession.id });
      expect(baselineResponse.status).toBe(201);
      const baseline = await baselineResponse.json();
      const otaDeclaration = { ...declaration('ota', strategy), embeddedReceipt: undefined };
      const otaSession = await start(
        { ...otaDeclaration, baselineBundleId: baseline.id },
        strategy,
      );
      // Finalize accepts only the immutable declaration saved during initiate.
      const response = await call(finish, {
        uploadId: otaSession.id,
        platform: 'android',
        baselineBundleId: 'wrong',
      });
      expect(response.status).toBe(201);
      const ota = await response.json();
      expect(ota).toMatchObject({
        appId,
        framework: 'react-native',
        platform: 'ios',
        runtimeVersion,
        contentHash: otaDeclaration.contentHash,
        baselineBundleId: baseline.id,
        embeddedReceipt: null,
        strategy,
      });
      const prepared = await prepareRelease({
        organizationId,
        appId,
        bundleId: ota.id,
        channel: null,
        actor,
      });
      const published = await publishRelease({
        organizationId,
        appId,
        bundleId: ota.id,
        channel: null,
        actor,
        expectedCurrentReleaseId: null,
        idempotencyKey: randomUUID(),
        rnIntent: prepared.rnIntent,
      });
      expect(published.publicationStatus).toBe('published');
      expect(published.previousRelease?.bundleId).toBe(baseline.id);
      expect(await database.release.count({ where: { appId } })).toBe(2);
      const retry = await call(finish, { uploadId: otaSession.id });
      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual(ota);
    },
  );

  it('does not accept a caller framework override or missing RN targeting/provenance', async () => {
    const valid = declaration('baseline');
    for (const changed of [
      { ...valid, platform: undefined, framework: 'capacitor' },
      { ...valid, runtimeVersion: undefined },
      { ...valid, contentHash: 'a'.repeat(64) },
      { ...valid, embeddedReceipt: undefined },
      { ...valid, embeddedReceipt: { ...valid.embeddedReceipt, platform: 'android' } },
      { ...valid, baselineBundleId: 'missing' },
      { ...valid, files: [...valid.files, { ...valid.files[0], path: 'OTAKIT-EMBEDDED.JSON' }] },
    ])
      expect((await call(initiateZIP, changed)).status).toBeGreaterThanOrEqual(400);
    expect(await database.uploadSession.count({ where: { appId } })).toBe(0);
    expect(storage.presign).not.toHaveBeenCalled();
  });

  it.each(['zip', 'deltas'])(
    'serializes concurrent %s finalizations and returns one bundle for identical transfers',
    async (strategy) => {
      const finish = strategy === 'zip' ? finalizeZIP : finalizeDelta;
      const body = declaration('baseline', strategy);
      const first = await start(body, strategy);
      const second = await start(body, strategy);
      const responses = await Promise.all([
        call(finish, { uploadId: first.id }),
        call(finish, { uploadId: second.id }),
        call(finish, { uploadId: first.id }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201]);
      const results = await Promise.all(responses.map((response) => response.json()));
      expect(new Set(results.map((bundle) => bundle.id)).size).toBe(1);
      expect(await database.bundle.count({ where: { appId } })).toBe(1);
      expect(await database.uploadSession.count({ where: { appId, status: 'finalized' } })).toBe(2);
    },
  );

  it.each(['transport', 'size', 'content', 'encryption'])(
    'rejects a competing finalized bundle with different %s',
    async (difference) => {
      const original = declaration('baseline');
      const other = structuredClone(original) as Record<string, unknown>;
      if (difference === 'transport') other.sha256 = 'f'.repeat(64);
      if (difference === 'size') other.size = 101;
      if (difference === 'content') {
        other.files = original.files.map((file) => ({ ...file, sha256: 'e'.repeat(64) }));
        other.contentHash = computeFilesHash(other.files as typeof original.files);
      }
      if (difference === 'encryption')
        other.encryption = {
          alg: 'AES-256-GCM',
          kid: '0123456789abcdef',
          nonce: Buffer.alloc(12, 1).toString('base64'),
          wrapNonce: Buffer.alloc(12, 2).toString('base64'),
          wrappedDek: Buffer.alloc(48, 3).toString('base64'),
        };
      other.embeddedReceipt = {
        ...original.embeddedReceipt,
        platform: other.platform,
        runtimeVersion: other.runtimeVersion,
        embeddedContentHash: other.contentHash,
      };
      const first = await start(original);
      const second = await start(other);
      expect((await call(finalizeZIP, { uploadId: first.id })).status).toBe(201);
      const conflict = await call(finalizeZIP, { uploadId: second.id });
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ code: 'RN_UPLOAD_CONFLICT' });
      expect(
        (await database.uploadSession.findUniqueOrThrow({ where: { id: second.id } })).status,
      ).toBe('initiated');
      expect(await database.bundle.count({ where: { appId } })).toBe(1);
    },
  );

  it('rejects wrong endpoints, missing delta objects and modified stored inventories before finalization', async () => {
    const session = await start(declaration('baseline', 'deltas'), 'deltas');
    expect((await call(finalizeZIP, { uploadId: session.id })).status).toBe(400);
    storage.sizes.clear();
    expect((await call(finalizeDelta, { uploadId: session.id })).status).toBe(400);
    await database.uploadSession.update({ where: { id: session.id }, data: { files: [] } });
    expect((await call(finalizeDelta, { uploadId: session.id })).status).toBe(409);
    expect(await database.bundle.count({ where: { appId } })).toBe(0);
  });

  it('rejects expired pending uploads but allows exact finalized replay after expiry', async () => {
    const session = await start(declaration('baseline'));
    await database.uploadSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(0) },
    });
    expect((await call(finalizeZIP, { uploadId: session.id })).status).toBe(410);
    expect(await database.bundle.count({ where: { appId } })).toBe(0);
    const other = await start(declaration('other-baseline'));
    const bundle = await (await call(finalizeZIP, { uploadId: other.id })).json();
    await database.uploadSession.update({
      where: { id: other.id },
      data: { expiresAt: new Date(0) },
    });
    storage.sizes.clear();
    const replay = await call(finalizeZIP, { uploadId: other.id });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(bundle);
  });

  it('rejects delta encryption and does not turn ZIP/delta conflicts into adoption', async () => {
    const body = declaration('baseline');
    const encryption = {
      alg: 'AES-256-GCM',
      kid: '0123456789abcdef',
      nonce: Buffer.alloc(12).toString('base64'),
      wrapNonce: Buffer.alloc(12).toString('base64'),
      wrappedDek: Buffer.alloc(48).toString('base64'),
    };
    expect((await call(initiateDelta, { ...body, encryption })).status).toBe(409);
    const zip = await start(body);
    const delta = await start(body, 'deltas');
    expect((await call(finalizeZIP, { uploadId: zip.id })).status).toBe(201);
    const conflict = await call(finalizeDelta, { uploadId: delta.id });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'RN_UPLOAD_CONFLICT' });
  });

  it('preserves baseline binding when equivalent OTA content is submitted with another baseline', async () => {
    const first = await start(declaration('first-baseline'));
    const second = await start(declaration('second-baseline'));
    const baseA = await (await call(finalizeZIP, { uploadId: first.id })).json();
    const baseB = await (await call(finalizeZIP, { uploadId: second.id })).json();
    const ota = { ...declaration('ota'), embeddedReceipt: undefined };
    const left = await start({
      ...ota,
      baselineBundleId: baseA.id,
      metadata: { platform: 'android', baselineBundleId: baseB.id },
    });
    const right = await start({ ...ota, baselineBundleId: baseB.id });
    const stored = await (await call(finalizeZIP, { uploadId: left.id })).json();
    expect(stored).toMatchObject({ platform: 'ios', baselineBundleId: baseA.id });
    const conflict = await call(finalizeZIP, { uploadId: right.id });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'RN_UPLOAD_CONFLICT' });
  });

  it('rechecks baseline provenance at finalization and retains restrictive foreign keys', async () => {
    const base = await start(declaration('baseline'));
    const baseline = await (await call(finalizeZIP, { uploadId: base.id })).json();
    const ota = { ...declaration('ota'), embeddedReceipt: undefined };
    const pending = await start({ ...ota, baselineBundleId: baseline.id });
    await expect(database.bundle.delete({ where: { id: baseline.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    const deletion = await deleteBundle(
      new NextRequest('http://localhost/api/test', { method: 'DELETE' }),
      {
        params: Promise.resolve({ appId, bundleId: baseline.id }),
      },
    );
    expect(deletion.status).toBe(409);
    expect(await deletion.json()).toMatchObject({ code: 'RN_BUNDLE_IN_USE' });
    expect(storage.sizes.has(base.storageKey)).toBe(true);
    await expect(
      database.bundle.findUnique({ where: { id: baseline.id } }),
    ).resolves.not.toBeNull();
    await database.bundle.update({ where: { id: baseline.id }, data: { platform: 'android' } });
    expect((await call(finalizeZIP, { uploadId: pending.id })).status).toBe(409);
    expect(await database.bundle.count({ where: { appId } })).toBe(1);
  });

  it('stores one version across platform/runtime variants and preserves every summary row', async () => {
    const original = declaration('shared-version');
    for (const [platform, runtime] of [
      ['ios', runtimeVersion],
      ['android', runtimeVersion],
      ['ios', 'B'.repeat(42) + 'A'],
    ]) {
      const session = await start({
        ...original,
        platform,
        runtimeVersion: runtime,
        embeddedReceipt: { ...original.embeddedReceipt, platform, runtimeVersion: runtime },
      });
      expect((await call(finalizeZIP, { uploadId: session.id })).status).toBe(201);
    }
    const summary = await getRNBundleSummaries(appId);
    expect(summary.bundles).toHaveLength(3);
    expect(
      new Set(summary.bundles.map((bundle) => `${bundle.platform}:${bundle.runtimeVersion}`)).size,
    ).toBe(3);
    const filtered = await listBundles(
      new NextRequest(
        `http://localhost/api/test?platform=ios&runtimeVersion=${runtimeVersion}&version=shared-version`,
      ),
      { params: Promise.resolve({ appId }) },
    );
    expect(filtered.status).toBe(200);
    const listed = await filtered.json();
    expect(listed.total).toBe(1);
    expect(listed.bundles).toHaveLength(1);
    expect(listed.bundles[0]).toMatchObject({
      platform: 'ios',
      runtimeVersion,
      version: 'shared-version',
    });
    const invalid = await listBundles(
      new NextRequest('http://localhost/api/test?runtimeVersion=invalid'),
      { params: Promise.resolve({ appId }) },
    );
    expect(invalid.status).toBe(400);
    await expect(
      database.bundle.create({
        data: {
          appId,
          version: 'invalid-runtime',
          platform: 'ios',
          sha256: 'a'.repeat(64),
          size: 1,
          storageKey: 'invalid',
        },
      }),
    ).rejects.toThrow();
  });

  it('prepares baseline adoption without rewriting the existing representation or weakening policy', async () => {
    const body = declaration('baseline');
    const session = await start(body);
    const baseline = await (await call(finalizeZIP, { uploadId: session.id })).json();
    const declarationForAdoption = { ...body, strategy: 'zip', encryptionKid: null };
    const response = await call(prepareAdoption, declarationForAdoption);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: baseline.id,
      sha256: baseline.sha256,
      verificationRequired: true,
      encryption: null,
    });
    expect(
      (
        await call(prepareAdoption, {
          ...declarationForAdoption,
          encryptionKid: '0123456789abcdef',
        })
      ).status,
    ).toBe(409);
    storage.sizes.clear();
    expect((await call(prepareAdoption, declarationForAdoption)).status).toBe(409);
    expect(await database.bundle.count({ where: { appId } })).toBe(1);
  });

  it.each(['zip', 'deltas'])(
    'preserves Capacitor %s response and version-conflict recovery for pre-migration-shaped sessions',
    async (strategy) => {
      await database.app.update({ where: { id: appId }, data: { framework: 'capacitor' } });
      const files = [
        {
          path: 'index.html',
          sha256: 'a'.repeat(64),
          size: 10,
          md5: Buffer.alloc(16).toString('base64'),
        },
      ];
      const original = { version: 'legacy', size: 100, sha256: 'b'.repeat(64), files };
      const first = await start(original, strategy);
      const second = await start(
        {
          ...original,
          sha256: 'c'.repeat(64),
          files: files.map((file) => ({ ...file, sha256: 'd'.repeat(64) })),
        },
        strategy,
      );
      const finish = strategy === 'zip' ? finalizeZIP : finalizeDelta;
      const firstResponse = await call(finish, { uploadId: first.id });
      expect(firstResponse.status).toBe(201);
      const bundle = await firstResponse.json();
      const legacyList = await listBundles(
        new NextRequest(
          'http://localhost/api/test?platform=android&runtimeVersion=ignored-for-capacitor',
        ),
        { params: Promise.resolve({ appId }) },
      );
      expect(legacyList.status).toBe(200);
      const legacyRows = await legacyList.json();
      expect(legacyRows.total).toBe(1);
      expect(legacyRows.bundles[0]).not.toHaveProperty('platform');
      const conflict = await call(finish, { uploadId: second.id });
      expect(conflict.status).toBe(200);
      expect(await conflict.json()).toEqual(bundle);
      expect(Object.keys(bundle).sort()).toEqual(
        [
          'id',
          'version',
          'sha256',
          'size',
          'runtimeVersion',
          'createdAt',
          ...(strategy === 'deltas' ? ['strategy'] : []),
        ].sort(),
      );
      const persisted = await database.bundle.findUniqueOrThrow({ where: { id: bundle.id } });
      expect(persisted).toMatchObject({
        platform: 'cross',
        runtimeVersion: null,
        contentHash: null,
        contentFiles: null,
        baselineBundleId: null,
        embeddedReceipt: null,
      });
    },
  );
});
