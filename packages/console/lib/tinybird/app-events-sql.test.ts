import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pipeQuery, registerClickHouseAdapters } from './pipe-sql-harness';

// Custom event pipes, executed in SQLite (see pipe-sql-harness.ts). Every
// insert runs the materialization on its own block, like ClickHouse does.

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
  'name',
  'properties',
] as const;

let db: DatabaseSync;

function track(
  eventId: string,
  receivedAt: string,
  overrides: Partial<Record<(typeof RAW_COLUMNS)[number], string | null>> = {},
) {
  const row: Record<string, string | null> = {
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
    name: 'checkout_completed',
    properties: '{"plan":"pro"}',
    ...overrides,
  };
  const values = RAW_COLUMNS.map((column) => row[column] ?? null);
  const placeholders = RAW_COLUMNS.map(() => '?').join(', ');
  for (const table of ['app_events_raw', 'app_events_block']) {
    db.prepare(`INSERT INTO ${table} (${RAW_COLUMNS.join(', ')}) VALUES (${placeholders})`).run(
      ...values,
    );
  }
  const rollup = pipeQuery('app_event_hourly_mv', {}, 'materializations').replace(
    'FROM app_events_raw',
    'FROM app_events_block',
  );
  db.exec(`INSERT INTO app_event_hourly ${rollup}`);
  db.exec('DELETE FROM app_events_block');
}

const query = (name: string, parameters: Record<string, string> = {}) =>
  db.prepare(pipeQuery(name, parameters)).all();
const seconds = (iso: string) => Date.parse(iso) / 1000;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  const rawSchema = RAW_COLUMNS.join(', ');
  db.exec(`
    CREATE TABLE app_events_raw (${rawSchema});
    CREATE TABLE app_events_block (${rawSchema});
    CREATE TABLE app_event_hourly (
      bucket, app_id, name, release_id, channel, platform,
      event_ids_uniq_exact_state, session_ids_uniq_exact_state
    );
  `);
  registerClickHouseAdapters(db);
});

afterEach(() => db.close());

describe('app_event_names', () => {
  it('counts unique events and sessions per name, with the previous period', () => {
    track('e1', '2026-10-13T10:10:00.000Z');
    track('e1', '2026-10-13T10:20:00.000Z'); // a retry
    track('e2', '2026-10-13T11:00:00.000Z', { session_id: 'session-2' });
    track('e3', '2026-10-12T09:00:00.000Z'); // previous period
    track('s1', '2026-10-13T10:00:00.000Z', { name: '$session_start', properties: '{}' });
    track('x1', '2026-10-13T10:00:00.000Z', { app_id: 'app-b' });
    track('late', '2026-10-14T10:00:00.000Z'); // after the range
    const names = (parameters: Record<string, string> = {}) =>
      query('app_event_names', {
        app_id: 'app-a',
        previous_from_ts: '2026-10-12T10:00:00.000Z',
        from_ts: '2026-10-13T10:00:00.000Z',
        to_ts: '2026-10-14T10:00:00.000Z',
        ...parameters,
      });
    expect(names()).toEqual([
      {
        name: 'checkout_completed',
        events: 2,
        sessions: 2,
        compared_events: 2,
        previous_events: 0,
      },
      { name: '$session_start', events: 1, sessions: 1, compared_events: 1, previous_events: 0 },
    ]);
    expect(names({ previous_from_ts: '2026-10-12T09:00:00.000Z' })[0]).toMatchObject({
      previous_events: 1,
    });
    // The change compares the elapsed part of both periods.
    expect(
      names({
        previous_from_ts: '2026-10-12T09:00:00.000Z',
        compare_to_ts: '2026-10-13T11:00:00.000Z',
        previous_to_ts: '2026-10-12T09:00:00.000Z',
      })[0],
    ).toMatchObject({ events: 2, compared_events: 1, previous_events: 0 });
    expect(names({ name: '$session_start' })).toEqual([
      { name: '$session_start', events: 1, sessions: 1, compared_events: 1, previous_events: 0 },
    ]);
    expect(names({ platform: 'android' })).toEqual([]);
  });
});

describe('app_event_timeseries', () => {
  it('buckets by hour or UTC day, with filters', () => {
    track('e1', '2026-10-13T10:10:00.000Z');
    track('e2', '2026-10-13T10:50:00.000Z', { session_id: 'session-2' });
    track('e3', '2026-10-13T12:00:00.000Z', { channel: null });
    track('e4', '2026-10-14T01:00:00.000Z', { platform: 'android' });
    track('other', '2026-10-13T10:00:00.000Z', { name: 'signup' });
    const series = (parameters: Record<string, string> = {}) =>
      query('app_event_timeseries', {
        app_id: 'app-a',
        name: 'checkout_completed',
        from_ts: '2026-10-13T00:00:00.000Z',
        to_ts: '2026-10-15T00:00:00.000Z',
        ...parameters,
      }).map((row) => [row.bucket_start, row.events, row.sessions]);
    expect(series()).toEqual([
      [seconds('2026-10-13T10:00:00Z'), 2, 2],
      [seconds('2026-10-13T12:00:00Z'), 1, 1],
      [seconds('2026-10-14T01:00:00Z'), 1, 1],
    ]);
    expect(series({ daily: '1' })).toEqual([
      [seconds('2026-10-13T00:00:00Z'), 3, 2],
      [seconds('2026-10-14T00:00:00Z'), 1, 1],
    ]);
    expect(series({ channel_is_null: '1' })).toEqual([[seconds('2026-10-13T12:00:00Z'), 1, 1]]);
    expect(series({ channel: 'production', channel_is_null: '0', platform: 'ios' })).toEqual([
      [seconds('2026-10-13T10:00:00Z'), 2, 2],
    ]);
    const all = query('app_event_timeseries', {
      app_id: 'app-a',
      from_ts: '2026-10-13T00:00:00.000Z',
      daily: '1',
    }).map((row) => [row.name, row.bucket_start, row.events]);
    expect(all).toEqual([
      ['checkout_completed', seconds('2026-10-13T00:00:00Z'), 3],
      ['checkout_completed', seconds('2026-10-14T00:00:00Z'), 1],
      ['signup', seconds('2026-10-13T00:00:00Z'), 1],
    ]);
  });
});

describe('app_event_breakdown', () => {
  it('splits by a property: top values and a total', () => {
    track('e1', '2026-10-13T10:00:00.000Z', { properties: '{"plan":"pro"}' });
    track('e2', '2026-10-13T10:00:00.000Z', { properties: '{"plan":"pro"}', session_id: 's2' });
    track('e3', '2026-10-13T10:00:00.000Z', { properties: '{"plan":"free"}' });
    track('e4', '2026-10-13T10:00:00.000Z', { properties: '{}' });
    track('e4', '2026-10-13T10:00:01.000Z', { properties: '{}' });
    const rows = query('app_event_breakdown', {
      app_id: 'app-a',
      name: 'checkout_completed',
      property: 'plan',
      from_ts: '2026-10-13T00:00:00.000Z',
    });
    expect(rows).toEqual([
      { value: 'pro', is_total: 0, events: 2, sessions: 2 },
      { value: '', is_total: 0, events: 1, sessions: 1 },
      { value: 'free', is_total: 0, events: 1, sessions: 1 },
      { value: '', is_total: 1, events: 4, sessions: 2 },
    ]);
  });
});

describe('app_event_release_comparison', () => {
  it('counts the event and all sessions per release', () => {
    track('e1', '2026-10-13T10:00:00.000Z');
    track('e2', '2026-10-13T11:00:00.000Z', { release_id: 'release-b' });
    for (const [id, session, release] of [
      ['s1', 'session-1', 'release-a'],
      ['s2', 'session-2', 'release-a'],
      ['s3', 'session-3', 'release-b'],
      ['s4', 'session-4', 'release-b'],
      ['s5', 'session-5', 'release-b'],
    ]) {
      track(id, '2026-10-13T09:00:00.000Z', {
        name: '$session_start',
        session_id: session,
        release_id: release,
      });
    }
    track('n1', '2026-10-13T09:00:00.000Z', { release_id: null });
    expect(
      query('app_event_release_comparison', {
        app_id: 'app-a',
        name: 'checkout_completed',
        release_ids: 'release-a,release-b',
      }),
    ).toEqual([
      { release_id: 'release-a', events: 1, sessions: 1, all_sessions: 2 },
      { release_id: 'release-b', events: 1, sessions: 1, all_sessions: 3 },
    ]);
  });
});

describe('app_events_live', () => {
  it('returns the latest events once each, optionally of one name', () => {
    track('e1', '2026-10-13T10:00:00.000Z');
    track('e2', '2026-10-13T11:00:00.000Z', { name: 'signup', properties: '{"via":"apple"}' });
    track('e1', '2026-10-13T12:00:00.000Z'); // retried later
    const live = (parameters: Record<string, string> = {}) =>
      query('app_events_live', { app_id: 'app-a', ...parameters });
    expect(live().map((row) => [row.event_id, row.name, row.received_at_ms])).toEqual([
      ['e2', 'signup', Date.parse('2026-10-13T11:00:00.000Z')],
      ['e1', 'checkout_completed', Date.parse('2026-10-13T10:00:00.000Z')],
    ]);
    expect(live({ name: 'signup' })[0]).toMatchObject({ properties: '{"via":"apple"}' });
    expect(live({ limit: '1' })).toHaveLength(1);
  });
});

describe('app_event_usage', () => {
  it('counts events per app in a date range', () => {
    track('u0', '2026-09-30T23:59:59.999Z');
    track('u1', '2026-10-01T00:00:00.000Z');
    track('u2', '2026-10-31T23:00:00.000Z', { name: '$session_start' });
    track('u3', '2026-11-01T00:00:00.000Z');
    track('u4', '2026-10-15T00:00:00.000Z', { app_id: 'app-b' });
    expect(
      query('app_event_usage', { start_date: '2026-10-01', end_date_exclusive: '2026-11-01' }),
    ).toEqual([
      { app_id: 'app-a', events: 2 },
      { app_id: 'app-b', events: 1 },
    ]);
  });
});
