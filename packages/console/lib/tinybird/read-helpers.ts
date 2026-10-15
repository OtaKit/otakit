import { warnTinybirdNotConfigured } from './client';
import type { AnalyticsResult } from './events';

/** Small parsers shared by the error and custom event readers. */

/** Tinybird returns 64-bit integers as strings. */
export type Count = number | string | null | undefined;

export function count(value: Count): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function isoFromMs(value: Count): string | null {
  const ms = count(value);
  return ms > 0 ? new Date(ms).toISOString() : null;
}

export function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function unavailable<T>(context: string, data: T): AnalyticsResult<T> {
  warnTinybirdNotConfigured(context);
  return { data, available: false };
}

export function failed<T>(
  context: string,
  metadata: Record<string, unknown>,
  error: unknown,
  data: T,
): AnalyticsResult<T> {
  console.error(`[Tinybird] ${context} failed`, { ...metadata, error });
  return { data, available: false };
}

/** Channel filter: undefined = every channel, null = the base channel (no channel). */
export function channelParams(
  channel: string | null | undefined,
): Record<string, string | boolean> {
  if (channel === undefined) return {};
  return channel === null ? { channel_is_null: true } : { channel, channel_is_null: false };
}
