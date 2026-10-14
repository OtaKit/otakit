import crypto, { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => new Map<string, string>());
const storage = vi.hoisted(() => ({
  putTextObject: vi.fn(async (args: { storageKey: string; body: string }) => {
    files.set(args.storageKey, args.body);
  }),
  deleteStorageObject: vi.fn(async (key: string) => {
    files.delete(key);
  }),
}));
const purge = vi.hoisted(() => vi.fn());

vi.mock('@/lib/storage', () => ({
  buildPublicObjectUrl: (key: string) => `https://cdn.test/${key}`,
  putTextObject: storage.putTextObject,
  deleteStorageObject: storage.deleteStorageObject,
}));
vi.mock('@/lib/cdn-purge', () => ({ purgeCdnUrls: purge }));

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
vi.stubEnv('MANIFEST_SIGNING_DISABLED', '');
vi.stubEnv('MANIFEST_SIGNING_KID', 'config-kid');
vi.stubEnv('MANIFEST_SIGNING_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);

const { db } = await import('@/lib/db');
const { buildConfigPayload } = await import('@/lib/manifest-signing');
const service = await import('./remote-config');

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

type ConfigFileJson = {
  appId: string;
  channel: string | null;
  version: number;
  deleted: boolean;
  valuesJson: string;
  experimentsJson: string | null;
  updatedAt: string;
  signature: { kid: string; sig: string; iat: number; exp: number };
};

function verify(file: ConfigFileJson): boolean {
  const payload = buildConfigPayload(
    file,
    file.signature.kid,
    file.signature.iat,
    file.signature.exp,
  );
  return crypto.verify(
    'sha256',
    Buffer.from(payload, 'utf8'),
    publicKey,
    Buffer.from(file.signature.sig, 'base64url'),
  );
}

databaseDescribe('remote config (PostgreSQL integration)', () => {
  let organizationId: string;
  let appId: string;
  const actor = { actorType: 'user' as const, actorId: 'config-user', actorLabel: 'dev@acme.test' };
  const context = () => ({ organizationId, appId, actor });
  const fileOf = (channel: string | null) => {
    const body = files.get(`config/${appId}/${channel ?? '__base__'}/config.json`);
    return body ? (JSON.parse(body) as ConfigFileJson) : null;
  };

  beforeEach(async () => {
    files.clear();
    vi.clearAllMocks();
    vi.stubEnv('POLAR_ACCESS_TOKEN', '');
    organizationId = randomUUID();
    appId = randomUUID();
    await db.organization.create({
      data: {
        id: organizationId,
        name: 'Config',
        apps: { create: { id: appId, slug: `config.${organizationId}` } },
      },
    });
  });

  afterEach(async () => {
    await db.organization.delete({ where: { id: organizationId } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('publishes a signed file of the exact values, then versions every change', async () => {
    const first = await service.publishRemoteConfig(context(), {
      channel: null,
      values: { checkoutEnabled: true, helpUrl: 'https://example.com/help', banner: 'Zurück ✓' },
      expectedVersion: 0,
      message: '  First   config ',
    });
    expect(first).toMatchObject({
      changed: true,
      warnings: [],
      config: {
        channel: null,
        version: 1,
        status: 'live',
        values: { checkoutEnabled: true },
        message: 'First config',
        updatedBy: 'dev@acme.test',
        usesBaseConfig: false,
        publicationStatus: 'published',
        fileUrl: `https://cdn.test/config/${appId}/__base__/config.json`,
      },
    });
    const file = fileOf(null)!;
    expect(file).toMatchObject({
      appId,
      channel: null,
      version: 1,
      valuesJson:
        '{"checkoutEnabled":true,"helpUrl":"https://example.com/help","banner":"Zurück ✓"}',
      experimentsJson: null,
      signature: { kid: 'config-kid' },
    });
    expect(verify(file)).toBe(true);
    expect(purge).toHaveBeenCalledWith([`https://cdn.test/config/${appId}/__base__/config.json`]);

    const second = await service.patchRemoteConfig(context(), {
      channel: null,
      set: { checkoutEnabled: false, maintenanceBanner: 'Back at 14:00' },
      unset: ['helpUrl'],
      expectedVersion: 1,
    });
    expect(second.config).toMatchObject({
      version: 2,
      values: { checkoutEnabled: false, banner: 'Zurück ✓', maintenanceBanner: 'Back at 14:00' },
    });
    expect(second.config.values).not.toHaveProperty('helpUrl');
    expect(fileOf(null)).toMatchObject({ version: 2 });
    expect(verify(fileOf(null)!)).toBe(true);

    await expect(
      service.getRemoteConfigHistory({ organizationId, appId, channel: null }),
    ).resolves.toMatchObject([
      { version: 2, deleted: false, values: { checkoutEnabled: false } },
      { version: 1, message: 'First config' },
    ]);
  });

  it('rejects a write based on a stale version, and concurrent writes leave one winner', async () => {
    await service.publishRemoteConfig(context(), {
      channel: 'production',
      values: { a: 1 },
      expectedVersion: 0,
    });
    await expect(
      service.publishRemoteConfig(context(), {
        channel: 'production',
        values: { a: 2 },
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({
      code: 'STALE_CONFIG_VERSION',
      status: 409,
      message: 'The config changed: version 1 is the latest',
    });

    const results = await Promise.allSettled(
      [10, 11, 12, 13].map((value) =>
        service.publishRemoteConfig(context(), {
          channel: 'production',
          values: { a: value },
          expectedVersion: 1,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === 'rejected' &&
          (result.reason as { code?: string }).code === 'STALE_CONFIG_VERSION',
      ),
    ).toHaveLength(3);
    const state = await service.getRemoteConfig({ organizationId, appId, channel: 'production' });
    expect(state.version).toBe(2);
    expect(fileOf('production')).toMatchObject({
      version: 2,
      valuesJson: JSON.stringify(state.values),
    });
  });

  it('publishes nothing when the values do not change', async () => {
    await service.publishRemoteConfig(context(), {
      channel: null,
      values: { a: 1 },
      expectedVersion: 0,
    });
    storage.putTextObject.mockClear();
    const again = await service.publishRemoteConfig(context(), {
      channel: null,
      values: { a: 1 },
      expectedVersion: 1,
    });
    expect(again).toMatchObject({ changed: false, config: { version: 1 } });
    expect(storage.putTextObject).not.toHaveBeenCalled();
    await expect(
      db.notificationDelivery.count({ where: { destination: { organizationId } } }),
    ).resolves.toBe(0);
  });

  it('validates values, keys, size and patches', async () => {
    const publish = (values: unknown) =>
      service.publishRemoteConfig(context(), { channel: null, values, expectedVersion: 0 });
    await expect(publish([1, 2])).rejects.toMatchObject({ status: 400 });
    await expect(publish('text')).rejects.toMatchObject({ status: 400 });
    await expect(publish({ 'bad key': 1 })).rejects.toMatchObject({ status: 400 });
    await expect(publish(JSON.parse('{"__proto__": {"admin": true}}'))).rejects.toMatchObject({
      message: '"__proto__" cannot be a config key',
    });
    await expect(publish({ big: 'x'.repeat(17 * 1024) })).rejects.toMatchObject({
      message: expect.stringContaining('the limit is 16,384'),
    });
    await expect(
      service.publishRemoteConfig(context(), {
        channel: '__preview_abc',
        values: {},
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_LANE' });
    await expect(
      service.patchRemoteConfig(context(), {
        channel: null,
        set: { a: 1 },
        unset: ['a'],
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ message: '"a" is both set and unset' });
    await expect(
      service.patchRemoteConfig(context(), { channel: null, expectedVersion: 0 }),
    ).rejects.toMatchObject({ message: 'Pass keys to set or unset' });
  });

  it('refuses channel names that would read as the base channel', async () => {
    for (const channel of ['__base__', 'null', 'NULL']) {
      await expect(
        service.publishRemoteConfig(context(), { channel, values: { a: 1 }, expectedVersion: 0 }),
      ).rejects.toMatchObject({ code: 'INVALID_LANE' });
    }
  });

  it('starts a channel’s own config from the base values when keys are set on it', async () => {
    await service.publishRemoteConfig(context(), {
      channel: null,
      values: { checkoutEnabled: false, helpUrl: 'https://example.com/help' },
      expectedVersion: 0,
    });
    const beta = await service.patchRemoteConfig(context(), {
      channel: 'beta',
      set: { banner: 'Beta build' },
      expectedVersion: 0,
    });
    // The base kill switch still reaches beta devices.
    expect(beta.config).toMatchObject({
      channel: 'beta',
      version: 1,
      values: { checkoutEnabled: false, helpUrl: 'https://example.com/help', banner: 'Beta build' },
    });
    // A replace (PUT) is still exactly what was sent.
    const replaced = await service.publishRemoteConfig(context(), {
      channel: 'beta',
      values: { banner: 'Only this' },
      expectedVersion: 1,
    });
    expect(replaced.config.values).toEqual({ banner: 'Only this' });
  });

  it('signs a file again before its signature expires, with the same version', async () => {
    await service.publishRemoteConfig(context(), {
      channel: null,
      values: { a: 1 },
      expectedVersion: 0,
    });
    const first = fileOf(null)!;
    await db.remoteConfig.updateMany({
      where: { appId },
      data: { syncedAt: new Date(Date.now() - 331 * 24 * 60 * 60 * 1000) },
    });
    storage.putTextObject.mockClear();
    await expect(service.reconcileRemoteConfigFiles()).resolves.toMatchObject({ repaired: 1 });
    expect(storage.putTextObject).toHaveBeenCalledTimes(1);
    expect(fileOf(null)).toMatchObject({ version: 1, valuesJson: first.valuesJson });
    expect(verify(fileOf(null)!)).toBe(true);
    // Fresh files are left alone.
    storage.putTextObject.mockClear();
    await expect(service.reconcileRemoteConfigFiles()).resolves.toMatchObject({ checked: 0 });
  });

  it('warns about values that look like secrets without refusing them', async () => {
    const result = await service.publishRemoteConfig(context(), {
      channel: null,
      values: {
        stripeSecretKey: 'whatever',
        analyticsKey: 'sk_live_abcdefghijklmnop',
        token: 'x',
        helpUrl: 'https://example.com',
      },
      expectedVersion: 0,
    });
    expect(result.changed).toBe(true);
    expect(result.warnings.map((warning) => [warning.key, warning.reason])).toEqual([
      ['stripeSecretKey', 'secret_name'],
      ['analyticsKey', 'secret_value'],
      ['token', 'secret_name'],
    ]);
  });

  it('restores an earlier version as a new one', async () => {
    await service.publishRemoteConfig(context(), {
      channel: null,
      values: { a: 1 },
      expectedVersion: 0,
    });
    await service.publishRemoteConfig(context(), {
      channel: null,
      values: { a: 2 },
      expectedVersion: 1,
    });
    const restored = await service.restoreRemoteConfig(context(), {
      channel: null,
      version: 1,
      expectedVersion: 2,
    });
    expect(restored.config).toMatchObject({
      version: 3,
      values: { a: 1 },
      message: 'Restored version 1',
    });
    await expect(
      service.restoreRemoteConfig(context(), { channel: null, version: 9, expectedVersion: 3 }),
    ).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' });
  });

  it('deletes a channel config so its devices use the base config, and keeps counting versions', async () => {
    await service.publishRemoteConfig(context(), {
      channel: 'beta',
      values: { a: 1 },
      expectedVersion: 0,
    });
    // Experiments (A/B tests) live in the same file and survive a values change.
    const config = await db.remoteConfig.findFirstOrThrow({ where: { appId, channelKey: 'beta' } });
    await db.remoteConfigVersion.updateMany({
      where: { configId: config.id },
      data: { experimentsJson: '[]' },
    });
    await service.publishRemoteConfig(context(), {
      channel: 'beta',
      values: { a: 2 },
      expectedVersion: 1,
    });
    expect(fileOf('beta')).toMatchObject({ version: 2, experimentsJson: '[]' });
    expect(verify(fileOf('beta')!)).toBe(true);

    const deleted = await service.deleteRemoteConfig(context(), {
      channel: 'beta',
      expectedVersion: 2,
      message: 'Back to base',
    });
    expect(deleted.config).toMatchObject({
      version: 3,
      status: 'deleted',
      values: null,
      usesBaseConfig: true,
      fileUrl: `https://cdn.test/config/${appId}/beta/config.json`,
    });
    // A signed deletion, so devices know it is real and refuse version 2 from now on.
    expect(fileOf('beta')).toMatchObject({
      version: 3,
      deleted: true,
      valuesJson: '{}',
      experimentsJson: null,
    });
    expect(verify(fileOf('beta')!)).toBe(true);
    await expect(
      service.deleteRemoteConfig(context(), { channel: 'beta', expectedVersion: 3 }),
    ).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' });
    await expect(
      service.restoreRemoteConfig(context(), { channel: 'beta', version: 3, expectedVersion: 3 }),
    ).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' });

    // A new config continues above the deletion, so devices never see an older number.
    const again = await service.publishRemoteConfig(context(), {
      channel: 'beta',
      values: { a: 3 },
      expectedVersion: 3,
    });
    expect(again.config.version).toBe(4);
    expect(fileOf('beta')).toMatchObject({ version: 4, experimentsJson: null });

    await expect(service.listRemoteConfigs({ organizationId, appId })).resolves.toMatchObject([
      { channel: 'beta', version: 4, status: 'live' },
    ]);
    await expect(
      service.getRemoteConfigHistory({ organizationId, appId, channel: 'beta' }),
    ).resolves.toMatchObject([
      { version: 4 },
      { version: 3, deleted: true, values: null, message: 'Back to base' },
      { version: 2 },
      { version: 1 },
    ]);
  });

  it('keeps named channels for paid plans when billing is on', async () => {
    vi.stubEnv('POLAR_ACCESS_TOKEN', 'polar-test-token');
    await expect(
      service.publishRemoteConfig(context(), {
        channel: 'beta',
        values: { a: 1 },
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'PLAN_REQUIRED', status: 403 });
    await expect(
      service.publishRemoteConfig(context(), {
        channel: null,
        values: { a: 1 },
        expectedVersion: 0,
      }),
    ).resolves.toMatchObject({ changed: true });
    await db.organization.update({ where: { id: organizationId }, data: { planKey: 'starter' } });
    await expect(
      service.publishRemoteConfig(context(), {
        channel: 'beta',
        values: { a: 1 },
        expectedVersion: 0,
      }),
    ).resolves.toMatchObject({ changed: true });
  });

  it('commits the version when the CDN write fails, and the reconcile job writes it', async () => {
    storage.putTextObject.mockRejectedValueOnce(new Error('R2 is down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await service.publishRemoteConfig(context(), {
      channel: null,
      values: { a: 1 },
      expectedVersion: 0,
    });
    expect(result.config).toMatchObject({ version: 1, publicationStatus: 'pending' });
    expect(fileOf(null)).toBeNull();

    await expect(service.reconcileRemoteConfigFiles()).resolves.toMatchObject({ repaired: 1 });
    expect(fileOf(null)).toMatchObject({ version: 1 });
    await expect(
      service.getRemoteConfig({ organizationId, appId, channel: null }),
    ).resolves.toMatchObject({ publicationStatus: 'published' });
  });

  it('records the audit log and queues config.updated with the changed keys', async () => {
    await db.notificationDestination.create({
      data: {
        organizationId,
        type: 'email',
        name: 'Team',
        emailRecipients: { mode: 'owners_admins' },
        events: ['config.updated'],
      },
    });
    await service.publishRemoteConfig(context(), {
      channel: null,
      values: { a: 1, b: 2 },
      expectedVersion: 0,
    });
    await service.publishRemoteConfig(context(), {
      channel: null,
      values: { a: 1, b: 3, c: 4 },
      expectedVersion: 1,
      message: 'Raise b',
    });
    const deliveries = await db.notificationDelivery.findMany({
      where: { destination: { organizationId } },
      orderBy: { createdAt: 'asc' },
    });
    expect(deliveries.map((delivery) => JSON.parse(delivery.payload))).toMatchObject([
      { type: 'config.updated', data: { config: { version: 1, previousVersion: 0 } } },
      {
        type: 'config.updated',
        data: {
          actor: { type: 'user', label: 'dev@acme.test' },
          config: {
            channel: null,
            version: 2,
            previousVersion: 1,
            deleted: false,
            message: 'Raise b',
            changedKeys: { added: ['c'], changed: ['b'], removed: [] },
            values: { a: 1, b: 3, c: 4 },
          },
        },
      },
    ]);
    await expect(
      db.auditLog.findMany({
        where: { organizationId, targetType: 'remote_config' },
        orderBy: { createdAt: 'asc' },
        select: { action: true, metadata: true },
      }),
    ).resolves.toMatchObject([
      { action: 'config.published', metadata: { version: 1, added: ['a', 'b'] } },
      { action: 'config.published', metadata: { version: 2, message: 'Raise b', changed: ['b'] } },
    ]);
  });

  it('only reaches apps of the caller’s organization', async () => {
    const outsider = { organizationId: randomUUID(), appId, actor };
    await expect(
      service.publishRemoteConfig(outsider, { channel: null, values: {}, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'APP_NOT_FOUND', status: 404 });
    await expect(
      service.getRemoteConfig({ organizationId: outsider.organizationId, appId, channel: null }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.getRemoteConfigHistory({
        organizationId: outsider.organizationId,
        appId,
        channel: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
