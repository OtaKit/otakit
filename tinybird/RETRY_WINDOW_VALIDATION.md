# Retry window query validation

The download billing endpoint counts identities first received in the requested
period. It merges exact identity sets before the exclusive end, then subtracts
the prefix before the inclusive start. Release health and recent events dedupe
raw receipts before applying their date windows. None of these queries uses the
client's `sent_at` clock for period attribution.

## Regression coverage

`packages/console/lib/tinybird-retry-windows.test.ts` executes the checked-in pipe
SQL and node graph with synthetic fixtures. SQLite provides SQL grouping,
filtering, and window functions; small adapters implement the ClickHouse date,
array, and exact aggregate-state functions used by these endpoints. Run:

```sh
pnpm --filter @otakit/console test lib/tinybird-retry-windows.test.ts
```

The eight cases cover cross-period retries, inclusive start/exclusive end,
empty periods, nonadditive daily identity sets, app/action scoping, late earlier
receipts, lifetime rollup identities surviving raw expiration, health windows,
earliest timeline rows, limit ordering, and optional/null filters. These tests
are regression checks, not a substitute for ClickHouse deployment validation.

The three rendered endpoint queries were also executed read-only against the
[official ClickHouse playground](https://play.clickhouse.com/) on 2026-09-20,
using only synthetic data. A prior-period download retry was excluded, an old
rollback retry did not enter the health window, and the timeline returned each
eligible identity once with its earliest receipt.

## Synthetic workload

[retry-window-benchmark.sql](tests/retry-window-benchmark.sql) generates one
million distinct downloaded IDs across 365 days and 100,000 old IDs retried in
the last period. The prefix query returned the expected **84,840** new August
identities from **1,100,000** synthetic receipts.

Two public-playground executions reported about **0.149 seconds** server elapsed
time. The response summary for the second execution reported **60,577,369 bytes**
for `memory_usage` (about 57.8 MiB); JSON statistics reported 1,100,000 rows read
and 8,800,000 bytes read. The benchmark builds aggregate states in memory from
`numbers()`. It does not measure persistent-state storage scans, mature
production organization cardinalities, concurrent requests, Tinybird resource
limits, or Polar synchronization. Benchmark those conditions in the target
Tinybird workspace before deploying the lifetime-ID billing query.

## Limits and unchanged billing policy

A late earlier receipt can move an identity to a prior billing period and lower
the current-period result. Existing Polar synchronization does not reconcile
previously reported decreases. No billing APIs, settings, or reconciliation
policy were changed; these queries do not guarantee exactly-once billing.

Billing depends on retained lifetime aggregate identities. Health and timeline
queries depend on the raw datasource's 90-day retention: after an original raw
receipt expires, a later retry can be the earliest receipt still visible.
