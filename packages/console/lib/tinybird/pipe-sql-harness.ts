import { readFileSync } from 'node:fs';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

/**
 * Test helper: runs the checked-in Tinybird pipe SQL, including its node graph
 * and optional filters, in SQLite. SQLite handles relational and window
 * operations; registerClickHouseAdapters models only the ClickHouse date,
 * array and aggregate functions the pipes use. Deployment still requires
 * ClickHouse/Tinybird validation.
 */
export function pipeQuery(
  name: string,
  parameters: Record<string, string> = {},
  folder: 'endpoints' | 'materializations' = 'endpoints',
): string {
  const source = readFileSync(
    new URL(`../../../../tinybird/${folder}/${name}.pipe`, import.meta.url),
    'utf8',
  );
  const nodes = [...source.matchAll(/^NODE (\w+)\nSQL >\n([\s\S]*?)(?=\n(?:NODE |TYPE ))/gm)];
  const queries = nodes.map(([, name, body]) => ({
    name,
    sql: body
      .replace(/^\s*%\s*$/gm, '')
      .replace(
        /\{% if defined\((\w+)\) %\}([\s\S]*?)(?:\{% else %\}([\s\S]*?))?\{% end %\}/g,
        (_, key: string, defined: string, missing = '') =>
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

function setAggregate(db: DatabaseSync, name: string, conditional = false) {
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

function argAggregate(db: DatabaseSync, name: string, pick: (a: string, b: string) => boolean) {
  db.aggregate(name, {
    start: 'null',
    step: (state: string, value: SQLOutputValue, by: SQLOutputValue) => {
      if (by === null) return state;
      const current = JSON.parse(state) as [SQLOutputValue, string] | null;
      return current === null || pick(String(by), current[1])
        ? JSON.stringify([value, String(by)])
        : state;
    },
    result: (state: string) => (JSON.parse(state) as [SQLOutputValue, string] | null)?.[0] ?? null,
  });
}

/** ClickHouse functions used by the pipes. Timestamps are stored as ISO strings in UTC. */
export function registerClickHouseAdapters(db: DatabaseSync): void {
  db.function('parseDateTime64BestEffort', (value, precision) => {
    if (precision !== 3) throw new Error('Fixture timestamps use millisecond precision');
    return value;
  });
  db.function('toDate', (value) => String(value).slice(0, 10));
  // The pipes pass 'UTC' as the time zone; stored values are UTC already.
  db.function(
    'toStartOfHour',
    { varargs: true },
    (value) => `${String(value).slice(0, 13)}:00:00.000Z`,
  );
  db.function(
    'toStartOfDay',
    { varargs: true },
    (value) => `${String(value).slice(0, 10)}T00:00:00.000Z`,
  );
  db.function('toUnixTimestamp', (value) => Math.floor(Date.parse(String(value)) / 1000));
  db.function('toUnixTimestamp64Milli', (value) => Date.parse(String(value)));
  db.function('toInt64', (value) => value);
  db.function('toString', (value) => (value === null ? null : String(value)));
  db.function('splitByChar', (separator, value) =>
    JSON.stringify(String(value).split(String(separator))),
  );
  db.function('has', (values, value) => Number(JSON.parse(String(values)).includes(value)));
  setAggregate(db, 'uniqExactMerge');
  setAggregate(db, 'uniqExactMergeIf', true);
  db.aggregate('uniqExactState', {
    start: '[]',
    step: (state: string, value: SQLOutputValue) =>
      value === null ? state : JSON.stringify([...new Set([...JSON.parse(state), value])]),
  });
  db.aggregate('uniqExact', {
    start: '[]',
    step: (state: string, value: SQLOutputValue) =>
      value === null ? state : JSON.stringify([...new Set([...JSON.parse(state), value])]),
    result: (state: string) => JSON.parse(state).length,
  });
  db.aggregate('groupUniqArray', {
    start: '[]',
    step: (state: string, value: SQLOutputValue) =>
      value === null ? state : JSON.stringify([...new Set([...JSON.parse(state), value])]),
    result: (state: string) => JSON.stringify((JSON.parse(state) as string[]).sort()),
  });
  // ClickHouse any() skips NULLs and returns some value; fixtures keep it deterministic.
  db.aggregate('any', {
    start: null,
    step: (state: SQLOutputValue, value: SQLOutputValue) => state ?? value,
  });
  argAggregate(db, 'argMin', (by, current) => by < current);
  argAggregate(db, 'argMax', (by, current) => by > current);
}
