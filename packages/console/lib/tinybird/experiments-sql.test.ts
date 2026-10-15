import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pipeQuery, registerClickHouseAdapters } from './pipe-sql-harness';

// The A/B test rollup and endpoint, executed in SQLite (see pipe-sql-harness.ts).
// Every insert runs the materialization on its own block, like ClickHouse does.

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

const EXPERIMENT = '0b1d2c3e-0000-4000-8000-00000000000a';
let db: DatabaseSync;

function report(
  eventId: string,
  receivedAt: string,
  name: string,
  properties: Record<string, string>,
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
    session_id: `session-${eventId}`,
    name,
    properties: JSON.stringify(properties),
    ...overrides,
  };
  const values = RAW_COLUMNS.map((column) => row[column] ?? null);
  const placeholders = RAW_COLUMNS.map(() => '?').join(', ');
  db.prepare(
    `INSERT INTO app_events_block (${RAW_COLUMNS.join(', ')}) VALUES (${placeholders})`,
  ).run(...values);
  const rollup = pipeQuery('app_experiment_daily_mv', {}, 'materializations').replace(
    'FROM app_events_raw',
    'FROM app_events_block',
  );
  db.exec(`INSERT INTO app_experiment_daily ${rollup}`);
  db.exec('DELETE FROM app_events_block');
}

const query = (parameters: Record<string, string> = {}) =>
  db
    .prepare(
      pipeQuery('experiment_reports', {
        app_id: 'app-a',
        experiment_id: EXPERIMENT,
        ...parameters,
      }),
    )
    .all();

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_events_block (${RAW_COLUMNS.join(', ')});
    CREATE TABLE app_experiment_daily (
      day, app_id, experiment_id, variant, name, goal, event_ids_uniq_exact_state
    );
  `);
  registerClickHouseAdapters(db);
});

afterEach(() => db.close());

describe('experiment_reports', () => {
  beforeEach(() => {
    const exposure = { experiment: EXPERIMENT, variant: 'control' };
    report('e1', '2026-10-01T10:00:00.000Z', '$exposure', exposure);
    report('e2', '2026-10-01T11:00:00.000Z', '$exposure', { ...exposure, variant: 'b' });
    report('e3', '2026-10-02T09:00:00.000Z', '$exposure', exposure);
    // A retry of e3 received the next day: one device, counted once in totals.
    report('e3', '2026-10-03T09:00:00.000Z', '$exposure', exposure);
    report('c1', '2026-10-02T12:00:00.000Z', '$conversion', {
      ...exposure,
      goal: 'purchase_completed',
    });
    report('c2', '2026-10-02T13:00:00.000Z', '$conversion', {
      ...exposure,
      goal: 'signup',
    });
    report('x1', '2026-10-02T14:00:00.000Z', '$experiment_error', { ...exposure, variant: 'b' });
    // Not reports of this test: other names, apps and experiments.
    report('n1', '2026-10-02T15:00:00.000Z', 'purchase_completed', exposure);
    report('a1', '2026-10-02T15:00:00.000Z', '$exposure', exposure, { app_id: 'app-b' });
    report('o1', '2026-10-02T15:00:00.000Z', '$exposure', {
      experiment: '0b1d2c3e-0000-4000-8000-00000000000b',
      variant: 'control',
    });
  });

  it('counts devices per variant, kind and goal over the range', () => {
    expect(query()).toEqual([
      { report_day: '', variant: 'b', name: '$experiment_error', goal: '', reports: 1 },
      { report_day: '', variant: 'b', name: '$exposure', goal: '', reports: 1 },
      {
        report_day: '',
        variant: 'control',
        name: '$conversion',
        goal: 'purchase_completed',
        reports: 1,
      },
      { report_day: '', variant: 'control', name: '$conversion', goal: 'signup', reports: 1 },
      { report_day: '', variant: 'control', name: '$exposure', goal: '', reports: 2 },
    ]);
  });

  it('splits by UTC day and bounds the range by day', () => {
    const daily = query({ daily: '1' }).filter(
      (row) => (row as { name: string }).name === '$exposure',
    );
    expect(daily).toEqual([
      { report_day: '2026-10-01', variant: 'b', name: '$exposure', goal: '', reports: 1 },
      { report_day: '2026-10-01', variant: 'control', name: '$exposure', goal: '', reports: 1 },
      { report_day: '2026-10-02', variant: 'control', name: '$exposure', goal: '', reports: 1 },
      { report_day: '2026-10-03', variant: 'control', name: '$exposure', goal: '', reports: 1 },
    ]);
    expect(query({ from_day: '2026-10-02', to_day: '2026-10-02' })).toEqual([
      { report_day: '', variant: 'b', name: '$experiment_error', goal: '', reports: 1 },
      {
        report_day: '',
        variant: 'control',
        name: '$conversion',
        goal: 'purchase_completed',
        reports: 1,
      },
      { report_day: '', variant: 'control', name: '$conversion', goal: 'signup', reports: 1 },
      { report_day: '', variant: 'control', name: '$exposure', goal: '', reports: 1 },
    ]);
  });
});
