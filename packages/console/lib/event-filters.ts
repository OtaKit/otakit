import type { DeviceEventAction, Platform } from '@/app/components/dashboard-types';
import { isValidChannelName, isValidRuntimeVersion, parsePlatform } from '@/lib/validation';

export const EVENT_FILTER_ACTIONS = [
  'downloaded',
  'applied',
  'download_error',
  'rollback',
  'check_error',
] as const satisfies readonly DeviceEventAction[];

/**
 * The device event filters shared by the event list and the activity chart.
 * `channel` and `runtimeVersion` are undefined for "any" and null for "none".
 */
export type EventFilters = {
  platform: Platform | null;
  action: DeviceEventAction | null;
  bundleVersion: string | null;
  channel: string | null | undefined;
  runtimeVersion: string | null | undefined;
};

export function parseEventFilters(
  searchParams: URLSearchParams,
): { ok: true; filters: EventFilters } | { ok: false; error: string } {
  const rawPlatform = searchParams.get('platform');
  const platform = rawPlatform && rawPlatform !== 'all' ? parsePlatform(rawPlatform) : null;
  if (rawPlatform && rawPlatform !== 'all' && platform === null) {
    return { ok: false, error: 'Invalid platform filter' };
  }

  const rawAction = searchParams.get('action');
  let action: DeviceEventAction | null = null;
  if (rawAction && rawAction !== 'all') {
    if (!(EVENT_FILTER_ACTIONS as readonly string[]).includes(rawAction)) {
      return {
        ok: false,
        error: `Invalid action filter. Must be one of: ${EVENT_FILTER_ACTIONS.join(', ')}`,
      };
    }
    action = rawAction as DeviceEventAction;
  }

  const rawBundleVersion = searchParams.get('bundle');
  const bundleVersion =
    rawBundleVersion && rawBundleVersion !== 'all' ? rawBundleVersion.slice(0, 64) : null;

  const hasExactChannel = searchParams.has('channelExact');
  const rawChannel = searchParams.get(hasExactChannel ? 'channelExact' : 'channel');
  const channel = hasExactChannel
    ? rawChannel?.trim() || null
    : !rawChannel || rawChannel === 'all'
      ? undefined
      : rawChannel.trim() === 'base'
        ? null
        : rawChannel.trim();
  // Keep the existing `channel=base` alias for callers while allowing MCP to
  // distinguish an exact named "base" channel through additive channelExact.
  if (channel && !isValidChannelName(channel)) {
    return { ok: false, error: 'Invalid channel filter' };
  }

  const rawRuntime = searchParams.get('runtime');
  const runtimeVersion =
    !searchParams.has('runtime') || rawRuntime === 'all' ? undefined : rawRuntime?.trim() || null;
  if (runtimeVersion && !isValidRuntimeVersion(runtimeVersion)) {
    return { ok: false, error: 'Invalid runtime filter' };
  }

  return { ok: true, filters: { platform, action, bundleVersion, channel, runtimeVersion } };
}
