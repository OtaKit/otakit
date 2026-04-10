import { CliError } from './errors.js';

export function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`${label} must be a positive integer.`);
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
