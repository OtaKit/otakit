import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prepareRelease, publishRelease, reconcilePendingReleaseMutations } from './releases';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;
const migrationName = '20260911120000_rn_delivery_expand';
const prismaRoot = fileURLToPath(new URL('../../prisma/', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const run = promisify(execFile);

databaseDescribe('RN expansion migration (PostgreSQL integration)', () => {
  let admin: PrismaClient;
  let database: PrismaClient;
  let directory: string;
  let databaseUrl: string;
  const schema = `rn_expand_${randomUUID().replaceAll('-', '')}`;

  async function migrate() {
    await run(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', path.join(directory, 'schema.prisma')],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: 60_000,
      },
    );
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    admin = new PrismaClient({ datasourceUrl: url.toString() });
    // A generated, isolated schema lets this test exercise the real migration
    // history without resetting the database used by other integration suites.
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('schema', schema);
    databaseUrl = url.toString();
    database = new PrismaClient({ datasourceUrl: databaseUrl });
    directory = await mkdtemp(path.join(tmpdir(), 'otakit-rn-migration-'));
    await cp(path.join(prismaRoot, 'schema.prisma'), path.join(directory, 'schema.prisma'));
    for (const entry of await readdir(path.join(prismaRoot, 'migrations'))) {
      if (entry === 'migration_lock.toml' || entry < migrationName) {
        await cp(
          path.join(prismaRoot, 'migrations', entry),
          path.join(directory, 'migrations', entry),
          { recursive: true },
        );
      }
    }
    await migrate();
  }, 60_000);

  afterAll(async () => {
    await database?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('preserves legacy data, replay and mixed-writer reads through the actual upgrade', async () => {
    // Raw inserts intentionally use the pre-expansion columns: the generated
    // Prisma client already knows the new fields, but this database does not.
    await database.$executeRaw`
      INSERT INTO "Organization" (id, name, "updatedAt")
      VALUES ('legacy-org', 'Migration fixture', CURRENT_TIMESTAMP)`;
    await database.$executeRaw`
      INSERT INTO "App" (id, "organizationId", slug, "updatedAt")
      VALUES ('legacy-app', 'legacy-org', 'com.example.legacy', CURRENT_TIMESTAMP)`;
    await database.$executeRaw`
      INSERT INTO "Bundle" (id, "appId", version, sha256, "storageKey", size, "runtimeVersion", metadata)
      VALUES
        ('legacy-bundle', 'legacy-app', '1.0.0', ${'a'.repeat(64)}, 'legacy/app.zip', 100, 'ios-1', '{"keep":true}'::jsonb),
        ('null-bundle', 'legacy-app', '1.0.1', ${'b'.repeat(64)}, 'legacy/null.zip', 200, NULL, NULL)`;
    await database.$executeRaw`
      INSERT INTO "Release" (id, "appId", "bundleId", channel, "forceImmediate", "autoRevert", "autoRevertRatePercent", "autoRevertMinSample", "promotedAt", "promotedBy")
      VALUES ('legacy-release', 'legacy-app', 'legacy-bundle', 'production', true, true, 31, 77, '2026-09-01T00:00:00Z', 'legacy@example.com')`;
    await database.$executeRaw`
      INSERT INTO "Release" (id, "appId", "bundleId", "previousBundleId", "revertedAt", "revertedBy")
      VALUES ('null-release', 'legacy-app', 'null-bundle', 'null-bundle', '2026-09-02T00:00:00Z', 'legacy@example.com')`;
    await database.$executeRaw`
      INSERT INTO "UploadSession" (id, "appId", version, "expectedSha256", "expectedSize", "storageKey", "runtimeVersion", "expiresAt")
      VALUES ('legacy-upload', 'legacy-app', '1.0.2', ${'c'.repeat(64)}, 300, 'legacy/pending.zip', 'ios-2', '2099-01-01')`;

    const result = {
      operationId: 'legacy-mutation',
      idempotencyKey: 'legacy-key',
      publicationStatus: 'published',
      release: {
        id: 'legacy-release',
        channel: 'production',
        runtimeVersion: 'ios-1',
        bundleId: 'legacy-bundle',
        bundleVersion: '1.0.0',
        previousBundleId: null,
        previousBundleVersion: null,
        forceImmediate: true,
        autoRevert: true,
        autoRevertRatePercent: 31,
        autoRevertMinSample: 77,
        promotedAt: '2026-09-01T00:00:00.000Z',
        promotedBy: 'legacy@example.com',
        revertedAt: null,
        revertedBy: null,
      },
      previousRelease: null,
    };
    // Frozen pre-expansion request hash: adding target fields to the hash
    // would break replay of this already committed operation.
    await database.$executeRaw`
      INSERT INTO "ReleaseMutation" (id, "organizationId", "actorKey", operation, "idempotencyKey", "requestHash", status, "appId", "releaseId", channel, "runtimeVersion", result, "expiresAt", "updatedAt")
      VALUES ('legacy-mutation', 'legacy-org', 'user:legacy-publisher', 'publish', 'legacy-key',
        '4a035df6ffaeb06dae8235b6c837ca77f823b3f8e2ee7db55c9fcbb0880baa50', 'published',
        'legacy-app', 'legacy-release', 'production', 'ios-1', ${JSON.stringify(result)}::jsonb, '2099-01-01', CURRENT_TIMESTAMP)`;
    await database.$executeRaw`
      INSERT INTO "ReleaseMutation" (id, "organizationId", "actorKey", operation, "idempotencyKey", "requestHash", status, "appId", "releaseId", channel, "runtimeVersion", result, "errorMessage", "expiresAt", "updatedAt")
      VALUES ('pending-mutation', 'legacy-org', 'user:legacy-publisher', 'publish', 'pending-key',
        'old-pending-hash', 'database_committed', 'legacy-app', 'legacy-release', 'production', 'ios-1',
        ${JSON.stringify({ ...result, operationId: 'pending-mutation', idempotencyKey: 'pending-key', publicationStatus: 'manifest_sync_pending' })}::jsonb,
        'CDN unavailable', '2099-01-01', CURRENT_TIMESTAMP)`;

    const addedColumns = {
      App: ['framework'],
      Bundle: ['platform', 'contentHash', 'contentFiles', 'embeddedReceipt', 'baselineBundleId'],
      UploadSession: ['platform', 'contentHash', 'embeddedReceipt', 'baselineBundleId'],
      Release: ['platform', 'runtimeVersion'],
      ReleaseMutation: ['platform'],
    };
    async function snapshot(table: string, omit: string[] = []) {
      const rows = await database.$queryRawUnsafe<Array<{ data: Record<string, unknown> }>>(
        `SELECT to_jsonb(row) AS data FROM "${table}" AS row ORDER BY id`,
      );
      return rows.map(({ data }) =>
        Object.fromEntries(Object.entries(data).filter(([key]) => !omit.includes(key))),
      );
    }
    const before = new Map<string, Awaited<ReturnType<typeof snapshot>>>();
    for (const table of Object.keys(addedColumns)) before.set(table, await snapshot(table));

    await cp(
      path.join(prismaRoot, 'migrations', migrationName),
      path.join(directory, 'migrations', migrationName),
      { recursive: true },
    );
    await migrate();
    // Deploy is repeatable and does not reapply the backfill or rewrite rows.
    await migrate();
    for (const [table, columns] of Object.entries(addedColumns)) {
      expect(await snapshot(table, columns)).toEqual(before.get(table));
    }
    await expect(
      database.app.findUniqueOrThrow({ where: { id: 'legacy-app' } }),
    ).resolves.toMatchObject({ framework: 'capacitor' });
    const bundles = await database.bundle.findMany({ where: { appId: 'legacy-app' } });
    expect(bundles).toHaveLength(2);
    for (const bundle of bundles) {
      expect(bundle).toMatchObject({
        platform: 'cross',
        contentHash: null,
        contentFiles: null,
        embeddedReceipt: null,
        baselineBundleId: null,
      });
    }
    await expect(
      database.uploadSession.findUniqueOrThrow({ where: { id: 'legacy-upload' } }),
    ).resolves.toMatchObject({
      platform: 'cross',
      contentHash: null,
      embeddedReceipt: null,
      baselineBundleId: null,
    });
    await expect(
      database.release.findUniqueOrThrow({ where: { id: 'legacy-release' } }),
    ).resolves.toMatchObject({ platform: 'cross', runtimeVersion: 'ios-1' });
    await expect(
      database.release.findUniqueOrThrow({ where: { id: 'null-release' } }),
    ).resolves.toMatchObject({ platform: 'cross', runtimeVersion: null });

    const syncManifest = vi.fn().mockResolvedValue(undefined);
    await expect(
      publishRelease(
        {
          organizationId: 'legacy-org',
          appId: 'legacy-app',
          bundleId: 'legacy-bundle',
          actor: {
            actorType: 'user',
            actorId: 'legacy-publisher',
            actorLabel: 'legacy@example.com',
          },
          channel: 'production',
          forceImmediate: true,
          autoRevert: true,
          autoRevertRatePercent: 31,
          autoRevertMinSample: 77,
          expectedCurrentReleaseId: null,
          idempotencyKey: 'legacy-key',
        },
        { database, syncManifest },
      ),
    ).resolves.toEqual(result);
    expect(syncManifest).not.toHaveBeenCalled();
    await expect(reconcilePendingReleaseMutations({}, { database, syncManifest })).resolves.toEqual(
      { checked: 1, repaired: 1, pending: 0 },
    );
    expect(syncManifest).toHaveBeenCalledOnce();
    await expect(database.release.count()).resolves.toBe(2);

    // An old server can insert a release after expansion with no snapshot.
    // Reads must still use the bundle's runtime during mixed deployment.
    await database.$executeRaw`
      INSERT INTO "Release" (id, "appId", "bundleId", channel)
      VALUES ('old-writer-release', 'legacy-app', 'legacy-bundle', 'beta')`;
    await expect(
      database.release.findUniqueOrThrow({ where: { id: 'old-writer-release' } }),
    ).resolves.toMatchObject({ platform: 'cross', runtimeVersion: null });
    const prepared = await prepareRelease(
      {
        organizationId: 'legacy-org',
        appId: 'legacy-app',
        bundleId: 'legacy-bundle',
        channel: 'beta',
      },
      { database },
    );
    expect(prepared.currentRelease).toMatchObject({
      id: 'old-writer-release',
      runtimeVersion: 'ios-1',
    });

    // Nullable runtimes must not weaken existing app/version uniqueness.
    await expect(
      database.bundle.create({
        data: {
          appId: 'legacy-app',
          version: '1.0.0',
          runtimeVersion: null,
          sha256: 'd'.repeat(64),
          size: 400,
          storageKey: 'conflict.zip',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // The database enum uses the public spelling; Prisma maps it explicitly.
    // These internal fixtures do not enable RN creation through the product.
    await database.app.create({
      data: {
        id: 'rn-app',
        organizationId: 'legacy-org',
        slug: 'com.example.rn',
        framework: 'react_native',
      },
    });
    await expect(
      database.$queryRaw`SELECT framework::text FROM "App" WHERE id = 'rn-app'`,
    ).resolves.toEqual([{ framework: 'react-native' }]);
    const baseline = await database.bundle.create({
      data: {
        appId: 'rn-app',
        version: 'baseline',
        platform: 'ios',
        runtimeVersion: 'rn-runtime',
        sha256: 'e'.repeat(64),
        storageKey: 'baseline.zip',
        size: 100,
      },
    });
    const upload = await database.uploadSession.create({
      data: {
        appId: 'rn-app',
        version: 'update',
        platform: 'ios',
        runtimeVersion: 'rn-runtime',
        baselineBundleId: baseline.id,
        expectedSha256: 'f'.repeat(64),
        expectedSize: 100,
        storageKey: 'update.zip',
        expiresAt: new Date('2099-01-01'),
      },
    });
    await expect(database.bundle.delete({ where: { id: baseline.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await database.uploadSession.delete({ where: { id: upload.id } });
    await database.bundle.create({
      data: {
        appId: 'rn-app',
        version: 'update',
        platform: 'ios',
        runtimeVersion: 'rn-runtime',
        baselineBundleId: baseline.id,
        sha256: 'f'.repeat(64),
        storageKey: 'update.zip',
        size: 100,
      },
    });
    await expect(database.bundle.delete({ where: { id: baseline.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    // Restrict individual baseline deletion without breaking whole-app cleanup.
    await database.app.delete({ where: { id: 'rn-app' } });
    await expect(database.bundle.count({ where: { appId: 'rn-app' } })).resolves.toBe(0);

    // Final cutover repeats the snapshot backfill for old writers, then widens only RN uniqueness.
    const finalMigration = '20260911180000_rn_target_uniqueness';
    const legacyBundles = await snapshot('Bundle');
    const legacyUploads = await snapshot('UploadSession');
    await database.releaseMutation.update({
      where: { id: 'pending-mutation' },
      data: { status: 'database_committed', errorMessage: 'Retry after cutover' },
    });
    const mutationsBeforeCutover = await snapshot('ReleaseMutation');
    await cp(
      path.join(prismaRoot, 'migrations', finalMigration),
      path.join(directory, 'migrations', finalMigration),
      { recursive: true },
    );
    await migrate();
    await migrate();
    expect(await snapshot('Bundle')).toEqual(legacyBundles);
    expect(await snapshot('UploadSession')).toEqual(legacyUploads);
    expect(await snapshot('ReleaseMutation')).toEqual(mutationsBeforeCutover);
    await expect(
      database.release.findUniqueOrThrow({ where: { id: 'old-writer-release' } }),
    ).resolves.toMatchObject({ platform: 'cross', runtimeVersion: 'ios-1' });
    await expect(reconcilePendingReleaseMutations({}, { database, syncManifest })).resolves.toEqual(
      { checked: 1, repaired: 1, pending: 0 },
    );
    for (const runtimeVersion of [null, 'other-native-runtime']) {
      await expect(
        database.bundle.create({
          data: {
            appId: 'legacy-app',
            version: '1.0.0',
            runtimeVersion,
            sha256: 'd'.repeat(64),
            size: 400,
            storageKey: 'conflict.zip',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    }
    const indexes = await database.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = ${schema} AND tablename = 'Bundle'`;
    expect(
      indexes.find((index) => index.indexname === 'Bundle_cross_version_key')?.indexdef,
    ).toContain("WHERE (platform = 'cross'::");
    expect(indexes.some((index) => index.indexname === 'Bundle_appId_version_key')).toBe(false);
    expect(indexes.some((index) => index.indexname === 'Bundle_target_version_key')).toBe(true);
    await database.app.create({
      data: {
        id: 'rn-cutover',
        organizationId: 'legacy-org',
        slug: 'com.example.cutover',
        framework: 'react_native',
      },
    });
    for (const platform of ['ios', 'android'] as const) {
      await database.bundle.create({
        data: {
          appId: 'rn-cutover',
          version: '1.0.0',
          platform,
          runtimeVersion: 'A'.repeat(43),
          sha256: 'e'.repeat(64),
          size: 100,
          storageKey: `${platform}.zip`,
        },
      });
    }
    await expect(
      database.bundle.create({
        data: {
          appId: 'rn-cutover',
          version: '1.0.0',
          platform: 'ios',
          runtimeVersion: 'A'.repeat(43),
          sha256: 'f'.repeat(64),
          size: 100,
          storageKey: 'duplicate.zip',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(database.bundle.count({ where: { appId: 'rn-cutover' } })).resolves.toBe(2);
  }, 60_000);
});
