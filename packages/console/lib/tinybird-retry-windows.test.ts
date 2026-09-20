import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Execute the checked-in endpoint SQL, including its node graph and optional
// filters. SQLite handles relational/window operations; the adapters below
// model only ClickHouse date, array, and exact aggregate-state functions.
// Deployment still requires ClickHouse/Tinybird validation and benchmarking.
function pipeQuery(name: string, parameters: Record<string, string> = {}) {
  const source = readFileSync(
    new URL(`../../../tinybird/endpoints/${name}.pipe`, import.meta.url),
    'utf8',
  );
  const nodes = [...source.matchAll(/^NODE (\w+)\nSQL >\n([\s\S]*?)(?=\n(?:NODE |TYPE ))/gm)];
  const queries = nodes.map(([, name, body]) => ({
    name,
    sql: body
      .replace(/^\s*%\s*$/gm, '')
      .replace(
        /\{% if defined\((\w+)\) %\}([\s\S]*?)\{% else %\}([\s\S]*?)\{% end %\}/g,
        (_, key: string, defined: string, missing: string) =>
          parameters[key] === undefined ? missing : defined,
      )
      .replace(
        /\{\{ (String|UInt8|UInt32)\((\w+)(?:, ('[^']*'|\d+))?\) \}\}/g,
        (_, type: string, key: string, fallback?: string) => {
          const value = parameters[key];
          if (value === undefined) {
            if (fallback === undefined) throw new Error(`Missing parameter ${key}`);
            return fallback;
          }
          return type === 'String' ? `'${value.replaceAll("'", "''")}'` : value;
        },
      )
      .trim(),
  }));
  const last = queries.pop();
  if (!last) throw new Error(`No SQL nodes in ${name}`);
  const ctes = queries.map(({ name, sql }) => `${name} AS (${sql})`).join(', ');
  return `${ctes ? `WITH ${ctes} ` : ''}${last.sql}`;
}

let db: DatabaseSync;

function exactMerge(name: string, conditional = false) {
  db.aggregate(name, {
    start: '[]',
    varargs: true,
    step: (state: string, ...args: SQLOutputValue[]) => {
      if (args[0] === null || (conditional && !args[1])) return state;
      return JSON.stringify([...new Set([...JSON.parse(state), ...JSON.parse(String(args[0]))])]);
    },
    result: (state: string) => JSON.parse(state).length,
  });
}

function addEvent(
  eventId: string,
  receivedAt: string,
  overrides: Record<string, string | null> = {},
) {
  const row = {
    event_id: eventId,
    app_id: 'app-a',
    action: 'downloaded',
    platform: 'ios',
    bundle_version: '1.0',
    channel: null,
    runtime_version: null,
    release_id: 'release-a',
    detail: null,
    attempt_id: 'attempt-a',
    native_sdk_version: '1.0',
    phase: 'stage',
    lifecycle: 'foreground',
    received_at: receivedAt,
    sent_at: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO device_events_raw (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...Object.values(row));
  // Separate rows deliberately represent unmerged materialization blocks.
  db.prepare('INSERT INTO device_event_daily_counts VALUES (?, ?, ?, ?)').run(
    receivedAt.slice(0, 10),
    row.app_id,
    row.action,
    JSON.stringify([eventId]),
  );
}

function billed(start: string, end: string, apps = 'app-a') {
  return db
    .prepare(
      pipeQuery('organization_download_counts', {
        app_ids: apps,
        start_date: start,
        end_date_exclusive: end,
      }),
    )
    .get()!.downloads_count;
}

function health(from = '2026-09-01T00:00:00.000Z') {
  return db
    .prepare(
      pipeQuery('release_health_window', {
        app_id: 'app-a',
        release_ids: 'release-a',
        from_ts: from,
      }),
    )
    .all();
}

function recent(parameters: Record<string, string> = {}) {
  return db.prepare(pipeQuery('app_events_recent', { app_id: 'app-a', ...parameters })).all();
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE device_events_raw (
      event_id TEXT, app_id TEXT, action TEXT, platform TEXT, bundle_version TEXT,
      channel TEXT, runtime_version TEXT, release_id TEXT, detail TEXT,
      attempt_id TEXT, native_sdk_version TEXT, phase TEXT, lifecycle TEXT,
      received_at TEXT, sent_at TEXT
    );
    CREATE TABLE device_event_daily_counts (
      bucket_date TEXT, app_id TEXT, action TEXT, event_ids_uniq_exact_state TEXT
    );
  `);
  db.function('parseDateTime64BestEffort', (value, precision) => {
    if (precision !== 3) throw new Error('Fixture timestamps use millisecond precision');
    return value;
  });
  db.function('toDate', (value) => String(value).slice(0, 10));
  db.function('splitByChar', (separator, value) =>
    JSON.stringify(String(value).split(String(separator))),
  );
  db.function('has', (values, value) => Number(JSON.parse(String(values)).includes(value)));
  exactMerge('uniqExactMerge');
  exactMerge('uniqExactMergeIf', true);
});

afterEach(() => db.close());

describe('download billing receipt periods', () => {
  it('counts an identity in its first receipt period with inclusive start and exclusive end', () => {
    addEvent('previous', '2026-08-31T23:59:59.999Z');
    addEvent('previous', '2026-09-01T00:00:00.000Z');
    addEvent('start', '2026-09-01T00:00:00.000Z');
    addEvent('start', '2026-09-02T00:00:00.000Z');
    addEvent('end', '2026-10-01T00:00:00.000Z');
    addEvent('other-app', '2026-09-01T00:00:00.000Z', { app_id: 'app-b' });
    addEvent('other-action', '2026-09-01T00:00:00.000Z', { action: 'check_error' });
    expect(billed('2026-09-01', '2026-10-01')).toBe(1);
    expect(billed('2026-10-01', '2026-11-01')).toBe(1);
    expect(billed('2026-09-01', '2026-10-01', 'app-a,app-b')).toBe(2);
    expect(billed('2026-09-01', '2026-10-01', 'missing')).toBe(0);
  });

  it('merges nonadditive daily states rather than summing receipt-day counts', () => {
    for (const day of ['2026-09-01', '2026-09-02']) {
      addEvent('same', `${day}T00:00:00.000Z`);
      addEvent('same', `${day}T01:00:00.000Z`);
    }
    expect(billed('2026-09-01', '2026-09-03')).toBe(1);
    expect(billed('2026-09-01', '2026-09-02')).toBe(1);
    expect(billed('2026-09-02', '2026-09-03')).toBe(0);
    expect(billed('2026-09-01', '2026-09-01')).toBe(0);
  });

  it('retains prior-period identities after the original raw receipt expires', () => {
    addEvent('retained-in-rollup', '2020-01-01T00:00:00.000Z');
    addEvent('retained-in-rollup', '2026-09-01T00:00:00.000Z');
    db.exec("DELETE FROM device_events_raw WHERE received_at < '2026-06-01T00:00:00.000Z'");
    expect(db.prepare('SELECT count(*) AS rows FROM device_events_raw').get()!.rows).toBe(1);
    expect(billed('2026-09-01', '2026-10-01')).toBe(0);
    expect(billed('2020-01-01', '2026-10-01')).toBe(1);
  });

  it('moves attribution when an earlier receipt arrives late, without using the client clock', () => {
    addEvent('late-original', '2026-09-01T00:00:00.000Z');
    expect(billed('2026-09-01', '2026-10-01')).toBe(1);
    addEvent('late-original', '2026-08-31T23:59:59.999Z');
    expect(billed('2026-09-01', '2026-10-01')).toBe(0);
    expect(billed('2026-08-01', '2026-09-01')).toBe(1);
  });
});

describe('release health receipt windows', () => {
  it('does not refresh old applied or rollback events when a retry lands inside the window', () => {
    for (const action of ['applied', 'rollback']) {
      addEvent(`old-${action}`, '2026-08-31T23:59:59.999Z', { action });
      addEvent(`old-${action}`, '2026-09-02T00:00:00.000Z', { action });
      addEvent(`new-${action}`, '2026-09-01T00:00:00.000Z', { action });
      addEvent(`new-${action}`, '2026-09-02T00:00:00.000Z', { action });
    }
    addEvent('wrong-release', '2026-09-01T00:00:00.000Z', {
      action: 'rollback',
      release_id: 'other',
    });
    addEvent('no-release', '2026-09-01T00:00:00.000Z', { action: 'rollback', release_id: null });
    addEvent('wrong-app', '2026-09-01T00:00:00.000Z', { action: 'rollback', app_id: 'other' });
    addEvent('wrong-action', '2026-09-01T00:00:00.000Z');
    expect(health()).toEqual(
      expect.arrayContaining([
        { release_id: 'release-a', action: 'applied', events_count: 1 },
        { release_id: 'release-a', action: 'rollback', events_count: 1 },
      ]),
    );
    expect(health()).toHaveLength(2);
    expect(health('2026-09-01T00:00:00.001Z')).toEqual([]);
  });

  it('recomputes first receipt for late data and is bounded by raw retention', () => {
    addEvent('rollback', '2026-09-02T00:00:00.000Z', { action: 'rollback' });
    expect(health()[0]).toMatchObject({ events_count: 1 });
    addEvent('rollback', '2026-08-31T23:59:59.999Z', { action: 'rollback' });
    expect(health()).toEqual([]);
    db.exec("DELETE FROM device_events_raw WHERE received_at < '2026-09-01T00:00:00.000Z'");
    expect(health()[0]).toMatchObject({ events_count: 1 });
  });
});

describe('recent event identities', () => {
  it('retains the earliest row before date filtering, sorting, and limiting', () => {
    addEvent('old', '2026-08-31T23:59:59.999Z');
    addEvent('old', '2026-09-04T00:00:00.000Z');
    addEvent('new', '2026-09-01T00:00:00.000Z');
    addEvent('newer', '2026-09-02T00:00:00.000Z');
    addEvent('newer', '2026-09-03T00:00:00.000Z', { detail: 'retry payload' });
    const rows = recent({ from_ts: '2026-09-01T00:00:00.000Z', limit: '2' });
    expect(rows.map((row) => row.event_id)).toEqual(['newer', 'new']);
    expect(rows[0]).toMatchObject({ received_at: '2026-09-02T00:00:00.000Z', detail: null });
    expect(rows[0]).not.toHaveProperty('receipt_number');
    expect(rows[0]).not.toHaveProperty('sent_at');
    expect(recent()).toHaveLength(3);
  });

  it('keeps all optional filters and legacy/null channel and runtime behavior', () => {
    addEvent('base', '2026-09-01T00:00:00.000Z');
    addEvent('base', '2026-09-02T00:00:00.000Z');
    addEvent('channel', '2026-09-03T00:00:00.000Z', {
      channel: 'beta',
      runtime_version: 'runtime-b',
    });
    addEvent('android', '2026-09-04T00:00:00.000Z', {
      platform: 'android',
      bundle_version: '2.0',
      action: 'rollback',
      release_id: 'release-b',
    });
    expect(recent({ channel: 'base' }).map((row) => row.event_id)).toEqual(['android', 'base']);
    expect(recent({ channel_is_null: '1', runtime_version_is_null: '1' })).toHaveLength(2);
    expect(
      recent({
        channel_is_null: '0',
        channel: 'beta',
        runtime_version_is_null: '0',
        runtime_version: 'runtime-b',
      }).map((row) => row.event_id),
    ).toEqual(['channel']);
    expect(recent({ runtime_version: 'runtime-b' }).map((row) => row.event_id)).toEqual([
      'channel',
    ]);
    expect(
      recent({
        platform: 'android',
        action: 'rollback',
        bundle_version: '2.0',
        release_id: 'release-b',
      }).map((row) => row.event_id),
    ).toEqual(['android']);
  });
});
