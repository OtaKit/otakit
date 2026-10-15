/** The parts of a release timeseries (REST response or service result) the summary reads. */
type ReleaseTimeseriesLike = {
  release: { bundleVersion: string; channel: string | null };
  range: string;
  platform: string | null;
  analyticsAvailable: boolean;
  totals: {
    downloads: number;
    applied: number;
    downloadErrors: number;
    rollbacks: number;
    rollbackSharePercent: number | null;
  };
};

const RANGE_LABELS: Record<string, string> = {
  '24h': 'the last 24 hours',
  '7d': 'the last 7 days',
  '30d': 'the last 30 days',
};

const EVENTS_NOT_DEVICES =
  'Event counts are client-reported and are not unique devices, adoption, or authenticated installations.';

/**
 * Summary and warnings for `get_release_timeseries`. When analytics are
 * unavailable every count is 0 in the data, so the summary must say the counts
 * are unknown rather than let them read as a healthy release.
 */
export function releaseTimeseriesEnvelopeParts(timeseries: ReleaseTimeseriesLike): {
  summary: string;
  warnings: string[];
} {
  const { release, totals } = timeseries;
  const lane = release.channel ?? 'the base channel';
  const range = RANGE_LABELS[timeseries.range] ?? timeseries.range;
  const platform =
    timeseries.platform === 'ios'
      ? ' on iOS'
      : timeseries.platform === 'android'
        ? ' on Android'
        : '';
  if (!timeseries.analyticsAvailable) {
    return {
      summary: `Analytics are unavailable, so the events of ${release.bundleVersion} on ${lane} are unknown, not zero.`,
      warnings: ['Analytics are unavailable: the counts in this result are unknown, not zero.'],
    };
  }
  const share =
    totals.rollbackSharePercent === null ? '' : ` (${totals.rollbackSharePercent}% rollback share)`;
  const count = (value: number, one: string, many: string) =>
    `${value} ${value === 1 ? one : many}`;
  return {
    summary: `${release.bundleVersion} on ${lane}${platform}, ${range}: ${count(totals.applied, 'apply', 'applies')}, ${count(totals.rollbacks, 'rollback', 'rollbacks')}${share}, ${count(totals.downloadErrors, 'download error', 'download errors')}, ${count(totals.downloads, 'download', 'downloads')}.`,
    warnings: [EVENTS_NOT_DEVICES],
  };
}
