import { cachedJson } from '@/lib/redis';

import { isTinybirdConfigured, queryTinybirdPipe } from './client';
import type { AnalyticsResult } from './events';
import { count, failed, text, unavailable, type Count } from './read-helpers';

/**
 * Reads of the A/B test pipe (tinybird/endpoints/experiment_reports.pipe).
 * Devices report each experiment at most once per kind, so unique report IDs
 * count devices.
 */

const REPORTS_PIPE = process.env.TINYBIRD_EXPERIMENT_REPORTS_PIPE?.trim() || 'experiment_reports';
const CACHE_SECONDS = 60;

export const EXPOSURE = '$exposure';
export const CONVERSION = '$conversion';
export const EXPERIMENT_ERROR = '$experiment_error';

export type ExperimentReportRow = {
  /** UTC day (YYYY-MM-DD) for daily reads; null for totals. */
  day: string | null;
  variant: string;
  name: string;
  /** The goal event of a $conversion; '' otherwise. */
  goal: string;
  /** Devices. */
  reports: number;
};

/** Reports of one experiment in [fromDay, toDay] (UTC days), totals or per day. */
export async function getExperimentReports(input: {
  appId: string;
  experimentId: string;
  fromDay: string;
  toDay: string;
  daily?: boolean;
}): Promise<AnalyticsResult<ExperimentReportRow[]>> {
  if (!isTinybirdConfigured()) return unavailable('getExperimentReports', []);
  const params: Record<string, string | boolean> = {
    app_id: input.appId,
    experiment_id: input.experimentId,
    from_day: input.fromDay,
    to_day: input.toDay,
    ...(input.daily ? { daily: true } : {}),
  };
  try {
    const rows = await cachedJson(
      `otakit:experiments:${JSON.stringify(params)}`,
      CACHE_SECONDS,
      () =>
        queryTinybirdPipe<{
          report_day?: string | null;
          variant?: string | null;
          name?: string | null;
          goal?: string | null;
          reports?: Count;
        }>(REPORTS_PIPE, params),
    );
    return {
      data: rows.flatMap((row) => {
        const variant = text(row.variant);
        const name = text(row.name);
        if (!variant || !name) return [];
        return [
          {
            day: input.daily ? (text(row.report_day)?.slice(0, 10) ?? null) : null,
            variant,
            name,
            goal: typeof row.goal === 'string' ? row.goal : '',
            reports: count(row.reports),
          },
        ];
      }),
      available: true,
    };
  } catch (error) {
    return failed('experiment_reports', { appId: input.appId }, error, []);
  }
}
