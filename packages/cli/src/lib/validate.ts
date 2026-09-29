import { CliError } from './errors.js';

export function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`${label} must be a positive integer.`);
  }
  return parsed;
}

/** A rollout percentage (1-100); a trailing `%` is accepted. */
export function parseRolloutPercent(value: string, label: string): number {
  const match = /^\s*(\d{1,3})\s*%?\s*$/.exec(value);
  const parsed = match ? Number(match[1]) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new CliError(`${label} must be a whole percentage between 1 and 100 (got "${value}").`);
  }
  return parsed;
}

export function normalizeChannel(value: string | undefined): string {
  const channel = value?.trim() ?? '';
  if (channel.length === 0) {
    throw new CliError('Channel cannot be empty.');
  }
  return channel;
}
