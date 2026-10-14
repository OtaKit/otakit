import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pipeQuery, registerClickHouseAdapters } from './pipe-sql-harness';

// Error tracking pipes, executed in SQLite (see pipe-sql-harness.ts). Every
// insert runs the materialization on its own block, like ClickHouse does, so
// the daily rollup holds unmerged rows the endpoints must merge.

const RAW_COLUMNS = [
  'event_id',
  'received_at',
  'occurred_at',
  'app_id',
  'platform',
  'release_id',
  'bundle_version',
  'channel',
  'runtime_version',
  'native_build',
  'os_version',
  'sdk_version',
  'session_id',
  'fingerprint',
  'error_name',
  'message',
  'normalized_message',
  'top_frame',
  'stack',
  'route',
  'handled',
  'mechanism',
  'tags',
] as const;

let db: DatabaseSync;

function addError(
  eventId: string,
  receivedAt: string,
  overrides: Partial<Record<(typeof RAW_COLUMNS)[number], string | number | null>> = {},
) {
  const row: Record<string, string | number | null> = {
    event_id: eventId,
    received_at: receivedAt,
    occurred_at: receivedAt,
    app_id: 'app-a',
    platform: 'ios',
    release_id: 'release-a',
    bundle_version: '1.0.0',
    channel: 'production',
    runtime_version: null,
    native_build: '42',
    os_version: '18.2',
    sdk_version: '3.4.0',
    session_id: 'session-1',
    fingerprint: 'fp-a',
    error_name: 'TypeError',
    message: `boom ${eventId}`,
    normalized_message: 'boom <id>',
    top_frame: 'computeTotal (assets/index.js)',
    stack: 'computeTotal@capacitor://localhost/assets/index-1.js:1:1',
    route: '/checkout',
    handled: 0,
    mechanism: 'onerror',
    tags: '{}',
    ...overrides,
  };
  const values = RAW_COLUMNS.map((column) => row[column] ?? null);
  const placeholders = RAW_COLUMNS.map(() => '?').join(', ');
  for (const table of ['app_errors_raw', 'app_errors_block']) {
    db.prepare(`INSERT INTO ${table} (${RAW_COLUMNS.join(', ')}) VALUES (${placeholders})`).run(
      ...values,
    );
  }
  const rollup = pipeQuery('app_error_daily_mv', {}, 'materializations').replace(
    'FROM app_errors_raw',
    'FROM app_errors_block',
  );
  db.exec(`INSERT INTO app_error_daily ${rollup}`);
  db.exec('DELETE FROM app_errors_block');
}

const query = (name: string, parameters: Record<string, string> = {}) =>
  db.prepare(pipeQuery(name, parameters)).all();

const ms = (iso: string) => Date.parse(iso);

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  const rawSchema = RAW_COLUMNS.join(', ');
  db.exec(`
    CREATE TABLE app_errors_raw (${rawSchema});
    CREATE TABLE app_errors_block (${rawSchema});
    CREATE TABLE device_events_raw (
      event_id, app_id, action, release_id, native_sdk_version, received_at
    );
    CREATE TABLE app_error_daily (
      bucket_date, app_id, fingerprint, release_id, channel, platform, error_name,
      normalized_message, top_frame, first_seen, last_seen, last_occurred,
      event_ids_uniq_exact_state
    );
  `);
  registerClickHouseAdapters(db);
});

afterEach(() => db.close());

describe('error_activity', () => {
  it('returns recently active issues with lifetime totals', () => {
    addError('e1', '2026-09-01T10:00:00.000Z', { release_id: 'release-old' });
    addError('e2', '2026-10-13T10:00:00.000Z');
    addError('e2', '2026-10-13T10:05:00.000Z'); // a device retry
    addError('e3', '2026-10-14T09:00:00.000Z', { occurred_at: '2026-10-14T08:00:00.000Z' });
    addError('quiet', '2026-09-20T10:00:00.000Z', { fingerprint: 'fp-quiet' });
    addError('other-app', '2026-10-14T09:00:00.000Z', { app_id: 'app-b' });
    addError('no-release', '2026-10-14T09:30:00.000Z', {
      fingerprint: 'fp-b',
      release_id: null,
      top_frame: null,
    });

    const rows = query('error_activity', { from_date: '2026-10-13' });
    expect(rows).toEqual([
      {
        app_id: 'app-a',
        fingerprint: 'fp-b',
        error_name: 'TypeError',
        normalized_message: 'boom <id>',
        top_frame: '',
        first_release_id: '',
        first_seen_ms: ms('2026-10-14T09:30:00.000Z'),
        last_seen_ms: ms('2026-10-14T09:30:00.000Z'),
        last_occurred_ms: ms('2026-10-14T09:30:00.000Z'),
        events: 1,
      },
      {
        app_id: 'app-a',
        fingerprint: 'fp-a',
        error_name: 'TypeError',
        normalized_message: 'boom <id>',
        top_frame: 'computeTotal (assets/index.js)',
        first_release_id: 'release-old',
        first_seen_ms: ms('2026-09-01T10:00:00.000Z'),
        last_seen_ms: ms('2026-10-14T09:00:00.000Z'),
        last_occurred_ms: ms('2026-10-14T08:00:00.000Z'),
        events: 3,
      },
      expect.objectContaining({ app_id: 'app-b', fingerprint: 'fp-a', events: 1 }),
    ]);
  });

  it('keeps totals after raw errors expire', () => {
    addError('e1', '2026-09-01T10:00:00.000Z');
    addError('e2', '2026-10-14T10:00:00.000Z');
    db.exec('DELETE FROM app_errors_raw');
    expect(query('error_activity', { from_date: '2026-10-14' })).toEqual([
      expect.objectContaining({ fingerprint: 'fp-a', events: 2 }),
    ]);
  });
});

describe('error_groups', () => {
  const groups = (parameters: Record<string, string> = {}) =>
    query('error_groups', { app_id: 'app-a', from_ts: '2026-10-01T00:00:00.000Z', ...parameters });

  beforeEach(() => {
    addError('a1', '2026-10-10T10:00:00.000Z', { session_id: 's1', platform: 'android' });
    addError('a1', '2026-10-10T10:01:00.000Z', { session_id: 's1', platform: 'android' });
    addError('a2', '2026-10-11T10:00:00.000Z', { session_id: 's2', release_id: 'release-b' });
    addError('a3', '2026-10-12T10:00:00.000Z', { session_id: 's2', message: 'latest' });
    addError('b1', '2026-10-13T10:00:00.000Z', {
      fingerprint: 'fp-b',
      channel: null,
      handled: 1,
      mechanism: 'manual',
    });
    addError('old', '2026-09-30T23:59:59.999Z');
    addError('other-app', '2026-10-12T10:00:00.000Z', { app_id: 'app-b' });
  });

  it('counts unique events, sessions and releases per issue', () => {
    expect(groups()).toEqual([
      {
        fingerprint: 'fp-a',
        error_name: 'TypeError',
        normalized_message: 'boom <id>',
        top_frame: 'computeTotal (assets/index.js)',
        last_message: 'latest',
        events: 3,
        sessions: 2,
        releases: 2,
        any_handled: 0,
        all_handled: 0,
        platforms: '["android","ios"]',
        first_seen_ms: ms('2026-10-10T10:00:00.000Z'),
        last_seen_ms: ms('2026-10-12T10:00:00.000Z'),
      },
      expect.objectContaining({ fingerprint: 'fp-b', events: 1, any_handled: 1, all_handled: 1 }),
    ]);
  });

  it('sorts by events or by last seen, and limits', () => {
    expect(groups({ sort: 'last_seen' }).map((row) => row.fingerprint)).toEqual(['fp-b', 'fp-a']);
    expect(groups({ limit: '1' }).map((row) => row.fingerprint)).toEqual(['fp-a']);
  });

  it('filters by time, platform, release, channel and fingerprints', () => {
    const events = (parameters: Record<string, string>) =>
      Object.fromEntries(groups(parameters).map((row) => [row.fingerprint, row.events]));
    expect(events({ from_ts: '2026-09-30T00:00:00.000Z' })).toEqual({ 'fp-a': 4, 'fp-b': 1 });
    expect(events({ to_ts: '2026-10-11T10:00:00.000Z' })).toEqual({ 'fp-a': 1 });
    expect(events({ platform: 'android' })).toEqual({ 'fp-a': 1 });
    expect(events({ release_id: 'release-b' })).toEqual({ 'fp-a': 1 });
    expect(events({ channel: 'production', channel_is_null: '0' })).toEqual({ 'fp-a': 3 });
    expect(events({ channel_is_null: '1' })).toEqual({ 'fp-b': 1 });
    expect(events({ fingerprints: 'fp-b,fp-x' })).toEqual({ 'fp-b': 1 });
  });
});

describe('error_group_samples', () => {
  it('returns the latest events of the issue once each, at their first receipt', () => {
    addError('s1', '2026-10-10T10:00:00.000Z');
    addError('s2', '2026-10-11T10:00:00.000Z');
    addError('s1', '2026-10-12T10:00:00.000Z'); // retried later
    addError('other', '2026-10-13T10:00:00.000Z', { fingerprint: 'fp-b' });
    const samples = query('error_group_samples', { app_id: 'app-a', fingerprint: 'fp-a' });
    expect(samples.map((row) => [row.event_id, row.received_at_ms])).toEqual([
      ['s2', ms('2026-10-11T10:00:00.000Z')],
      ['s1', ms('2026-10-10T10:00:00.000Z')],
    ]);
    expect(samples[0]).toMatchObject({
      message: 'boom s2',
      stack: 'computeTotal@capacitor://localhost/assets/index-1.js:1:1',
      route: '/checkout',
      os_version: '18.2',
      tags: '{}',
    });
    expect(
      query('error_group_samples', { app_id: 'app-a', fingerprint: 'fp-a', limit: '1' }),
    ).toHaveLength(1);
  });
});

describe('error_group_breakdown', () => {
  it('ranks releases, platforms, OS versions, builds, channels and routes', () => {
    addError('b1', '2026-10-10T10:00:00.000Z');
    addError('b2', '2026-10-10T11:00:00.000Z', {
      release_id: 'release-b',
      bundle_version: '1.1.0',
      platform: 'android',
      os_version: '15',
      route: null,
    });
    addError('b3', '2026-10-10T12:00:00.000Z', {
      release_id: 'release-b',
      bundle_version: '1.1.0',
    });
    addError('b3', '2026-10-10T12:00:01.000Z', {
      release_id: 'release-b',
      bundle_version: '1.1.0',
    });
    const rows = query('error_group_breakdown', { app_id: 'app-a', fingerprint: 'fp-a' });
    const of = (dimension: string) =>
      rows
        .filter((row) => row.dimension === dimension)
        .map((row) => [row.value, row.label, row.events]);
    expect(of('release')).toEqual([
      ['release-b', '1.1.0', 2],
      ['release-a', '1.0.0', 1],
    ]);
    expect(of('platform')).toEqual([
      ['ios', '', 2],
      ['android', '', 1],
    ]);
    expect(of('os_version')).toEqual([
      ['ios 18.2', '', 2],
      ['android 15', '', 1],
    ]);
    expect(of('native_build')).toEqual([
      ['ios 42', '', 2],
      ['android 42', '', 1],
    ]);
    expect(of('channel')).toEqual([['production', '', 3]]);
    expect(of('route')).toEqual([
      ['/checkout', '', 2],
      ['', '', 1],
    ]);
  });
});

describe('error_group_buckets', () => {
  it('counts events per day or hour for the requested issues', () => {
    addError('h1', '2026-10-10T10:15:00.000Z');
    addError('h2', '2026-10-10T10:45:00.000Z');
    addError('h3', '2026-10-10T11:05:00.000Z');
    addError('h4', '2026-10-11T00:00:00.000Z', { fingerprint: 'fp-b' });
    addError('h5', '2026-10-11T00:00:00.000Z', { fingerprint: 'fp-c' });
    const buckets = (parameters: Record<string, string>) =>
      query('error_group_buckets', {
        app_id: 'app-a',
        fingerprints: 'fp-a,fp-b',
        from_ts: '2026-10-10T00:00:00.000Z',
        to_ts: '2026-10-12T00:00:00.000Z',
        ...parameters,
      }).map((row) => [row.fingerprint, row.bucket_start, row.events]);
    const seconds = (iso: string) => ms(iso) / 1000;
    expect(buckets({})).toEqual([
      ['fp-a', seconds('2026-10-10T00:00:00.000Z'), 3],
      ['fp-b', seconds('2026-10-11T00:00:00.000Z'), 1],
    ]);
    expect(buckets({ hourly: '1', fingerprints: 'fp-a' })).toEqual([
      ['fp-a', seconds('2026-10-10T10:00:00.000Z'), 2],
      ['fp-a', seconds('2026-10-10T11:00:00.000Z'), 1],
    ]);
  });
});

describe('release_error_counts', () => {
  it('counts events and issues per release from the rollup', () => {
    addError('r1', '2026-09-01T10:00:00.000Z');
    addError('r2', '2026-10-01T10:00:00.000Z', { fingerprint: 'fp-b' });
    addError('r2', '2026-10-02T10:00:00.000Z', { fingerprint: 'fp-b' });
    addError('r3', '2026-10-01T10:00:00.000Z', { release_id: 'release-b' });
    addError('r4', '2026-10-01T10:00:00.000Z', { release_id: null });
    db.exec('DELETE FROM app_errors_raw');
    expect(
      query('release_error_counts', { app_id: 'app-a', release_ids: 'release-a,release-b' }),
    ).toEqual([
      { release_id: 'release-a', events: 2, issues: 2 },
      { release_id: 'release-b', events: 1, issues: 1 },
    ]);
  });
});

describe('app_error_usage', () => {
  it('counts error events per app in a date range', () => {
    addError('u0', '2026-09-30T23:59:59.999Z');
    addError('u1', '2026-10-01T00:00:00.000Z');
    addError('u2', '2026-10-31T23:59:59.999Z', { fingerprint: 'fp-b' });
    addError('u3', '2026-11-01T00:00:00.000Z');
    addError('u4', '2026-10-15T00:00:00.000Z', { app_id: 'app-b' });
    const usage = (parameters: Record<string, string> = {}) =>
      query('app_error_usage', {
        start_date: '2026-10-01',
        end_date_exclusive: '2026-11-01',
        ...parameters,
      });
    expect(usage()).toEqual([
      { app_id: 'app-a', events: 2 },
      { app_id: 'app-b', events: 1 },
    ]);
    expect(usage({ app_ids: 'app-b,app-c' })).toEqual([{ app_id: 'app-b', events: 1 }]);
  });
});

describe('error_issue_releases', () => {
  it('returns the releases an issue happened on since a day, with the latest times', () => {
    addError('a1', '2026-10-10T10:00:00.000Z', { release_id: 'release-a' });
    addError('a2', '2026-10-12T10:00:00.000Z', {
      release_id: 'release-a',
      occurred_at: '2026-10-12T09:00:00.000Z',
    });
    addError('b1', '2026-10-13T10:00:00.000Z', { release_id: null });
    addError('other', '2026-10-13T10:00:00.000Z', { fingerprint: 'fp-b', release_id: 'release-c' });
    const releases = (from_date: string) =>
      query('error_issue_releases', { app_id: 'app-a', fingerprint: 'fp-a', from_date });
    expect(releases('1970-01-01')).toEqual([
      {
        release_id: '',
        last_seen_ms: ms('2026-10-13T10:00:00.000Z'),
        last_occurred_ms: ms('2026-10-13T10:00:00.000Z'),
        events: 1,
      },
      {
        release_id: 'release-a',
        last_seen_ms: ms('2026-10-12T10:00:00.000Z'),
        last_occurred_ms: ms('2026-10-12T09:00:00.000Z'),
        events: 2,
      },
    ]);
    expect(releases('2026-10-13').map((row) => row.release_id)).toEqual(['']);
  });
});

describe('release_capable_applies', () => {
  it('counts applies only from devices that can report errors', () => {
    const add = (id: string, release: string | null, sdk: string | null, action = 'applied') =>
      db
        .prepare('INSERT INTO device_events_raw VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, 'app-a', action, release, sdk, '2026-10-14T10:00:00.000Z');
    add('e1', 'release-a', '3.4.0');
    add('e1', 'release-a', '3.4.0'); // a retry
    add('e2', 'release-a', '3.10.2');
    add('e3', 'release-a', '4.0.0-beta.1');
    add('e4', 'release-a', '3.3.9');
    add('e5', 'release-a', null);
    add('e6', 'release-a', '3.4.0', 'downloaded');
    add('e7', 'release-b', '3.5.0');
    add('e8', null, '3.5.0');
    expect(
      query('release_capable_applies', { app_id: 'app-a', release_ids: 'release-a,release-b' }),
    ).toEqual([
      { release_id: 'release-a', applies: 3 },
      { release_id: 'release-b', applies: 1 },
    ]);
  });
});
