import type { DeviceEventAction, Platform } from '@/app/components/dashboard-types';
import { listRecentAppEventsWithStatus } from '@/lib/tinybird/events';

export async function listEvents(input: {
  appId: string;
  from: Date;
  limit: number;
  platform?: Platform | null;
  action?: DeviceEventAction | null;
  bundleVersion?: string | null;
  channel?: string | null;
  runtimeVersion?: string | null;
  releaseId?: string | null;
  includeDetail?: boolean;
}) {
  const result = await listRecentAppEventsWithStatus({
    ...input,
    channel: input.channel ?? undefined,
    channelIsNull: input.channel === null,
    runtimeVersion: input.runtimeVersion ?? undefined,
    runtimeVersionIsNull: input.runtimeVersion === null,
  });
  return {
    events: result.data.map((event) => ({
      ...event,
      detail: input.includeDetail === false ? null : event.detail,
      ...(input.includeDetail !== false && event.detail
        ? { dataTrust: 'client_reported_untrusted_text' as const }
        : {}),
    })),
    analyticsAvailable: result.available,
  };
}
