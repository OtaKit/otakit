import { experimentVerdictSentence } from '@otakit/mcp-core';

import type { ExperimentResults, ExperimentSummary } from './api.js';

/** Text for `otakit experiments`: lists and results tables. */

function config(channel: string | null): string {
  return channel === null ? 'base config' : `${channel} config`;
}

function percent(share: number | null): string {
  if (share === null) return '–';
  return `${(Math.round(share * 1000) / 10).toFixed(1)}%`;
}

function signed(share: number): string {
  const value = Math.round(share * 100);
  return `${value > 0 ? '+' : ''}${value}%`;
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export function formatExperimentList(experiments: ExperimentSummary[]): string {
  if (experiments.length === 0) {
    return 'No A/B tests yet. Create one in the dashboard, or with `otakit experiments create --file test.json`.';
  }
  return table([
    ['ID', 'KEY', 'STATUS', 'CONFIG', 'VARIANTS', 'GOAL'],
    ...experiments.map((experiment) => [
      experiment.id,
      experiment.key,
      experiment.status === 'shipped' && experiment.shippedVariant
        ? `shipped ${experiment.shippedVariant}`
        : experiment.status,
      config(experiment.channel),
      experiment.variants.map((variant) => `${variant.key} ${variant.weight}%`).join(' / '),
      experiment.goalEvent,
    ]),
  ]);
}

export function formatExperimentResults(result: ExperimentResults): string {
  const { experiment, stats } = result;
  const head = `${experiment.key} · ${experiment.status} · ${config(experiment.channel)} · goal ${experiment.goalEvent}`;
  if (!stats) return `${head}\nNot started yet: no results.`;
  const lines = [
    `${head} · ${result.daysRunning} days`,
    experimentVerdictSentence(stats.verdict),
    '',
    table([
      ['VARIANT', 'DEVICES', 'CONVERTED', 'RATE', 'LIFT (95%)', 'BEST', 'ERRORS'],
      ...stats.variants.map((variant) => [
        variant.key,
        variant.exposed.toLocaleString('en-US'),
        variant.converted.toLocaleString('en-US'),
        percent(variant.rate),
        variant.lift && stats.comparable
          ? `${signed(variant.lift.median)} (${signed(variant.lift.low)} to ${signed(variant.lift.high)})`
          : '–',
        stats.comparable ? percent(variant.probabilityBest) : '–',
        `${variant.errors.toLocaleString('en-US')}${variant.guardrail === 'worse' ? ' (more than control)' : ''}`,
      ]),
    ]),
  ];
  if (stats.plannedPerVariant !== null) {
    lines.push(
      '',
      `About ${stats.plannedPerVariant.toLocaleString('en-US')} devices per variant detect a 20% change at control's rate.`,
    );
  }
  if (!result.analyticsAvailable) {
    lines.push('Analytics are unavailable right now: counts can be incomplete.');
  }
  return lines.join('\n');
}
