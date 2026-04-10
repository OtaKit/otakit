'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState, useEffect, useCallback, type ElementType } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Cpu,
  Download,
  Hash,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
} from 'lucide-react';

import { toast } from 'sonner';

import { DashboardHeader } from '@/app/components/DashboardHeader';
import type {
  ApiError,
  AppSummary,
  BundleSummaryItem,
  DashboardInitialData,
  DashboardPreviewAppData,
  DashboardPreviewData,
  DeviceEvent,
  Platform,
  ReleaseHistoryItem,
} from '@/app/components/dashboard-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/* ─── Types ────────────────────────────────────────────────────────── */

type EventPlatformFilter = Platform | 'all';
type EventActionFilter = 'all' | 'downloaded' | 'applied' | 'download_error' | 'rollback';
type EventTimeframeFilter = '1h' | '24h' | '7d' | '30d';
type BundleTableColumn =
  | 'version'
  | 'size'
  | 'uploaded'
  | 'targets'
  | 'downloads'
  | 'applied'
  | 'errors'
  | 'rollbacks'
  | 'action';
type ReleaseTableColumn =
  | 'version'
  | 'channel'
  | 'previous'
  | 'releaser'
  | 'date'
  | 'downloads'
  | 'applied'
  | 'errors'
  | 'rollbacks'
  | 'action';
const BASE_RELEASE_STREAM_LABEL = 'base';
const BASE_RELEASE_STREAM_KEY = '$base';
const NEW_RELEASE_STREAM_KEY = '$new';
const CHANNEL_NAME_REGEX = /^[A-Za-z0-9._-]{1,64}$/;
const RESERVED_CHANNEL_NAMES = new Set(['base', 'default']);
const BUNDLE_COLUMNS_STORAGE_KEY = 'dashboard:bundle-columns:v2';
const RELEASE_COLUMNS_STORAGE_KEY = 'dashboard:release-columns:v3';
const STAT_COLUMN_HINTS = {
  downloads: 'Devices that downloaded this update',
  applied: 'Devices that activated this update successfully',
  errors: 'Devices that failed to download or stage this update (e.g. due to disk space)',
  rollbacks: 'Devices that rolled back after activation (e.g. due to app crash)',
} as const;
const BUNDLE_COLUMN_OPTIONS: Array<{ key: BundleTableColumn; label: string }> = [
  { key: 'version', label: 'Version' },
  { key: 'size', label: 'Size' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'targets', label: 'Channels' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'applied', label: 'Applied' },
  { key: 'errors', label: 'Errors' },
  { key: 'rollbacks', label: 'Rollbacks' },
  { key: 'action', label: 'Action' },
];
const BUNDLE_COLUMN_KEYS = BUNDLE_COLUMN_OPTIONS.map((option) => option.key);
const RELEASE_COLUMN_OPTIONS: Array<{ key: ReleaseTableColumn; label: string }> = [
  { key: 'version', label: 'Bundle' },
  { key: 'channel', label: 'Channel' },
  { key: 'previous', label: 'Previous' },
  { key: 'releaser', label: 'Releaser' },
  { key: 'date', label: 'Date' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'applied', label: 'Applied' },
  { key: 'errors', label: 'Errors' },
  { key: 'rollbacks', label: 'Rollbacks' },
  { key: 'action', label: 'Action' },
];
const RELEASE_COLUMN_KEYS = RELEASE_COLUMN_OPTIONS.map((option) => option.key);
const DEFAULT_BUNDLE_COLUMNS: BundleTableColumn[] = [
  'version',
  'size',
  'uploaded',
  'targets',
  'action',
];
const DEFAULT_RELEASE_COLUMNS: ReleaseTableColumn[] = [
  'version',
  'channel',
  'date',
  'downloads',
  'applied',
  'rollbacks',
  'action',
];
const BUNDLE_COLUMN_WIDTHS: Record<BundleTableColumn, number> = {
  version: 160,
  size: 90,
  uploaded: 110,
  targets: 180,
  downloads: 90,
  applied: 85,
  errors: 70,
  rollbacks: 90,
  action: 120,
};
const RELEASE_COLUMN_WIDTHS: Record<ReleaseTableColumn, number> = {
  version: 160,
  channel: 120,
  previous: 120,
  releaser: 150,
  date: 110,
  downloads: 90,
  applied: 85,
  errors: 70,
  rollbacks: 90,
  action: 120,
};

/* ─── Platform Icons ──────────────────────────────────────────────── */

function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  const src = platform === 'ios' ? '/apple.svg' : '/android.svg';
  const alt = platform === 'ios' ? 'iOS' : 'Android';
  return (
    <Image
      src={src}
      alt={alt}
      width={16}
      height={16}
      className={`dark:invert ${platform === 'android' ? 'opacity-60' : ''} ${className ?? ''}`}
    />
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncate(value: string, size = 8): string {
  return value.length <= size ? value : `${value.slice(0, size)}...`;
}

async function parseJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (raw.trim().length === 0) {
    return {} as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error('Invalid server response');
  }
}

function formatReleasedBy(value: string | null): string {
  if (!value) return 'unknown';
  if (value.startsWith('api-key:')) return value.replace('api-key:', 'api key: ');
  if (value === 'cli') return 'legacy cli';
  return value;
}

function formatEventPlatform(platform: Platform): string {
  return platform === 'ios' ? 'iOS' : 'Android';
}

function formatEventAction(action: string): string {
  if (action === 'downloaded') return 'Downloaded';
  if (action === 'applied') return 'Applied';
  if (action === 'download_error') return 'Download error';
  if (action === 'rollback') return 'Rollback';
  return action.replace(/_/g, ' ');
}

function getReleaseTargetKey(channel: string | null): string {
  return channel ?? BASE_RELEASE_STREAM_KEY;
}

function compareReleaseTargets(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return -1;
  }
  if (b === null) {
    return 1;
  }
  return a.localeCompare(b);
}

function formatReleaseTarget(channel: string | null): string {
  return channel ?? BASE_RELEASE_STREAM_LABEL;
}

function isValidChannelName(channel: string): boolean {
  return CHANNEL_NAME_REGEX.test(channel) && !RESERVED_CHANNEL_NAMES.has(channel.toLowerCase());
}

function isCurrentOnChannel(bundle: BundleSummaryItem, channel: string | null): boolean {
  return bundle.currentChannels.some((currentChannel) => currentChannel === channel);
}

function findCurrentVersionOnChannel(
  bundles: BundleSummaryItem[],
  channel: string | null,
): string | null {
  const currentBundle = bundles.find((bundle) =>
    bundle.currentChannels.some((currentChannel) => currentChannel === channel),
  );
  return currentBundle?.version ?? null;
}

function findCurrentReleaseOnChannel(
  releases: ReleaseHistoryItem[],
  channel: string | null,
): ReleaseHistoryItem | null {
  return releases.find((release) => release.channel === channel && release.revertedAt === null) ?? null;
}

function getDefaultReleaseTargetKey(
  bundle: BundleSummaryItem,
  channels: Array<string | null>,
): string {
  const firstAvailableChannel = channels.find((channel) => !isCurrentOnChannel(bundle, channel));
  return firstAvailableChannel === undefined
    ? NEW_RELEASE_STREAM_KEY
    : getReleaseTargetKey(firstAvailableChannel);
}

function rebuildPreviewCurrentReleaseState(
  bundles: BundleSummaryItem[],
  releases: ReleaseHistoryItem[],
): BundleSummaryItem[] {
  const currentChannelsByBundleId = new Map<string, Array<string | null>>();
  const seenChannels = new Set<string>();

  for (const release of releases) {
    if (release.revertedAt !== null) {
      continue;
    }

    const channelKey = getReleaseTargetKey(release.channel);
    if (seenChannels.has(channelKey)) {
      continue;
    }

    seenChannels.add(channelKey);
    const currentChannels = currentChannelsByBundleId.get(release.bundleId) ?? [];
    currentChannels.push(release.channel);
    currentChannelsByBundleId.set(release.bundleId, currentChannels);
  }

  return bundles.map((bundle) => {
    const currentChannels = [...(currentChannelsByBundleId.get(bundle.id) ?? [])].sort(
      compareReleaseTargets,
    );

    return {
      ...bundle,
      currentChannels,
      isLive: currentChannels.includes(null),
    };
  });
}

function createEmptyEventCounts() {
  return { downloads: 0, applied: 0, downloadErrors: 0, rollbacks: 0 };
}

function readStoredColumns<T extends string>(
  storageKey: string,
  options: readonly T[],
  defaults: readonly T[],
): T[] {
  if (typeof window === 'undefined') {
    return [...defaults];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [...defaults];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [...defaults];
    }

    const allowed = new Set(options);
    const selected = new Set(
      parsed.filter((value): value is T => typeof value === 'string' && allowed.has(value as T)),
    );

    return options.filter((option) => selected.has(option));
  } catch {
    return [...defaults];
  }
}

function toggleOrderedColumn<T extends string>(
  selected: readonly T[],
  column: T,
  options: readonly T[],
): T[] {
  const next = new Set(selected);
  if (next.has(column)) {
    next.delete(column);
  } else {
    next.add(column);
  }

  return options.filter((option) => next.has(option));
}

const EVENT_ACTION_OPTIONS: Array<{ value: EventActionFilter; label: string; icon?: ElementType }> =
  [
    { value: 'all', label: 'All actions', icon: Activity },
    { value: 'downloaded', label: 'Downloaded' },
    { value: 'applied', label: 'Applied' },
    { value: 'download_error', label: 'Download error' },
    { value: 'rollback', label: 'Rollback' },
  ];

const EVENT_TIMEFRAME_OPTIONS: Array<{
  value: EventTimeframeFilter;
  label: string;
  icon: ElementType;
}> = [
  { value: '1h', label: 'Last 1 hour', icon: Clock },
  { value: '24h', label: 'Last 24 hours', icon: Clock },
  { value: '7d', label: 'Last 7 days', icon: Calendar },
  { value: '30d', label: 'Last 30 days', icon: Calendar },
];

type ProductDashboardProps = {
  initialData: DashboardInitialData;
  previewData?: DashboardPreviewData;
  shellClassName?: string;
  brandHref?: string;
  dashboardHref?: string;
  settingsHref?: string;
  docsHref?: string;
};

function getEventTimeframeStart(timeframe: EventTimeframeFilter): number {
  const now = Date.now();
  const hour = 60 * 60 * 1000;

  if (timeframe === '1h') return now - hour;
  if (timeframe === '24h') return now - 24 * hour;
  if (timeframe === '7d') return now - 7 * 24 * hour;
  return now - 30 * 24 * hour;
}

function filterPreviewEvents(
  events: DeviceEvent[],
  {
    platform,
    bundle,
    action,
    timeframe,
  }: {
    platform: EventPlatformFilter;
    bundle: string;
    action: EventActionFilter;
    timeframe: EventTimeframeFilter;
  },
): DeviceEvent[] {
  const timeframeStart = getEventTimeframeStart(timeframe);

  return events
    .filter((event) => {
      if (platform !== 'all' && event.platform !== platform) return false;
      if (bundle !== 'all' && event.bundleVersion !== bundle) return false;
      if (action !== 'all' && event.action !== action) return false;
      return new Date(event.createdAt).getTime() >= timeframeStart;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/* ─── Main Component ───────────────────────────────────────────────── */

export function ProductDashboard({
  initialData,
  previewData,
  shellClassName,
  brandHref,
  dashboardHref,
  settingsHref,
  docsHref,
}: ProductDashboardProps) {
  const router = useRouter();
  const isPreview = previewData !== undefined;
  const selectionStorageKey = isPreview ? 'selectedPreviewAppId' : 'selectedAppId';
  const [apps, setApps] = useState<AppSummary[]>(initialData.apps);
  const [previewAppsById, setPreviewAppsById] = useState<Record<string, DashboardPreviewAppData>>(
    previewData?.appsById ?? {},
  );

  // App — persist selection in localStorage
  const [selectedAppId, setSelectedAppId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return initialData.apps[0]?.id ?? null;
    const saved = localStorage.getItem(selectionStorageKey);
    if (saved && initialData.apps.some((a) => a.id === saved)) return saved;
    return initialData.apps[0]?.id ?? null;
  });
  useEffect(() => {
    if (selectedAppId) localStorage.setItem(selectionStorageKey, selectedAppId);
    else localStorage.removeItem(selectionStorageKey);
  }, [selectedAppId, selectionStorageKey]);

  useEffect(() => {
    if (!isPreview) {
      setApps(initialData.apps);
    }
  }, [initialData.apps, isPreview]);

  // Bundles (one row per version)
  const [bundles, setBundles] = useState<BundleSummaryItem[]>([]);
  const [loadingBundles, setLoadingBundles] = useState(false);
  const [bundlesLoadedOnce, setBundlesLoadedOnce] = useState(false);
  const [releaseHistory, setReleaseHistory] = useState<ReleaseHistoryItem[]>([]);
  const [loadingReleaseHistory, setLoadingReleaseHistory] = useState(false);
  const [releasesLoadedOnce, setReleasesLoadedOnce] = useState(false);
  const dashboardReady = !selectedAppId || (bundlesLoadedOnce && releasesLoadedOnce);

  // Events (loaded with filters)
  const [appEvents, setAppEvents] = useState<DeviceEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventPlatform, setEventPlatform] = useState<EventPlatformFilter>('all');
  const [eventBundle, setEventBundle] = useState<string>('all');
  const [eventAction, setEventAction] = useState<EventActionFilter>('all');
  const [eventTimeframe, setEventTimeframe] = useState<EventTimeframeFilter>('24h');
  const [visibleBundleCount, setVisibleBundleCount] = useState(5);
  const [visibleReleaseCount, setVisibleReleaseCount] = useState(5);
  const [visibleEventCount, setVisibleEventCount] = useState(20);
  const [bundleColumnsDialogOpen, setBundleColumnsDialogOpen] = useState(false);
  const [releaseColumnsDialogOpen, setReleaseColumnsDialogOpen] = useState(false);
  const [bundleColumns, setBundleColumns] = useState<BundleTableColumn[]>(() =>
    readStoredColumns(BUNDLE_COLUMNS_STORAGE_KEY, BUNDLE_COLUMN_KEYS, DEFAULT_BUNDLE_COLUMNS),
  );
  const [bundleColumnsDraft, setBundleColumnsDraft] = useState<BundleTableColumn[]>(bundleColumns);
  const [releaseColumns, setReleaseColumns] = useState<ReleaseTableColumn[]>(() =>
    readStoredColumns(RELEASE_COLUMNS_STORAGE_KEY, RELEASE_COLUMN_KEYS, DEFAULT_RELEASE_COLUMNS),
  );
  const [releaseColumnsDraft, setReleaseColumnsDraft] =
    useState<ReleaseTableColumn[]>(releaseColumns);
  const [appIdCopied, setAppIdCopied] = useState(false);

  // Release
  const [releasingAction, setReleasingAction] = useState<{
    version: string;
    channel: string | null;
  } | null>(null);
  const [releaseConfirm, setReleaseConfirm] = useState<{
    bundle: BundleSummaryItem;
    selectedTargetKey: string;
    newChannelName: string;
  } | null>(null);

  // Revert
  const [revertConfirm, setRevertConfirm] = useState<{
    releaseId: string;
    channel: string | null;
    currentVersion: string;
    previousVersion: string | null;
  } | null>(null);
  const [revertBusy, setRevertBusy] = useState(false);

  // Create app
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newAppSlug, setNewAppSlug] = useState('');
  const [creatingApp, setCreatingApp] = useState(false);

  // Messages (via toast)

  // Derived
  const selectedApp = useMemo(
    () => apps.find((a) => a.id === selectedAppId) ?? null,
    [apps, selectedAppId],
  );

  useEffect(() => {
    if (apps.length === 0) {
      if (selectedAppId !== null) setSelectedAppId(null);
      return;
    }

    if (selectedAppId === null || !apps.some((app) => app.id === selectedAppId)) {
      setSelectedAppId(apps[0]?.id ?? null);
    }
  }, [apps, selectedAppId]);

  const releaseChannels = useMemo(() => {
    const targets = new Map<string, string | null>();
    targets.set(BASE_RELEASE_STREAM_KEY, null);

    for (const bundle of bundles) {
      for (const channel of bundle.currentChannels) {
        targets.set(getReleaseTargetKey(channel), channel);
      }
      for (const entry of bundle.deployedChannels) {
        targets.set(getReleaseTargetKey(entry.channel), entry.channel);
      }
    }

    for (const release of releaseHistory) {
      targets.set(getReleaseTargetKey(release.channel), release.channel);
    }

    return Array.from(targets.values()).sort(compareReleaseTargets);
  }, [bundles, releaseHistory]);
  const releaseSelectedChannel = useMemo(() => {
    if (!releaseConfirm) {
      return null;
    }

    if (releaseConfirm.selectedTargetKey === BASE_RELEASE_STREAM_KEY) {
      return null;
    }

    if (releaseConfirm.selectedTargetKey === NEW_RELEASE_STREAM_KEY) {
      const normalized = releaseConfirm.newChannelName.trim();
      return normalized.length > 0 ? normalized : null;
    }

    return releaseChannels.find(
      (channel) => getReleaseTargetKey(channel) === releaseConfirm.selectedTargetKey,
    ) ?? null;
  }, [releaseChannels, releaseConfirm]);
  const releaseCurrentVersion = useMemo(() => {
    if (!releaseConfirm) {
      return null;
    }

    return findCurrentVersionOnChannel(bundles, releaseSelectedChannel);
  }, [bundles, releaseConfirm, releaseSelectedChannel]);
  const releaseConfirmBusy =
    releaseConfirm !== null &&
    releasingAction?.version === releaseConfirm.bundle.version &&
    releasingAction.channel === releaseSelectedChannel;
  const isCreatingNewReleaseChannel =
    releaseConfirm?.selectedTargetKey === NEW_RELEASE_STREAM_KEY;
  const releaseChannelMissing = useMemo(() => {
    if (!releaseConfirm || releaseConfirm.selectedTargetKey !== NEW_RELEASE_STREAM_KEY) {
      return false;
    }

    return releaseConfirm.newChannelName.trim().length === 0;
  }, [releaseConfirm]);
  const releaseChannelError = useMemo(() => {
    if (!releaseConfirm || releaseConfirm.selectedTargetKey !== NEW_RELEASE_STREAM_KEY) {
      return null;
    }

    const normalized = releaseConfirm.newChannelName.trim();
    if (normalized.length === 0) {
      return null;
    }
    if (
      releaseChannels.some(
        (channel) => channel !== null && channel.toLowerCase() === normalized.toLowerCase(),
      )
    ) {
      return 'already_exists';
    }
    if (RESERVED_CHANNEL_NAMES.has(normalized.toLowerCase())) {
      return 'reserved';
    }
    if (!isValidChannelName(normalized)) {
      return 'invalid';
    }

    return null;
  }, [releaseChannels, releaseConfirm]);
  const releaseAlreadyCurrent =
    releaseConfirm !== null &&
    !isCreatingNewReleaseChannel &&
    releaseChannelError === null &&
    isCurrentOnChannel(releaseConfirm.bundle, releaseSelectedChannel);

  const eventBundleOptions = useMemo(() => bundles.map((bundle) => bundle.version), [bundles]);

  const hideChannelColumns = useMemo(() => {
    return releaseChannels.length === 1 && releaseChannels[0] === null;
  }, [releaseChannels]);
  const bundleColumnOptions = useMemo(
    () =>
      BUNDLE_COLUMN_OPTIONS.map((option) =>
        option.key === 'targets'
          ? { ...option, label: hideChannelColumns ? 'Status' : 'Channels' }
          : option,
      ),
    [hideChannelColumns],
  );
  const releaseColumnOptions = useMemo(
    () =>
      hideChannelColumns
        ? RELEASE_COLUMN_OPTIONS.filter((option) => option.key !== 'channel')
        : RELEASE_COLUMN_OPTIONS,
    [hideChannelColumns],
  );
  const bundleColumnSet = useMemo(() => new Set(bundleColumns), [bundleColumns]);
  const releaseColumnSet = useMemo(() => new Set(releaseColumns), [releaseColumns]);
  const hasBundleColumn = useCallback(
    (column: BundleTableColumn) => bundleColumnSet.has(column),
    [bundleColumnSet],
  );
  const hasReleaseColumn = useCallback(
    (column: ReleaseTableColumn) => releaseColumnSet.has(column),
    [releaseColumnSet],
  );
  const bundleTableMinWidth = Math.max(
    160,
    bundleColumns.reduce((total, column) => total + BUNDLE_COLUMN_WIDTHS[column], 0),
  );
  const releaseTableMinWidth = Math.max(
    160,
    releaseColumns.reduce((total, column) => {
      if (column === 'channel' && hideChannelColumns) {
        return total;
      }
      return total + RELEASE_COLUMN_WIDTHS[column];
    }, 0),
  );

  // ── Data loading ──────────────────────────────────────────────────

  const loadBundles = useCallback(
    async (appId: string) => {
      setLoadingBundles(true);
      try {
        if (isPreview) {
          const previewApp = previewAppsById[appId];
          setBundles(previewApp?.bundles ?? []);
          return;
        }

        const res = await fetch(`/api/v1/apps/${encodeURIComponent(appId)}/bundles/summary`);
        const data = await parseJson<{ bundles?: BundleSummaryItem[] } & ApiError>(res);
        if (!res.ok) throw new Error(data.error ?? 'Failed to load bundles');
        setBundles(data.bundles ?? []);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load bundles');
        setBundles([]);
      } finally {
        setLoadingBundles(false);
        setBundlesLoadedOnce(true);
      }
    },
    [isPreview, previewAppsById],
  );

  const loadEvents = useCallback(
    async (appId: string) => {
      setLoadingEvents(true);
      try {
        if (isPreview) {
          const previewApp = previewAppsById[appId];
          setAppEvents(
            filterPreviewEvents(previewApp?.events ?? [], {
              platform: eventPlatform,
              bundle: eventBundle,
              action: eventAction,
              timeframe: eventTimeframe,
            }),
          );
          return;
        }

        const params = new URLSearchParams({
          platform: eventPlatform,
          bundle: eventBundle,
          action: eventAction,
          timeframe: eventTimeframe,
          limit: '100',
        });
        const res = await fetch(
          `/api/v1/apps/${encodeURIComponent(appId)}/events?${params.toString()}`,
        );
        const data = await parseJson<{ events?: DeviceEvent[] } & ApiError>(res);
        if (!res.ok) throw new Error(data.error ?? 'Failed to load events');
        setAppEvents(data.events ?? []);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load events');
        setAppEvents([]);
      } finally {
        setLoadingEvents(false);
      }
    },
    [eventAction, eventBundle, eventPlatform, eventTimeframe, isPreview, previewAppsById],
  );

  const loadReleaseHistory = useCallback(
    async (appId: string) => {
      setLoadingReleaseHistory(true);
      try {
        if (isPreview) {
          const previewApp = previewAppsById[appId];
          setReleaseHistory(previewApp?.releases ?? []);
          return;
        }

        const res = await fetch(`/api/v1/apps/${encodeURIComponent(appId)}/releases?limit=100`);
        const data = await parseJson<{ releases?: ReleaseHistoryItem[] } & ApiError>(res);
        if (!res.ok) throw new Error(data.error ?? 'Failed to load release history');
        setReleaseHistory(data.releases ?? []);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load release history');
        setReleaseHistory([]);
      } finally {
        setLoadingReleaseHistory(false);
        setReleasesLoadedOnce(true);
      }
    },
    [isPreview, previewAppsById],
  );

  useEffect(() => {
    setBundlesLoadedOnce(false);
    setReleasesLoadedOnce(false);
    if (!selectedAppId) {
      setBundles([]);
      setAppEvents([]);
      setReleaseHistory([]);
      return;
    }
    void loadBundles(selectedAppId);
  }, [loadBundles, selectedAppId]);

  useEffect(() => {
    if (!selectedAppId) {
      setAppEvents([]);
      return;
    }
    void loadEvents(selectedAppId);
  }, [loadEvents, selectedAppId]);

  useEffect(() => {
    if (!selectedAppId) {
      setReleaseHistory([]);
      return;
    }
    void loadReleaseHistory(selectedAppId);
  }, [loadReleaseHistory, selectedAppId]);

  useEffect(() => {
    if (eventBundle === 'all') {
      return;
    }
    if (!eventBundleOptions.includes(eventBundle)) {
      setEventBundle('all');
    }
  }, [eventBundle, eventBundleOptions]);

  useEffect(() => {
    setEventBundle('all');
  }, [selectedAppId]);

  useEffect(() => {
    setVisibleBundleCount(5);
    setVisibleReleaseCount(5);
    setVisibleEventCount(20);
  }, [selectedAppId]);

  useEffect(() => {
    setAppIdCopied(false);
  }, [selectedAppId]);

  useEffect(() => {
    setVisibleEventCount(20);
  }, [eventPlatform, eventBundle, eventAction, eventTimeframe]);

  useEffect(() => {
    window.localStorage.setItem(BUNDLE_COLUMNS_STORAGE_KEY, JSON.stringify(bundleColumns));
  }, [bundleColumns]);

  useEffect(() => {
    window.localStorage.setItem(RELEASE_COLUMNS_STORAGE_KEY, JSON.stringify(releaseColumns));
  }, [releaseColumns]);

  // ── Actions ───────────────────────────────────────────────────────

  function openBundleColumnsDialog() {
    setBundleColumnsDraft(bundleColumns);
    setBundleColumnsDialogOpen(true);
  }

  function cancelBundleColumnsDialog() {
    setBundleColumnsDraft(bundleColumns);
    setBundleColumnsDialogOpen(false);
  }

  function saveBundleColumnsDialog() {
    setBundleColumns(bundleColumnsDraft);
    setBundleColumnsDialogOpen(false);
  }

  function openReleaseColumnsDialog() {
    setReleaseColumnsDraft(releaseColumns);
    setReleaseColumnsDialogOpen(true);
  }

  function cancelReleaseColumnsDialog() {
    setReleaseColumnsDraft(releaseColumns);
    setReleaseColumnsDialogOpen(false);
  }

  function saveReleaseColumnsDialog() {
    setReleaseColumns(releaseColumnsDraft);
    setReleaseColumnsDialogOpen(false);
  }

  function requestRelease(bundle: BundleSummaryItem) {
    if (releasingAction !== null) return;
    setReleaseConfirm({
      bundle,
      selectedTargetKey: getDefaultReleaseTargetKey(bundle, releaseChannels),
      newChannelName: '',
    });
  }

  async function releaseBundle(
    bundle: BundleSummaryItem,
    channel: string | null,
  ): Promise<boolean> {
    if (!selectedAppId) return false;
    if (isCurrentOnChannel(bundle, channel)) {
      toast.success(`${bundle.version} is already current on ${formatReleaseTarget(channel)}`);
      return false;
    }

    setReleasingAction({ version: bundle.version, channel });
    try {
      if (isPreview) {
        const promotedAt = new Date().toISOString();

        setPreviewAppsById((current) => {
          const previewApp = current[selectedAppId];
          if (!previewApp) {
            return current;
          }

          const previousRelease = findCurrentReleaseOnChannel(previewApp.releases, channel);
          const bundlesWithDeployment = previewApp.bundles.map((item) => {
            if (item.id === bundle.id) {
              return {
                ...item,
                deployedChannels: [
                  { channel, deployedAt: promotedAt },
                  ...item.deployedChannels.filter((entry) => entry.channel !== channel),
                ].sort(
                  (a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime(),
                ),
              };
            }

            return {
              ...item,
            };
          });

          const nextReleases: ReleaseHistoryItem[] = [
            {
              id: `preview-release-${Date.now()}`,
              channel,
              bundleId: bundle.id,
              bundleVersion: bundle.version,
              previousBundleId: previousRelease?.bundleId ?? null,
              previousBundleVersion: previousRelease?.bundleVersion ?? null,
              promotedAt,
              promotedBy: 'preview@otakit.app',
              revertedAt: null,
              revertedBy: null,
              eventCounts: createEmptyEventCounts(),
            },
            ...previewApp.releases,
          ];
          const bundlesForApp = rebuildPreviewCurrentReleaseState(
            bundlesWithDeployment,
            nextReleases,
          );

          return {
            ...current,
            [selectedAppId]: {
              ...previewApp,
              bundles: bundlesForApp,
              releases: nextReleases,
            },
          };
        });

        toast.success(`Released ${bundle.version} to ${formatReleaseTarget(channel)}`);
        setReleaseConfirm(null);
        return true;
      }

      const res = await fetch(`/api/v1/apps/${encodeURIComponent(selectedAppId)}/releases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundleId: bundle.id, channel }),
      });
      const data = await parseJson<ApiError>(res);
      if (!res.ok) throw new Error(data.error ?? 'Release failed');
      toast.success(`Released ${bundle.version} to ${formatReleaseTarget(channel)}`);
      await Promise.all([
        loadBundles(selectedAppId),
        loadEvents(selectedAppId),
        loadReleaseHistory(selectedAppId),
      ]);
      setReleaseConfirm(null);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Release failed');
      return false;
    } finally {
      setReleasingAction(null);
    }
  }

  async function confirmRelease() {
    if (!releaseConfirm) return;
    if (releaseChannelError || releaseChannelMissing) {
      return;
    }
    await releaseBundle(releaseConfirm.bundle, releaseSelectedChannel);
  }

  function openRevertConfirm(row: ReleaseHistoryItem) {
    setRevertConfirm({
      releaseId: row.id,
      channel: row.channel,
      currentVersion: row.bundleVersion,
      previousVersion: row.previousBundleVersion ?? null,
    });
  }

  async function performRevert() {
    if (!selectedAppId || !revertConfirm || revertBusy) return;
    setRevertBusy(true);
    try {
      if (isPreview) {
        const revertedAt = new Date().toISOString();
        setPreviewAppsById((current) => {
          const previewApp = current[selectedAppId];
          if (!previewApp) {
            return current;
          }

          const nextReleases = previewApp.releases.map((release) =>
            release.id === revertConfirm.releaseId
              ? {
                  ...release,
                  revertedAt,
                  revertedBy: 'preview@otakit.app',
                }
              : release,
          );
          const nextBundles = rebuildPreviewCurrentReleaseState(previewApp.bundles, nextReleases);

          return {
            ...current,
            [selectedAppId]: {
              ...previewApp,
              bundles: nextBundles,
              releases: nextReleases,
            },
          };
        });

        toast.success(`Reverted ${formatReleaseTarget(revertConfirm.channel)}`);
        setRevertConfirm(null);
        return;
      }

      const res = await fetch(
        `/api/v1/apps/${encodeURIComponent(selectedAppId)}/releases/${encodeURIComponent(revertConfirm.releaseId)}/revert`,
        {
          method: 'POST',
        },
      );
      const data = await parseJson<ApiError>(res);
      if (!res.ok) throw new Error(data.error ?? 'Revert failed');
      toast.success(`Reverted ${formatReleaseTarget(revertConfirm.channel)}`);
      setRevertConfirm(null);
      await Promise.all([loadBundles(selectedAppId), loadReleaseHistory(selectedAppId)]);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revert failed');
    } finally {
      setRevertBusy(false);
    }
  }

  async function createApp() {
    const slug = newAppSlug.trim();
    if (!slug) return toast.error('App slug is required');
    setCreatingApp(true);
    toast.dismiss();
    try {
      if (isPreview) {
        const createdAt = new Date().toISOString();
        const id = `preview-app-${slug.replace(/[^a-z0-9.-]/gi, '-').toLowerCase()}-${Date.now()}`;

        setApps((current) => [{ id, slug, createdAt, bundleCount: 0 }, ...current]);
        setPreviewAppsById((current) => ({
          ...current,
          [id]: {
            bundles: [],
            releases: [],
            events: [],
          },
        }));
        setSelectedAppId(id);
        setCreateDialogOpen(false);
        setNewAppSlug('');
        toast.success('Preview app created');
        return;
      }

      const res = await fetch('/api/v1/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const data = await parseJson<ApiError & { id?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Failed to create app');
      setCreateDialogOpen(false);
      setNewAppSlug('');
      if (data.id) setSelectedAppId(data.id);
      toast.success('App created');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create app');
    } finally {
      setCreatingApp(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className={cn('m-3 min-h-screen border border-border bg-background', shellClassName)}>
      <DashboardHeader
        activeSection="dashboard"
        brandHref={brandHref}
        dashboardHref={dashboardHref}
        settingsHref={settingsHref}
        docsHref={docsHref}
      />

      <main className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">
        <div className="pointer-events-none absolute inset-0 hidden justify-center sm:flex">
          <div className="h-full w-full max-w-screen-xl border-x border-border" />
        </div>
        <div className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">
          {/* Messages handled by sonner toast */}

          {/* App selector bar */}
          <section className="border-b border-border">
            <div className="mx-auto max-w-screen-xl">
              <div className="flex flex-wrap items-center gap-3 px-6 py-4">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Cpu className="size-4 text-muted-foreground" />
                  Apps
                </h2>
                <div className="mx-1 h-4 w-px bg-border" />
                {apps.length > 0 ? (
                  <>
                    <Select value={selectedAppId ?? ''} onValueChange={setSelectedAppId}>
                      <SelectTrigger className="h-8 w-40 border-0 bg-transparent px-2 font-semibold shadow-none hover:bg-accent sm:w-56">
                        <SelectValue placeholder="Select app" />
                      </SelectTrigger>
                      <SelectContent>
                        {apps.map((app) => (
                          <SelectItem key={app.id} value={app.id}>
                            {app.slug}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selectedApp ? (
                      <div className="hidden items-center gap-3 sm:flex">
                        <Separator orientation="vertical" className="h-4" />
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Hash className="size-3" />
                          App ID
                        </span>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() => {
                            void navigator.clipboard.writeText(selectedApp.id);
                            setAppIdCopied(true);
                            toast.success('App ID copied');
                            setTimeout(() => setAppIdCopied(false), 2000);
                          }}
                          title={appIdCopied ? 'Copied' : 'Copy app ID'}
                        >
                          {truncate(selectedApp.id, 12)}
                          {appIdCopied ? (
                            <Check className="size-3 text-emerald-500" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">No apps</span>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-8"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus className="size-3.5" />
                  New app
                </Button>
              </div>
            </div>
          </section>

          {/* Channels button is in the Bundles header */}

          {/* Loading gate — wait for bundles + release history before showing content */}
          {!dashboardReady ? (
            <div className="flex flex-1 items-center justify-center py-24">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* No apps empty state */}
              {apps.length === 0 ? (
                <section>
                  <div className="mx-auto max-w-screen-xl border-b border-border">
                    <div className="p-5">
                      <div className="rounded-lg border border-dashed border-border py-12 text-center">
                        <Cpu className="mx-auto size-6 text-muted-foreground/40" />
                        <p className="mt-3 text-sm font-medium">No apps yet</p>
                        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                          Create an app here or register one with the CLI using{' '}
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            otakit register --slug com.example.app
                          </code>
                        </p>
                        <div className="mt-5">
                          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                            <Plus className="size-3.5" />
                            Create app
                          </Button>
                        </div>
                        <p className="mt-4">
                          <Link
                            href="/docs/setup"
                            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                          >
                            Read the setup guide
                          </Link>
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {/* Bundles */}
              {selectedApp ? (
                <section className="">
                  <div className="mx-auto max-w-screen-xl">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-4">
                      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                        <Package className="size-4 text-muted-foreground" />
                        Bundles
                      </h2>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-7 w-7 text-muted-foreground/45 hover:text-muted-foreground"
                        onClick={openBundleColumnsDialog}
                      >
                        <SlidersHorizontal className="size-3.5" />
                        <span className="sr-only">Edit bundle columns</span>
                      </Button>
                      {/* {releaseChannels.map((channel) => (
                    <Badge
                      key={getReleaseTargetKey(channel)}
                      variant={channel === null ? 'default' : 'secondary'}
                      className="h-5 px-2 text-[10px]"
                    >
                      {formatReleaseTarget(channel)}
                    </Badge>
                  ))} */}
                    </div>

                    {bundles.length === 0 && !loadingBundles ? (
                      <div className="p-5">
                        <div className="border-dashed border-border py-12 text-center rounded-lg border">
                          <Download className="mx-auto size-6 text-muted-foreground/40" />
                          <p className="mt-3 text-sm font-medium">No bundles yet</p>
                          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                            Build your web assets and upload them with the{' '}
                            <Link
                              href="/docs/cli"
                              className="underline underline-offset-4 hover:text-foreground"
                            >
                              CLI
                            </Link>
                            .
                          </p>
                          <p className="mt-4">
                            <Link
                              href="/docs/setup"
                              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                            >
                              Read the setup guide
                            </Link>
                          </p>
                        </div>
                      </div>
                    ) : bundles.length > 0 ? (
                      <>
                        <div className="relative">
                          <div className="overflow-auto">
                            <Table
                              className="table-fixed"
                              style={{ minWidth: `${bundleTableMinWidth}px` }}
                            >
                              <TableHeader>
                                <TableRow>
                                  {hasBundleColumn('version') ? (
                                    <TableHead className="border-r border-border">
                                      Version
                                    </TableHead>
                                  ) : null}
                                  {hasBundleColumn('size') ? (
                                    <TableHead className="border-r border-border">Size</TableHead>
                                  ) : null}
                                  {hasBundleColumn('uploaded') ? (
                                    <TableHead className="border-r border-border">
                                      Uploaded
                                    </TableHead>
                                  ) : null}
                                  {hasBundleColumn('targets') ? (
                                    !hideChannelColumns ? (
                                      <TableHead className="border-r border-border">
                                        Channels
                                      </TableHead>
                                    ) : (
                                      <TableHead className="border-r border-border">
                                        Status
                                      </TableHead>
                                    )
                                  ) : null}
                                  {hasBundleColumn('downloads') ? (
                                    <TableHead
                                      className="w-[90px] border-r border-border text-right whitespace-nowrap"
                                      title={STAT_COLUMN_HINTS.downloads}
                                    >
                                      Downloads
                                    </TableHead>
                                  ) : null}
                                  {hasBundleColumn('applied') ? (
                                    <TableHead
                                      className="w-[85px] border-r border-border text-right whitespace-nowrap"
                                      title={STAT_COLUMN_HINTS.applied}
                                    >
                                      Applied
                                    </TableHead>
                                  ) : null}
                                  {hasBundleColumn('errors') ? (
                                    <TableHead
                                      className="w-[70px] border-r border-border text-right whitespace-nowrap"
                                      title={STAT_COLUMN_HINTS.errors}
                                    >
                                      Errors
                                    </TableHead>
                                  ) : null}
                                  {hasBundleColumn('rollbacks') ? (
                                    <TableHead
                                      className="w-[90px] border-r border-border text-right whitespace-nowrap"
                                      title={STAT_COLUMN_HINTS.rollbacks}
                                    >
                                      Rollbacks
                                    </TableHead>
                                  ) : null}
                                  {hasBundleColumn('action') ? (
                                    <TableHead className="w-[120px] text-center whitespace-nowrap">
                                      Action
                                    </TableHead>
                                  ) : null}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {bundles.slice(0, visibleBundleCount).map((b) => {
                                  const isReleasing = releasingAction?.version === b.version;
                                  const currentSet = new Set(b.currentChannels);

                                  return (
                                    <TableRow key={b.version}>
                                      {hasBundleColumn('version') ? (
                                        <TableCell className="border-r border-border font-mono text-sm font-semibold">
                                          <span className="block truncate" title={b.version}>
                                            {b.version}
                                          </span>
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('size') ? (
                                        <TableCell className="border-r border-border text-xs text-muted-foreground">
                                          {formatBytes(b.size)}
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('uploaded') ? (
                                        <TableCell className="border-r border-border text-xs text-muted-foreground">
                                          {formatDate(b.createdAt)}
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('targets') ? (
                                        !hideChannelColumns ? (
                                          <TableCell className="border-r border-border">
                                            {b.deployedChannels.length === 0 ? (
                                              <span className="text-xs text-muted-foreground">
                                                Not released
                                              </span>
                                            ) : (
                                              <div className="flex flex-wrap items-center gap-1">
                                                {b.deployedChannels.map((entry) => {
                                                  const isCurrent = currentSet.has(entry.channel);
                                                  return (
                                                    <span
                                                      key={getReleaseTargetKey(entry.channel)}
                                                      title={`Released ${formatDate(entry.deployedAt)}${isCurrent ? ' · current' : ''}`}
                                                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                                                        isCurrent
                                                          ? 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/25'
                                                          : 'bg-secondary text-secondary-foreground'
                                                      }`}
                                                    >
                                                      {isCurrent ? (
                                                        <Check
                                                          className="size-3 text-emerald-500"
                                                          strokeWidth={3}
                                                        />
                                                      ) : null}
                                                      {formatReleaseTarget(entry.channel)}
                                                    </span>
                                                  );
                                                })}
                                              </div>
                                            )}
                                          </TableCell>
                                        ) : (
                                          <TableCell className="border-r border-border">
                                            {b.isLive ? (
                                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/25">
                                                <Check
                                                  className="size-3 text-emerald-500"
                                                  strokeWidth={3}
                                                />
                                                Live
                                              </span>
                                            ) : b.deployedChannels[0] ? (
                                              <span
                                                className="text-xs text-muted-foreground"
                                                title={`Last served ${formatDate(b.deployedChannels[0].deployedAt)}`}
                                              >
                                                Released {formatDate(b.deployedChannels[0].deployedAt)}
                                              </span>
                                            ) : (
                                              <span className="text-xs text-muted-foreground">
                                                Not released
                                              </span>
                                            )}
                                          </TableCell>
                                        )
                                      ) : null}
                                      {hasBundleColumn('downloads') ? (
                                        <TableCell className="border-r border-border text-right text-xs tabular-nums text-muted-foreground">
                                          <span
                                            className="inline-flex items-center justify-end gap-1"
                                            title={STAT_COLUMN_HINTS.downloads}
                                          >
                                            <Download className="size-3 shrink-0" />
                                            {b.eventCounts.downloads}
                                          </span>
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('applied') ? (
                                        <TableCell className="border-r border-border text-right text-xs tabular-nums text-muted-foreground">
                                          <span
                                            className="inline-flex items-center justify-end gap-1"
                                            title={STAT_COLUMN_HINTS.applied}
                                          >
                                            <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
                                            {b.eventCounts.applied}
                                          </span>
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('errors') ? (
                                        <TableCell
                                          className={`border-r border-border text-right text-xs tabular-nums ${b.eventCounts.downloadErrors > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
                                        >
                                          <span
                                            className="inline-flex items-center justify-end gap-1"
                                            title={STAT_COLUMN_HINTS.errors}
                                          >
                                            <AlertTriangle className="size-3 shrink-0" />
                                            {b.eventCounts.downloadErrors}
                                          </span>
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('rollbacks') ? (
                                        <TableCell
                                          className={`border-r border-border text-right text-xs tabular-nums ${b.eventCounts.rollbacks > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                                        >
                                          <span
                                            className="inline-flex items-center justify-end gap-1"
                                            title={STAT_COLUMN_HINTS.rollbacks}
                                          >
                                            <RotateCcw className="size-3 shrink-0" />
                                            {b.eventCounts.rollbacks}
                                          </span>
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('action') ? (
                                        <TableCell className="text-center">
                                          <Button
                                            variant="default"
                                            size="sm"
                                            className="h-7 text-xs"
                                            disabled={releasingAction !== null}
                                            onClick={() => requestRelease(b)}
                                          >
                                            {isReleasing ? (
                                              <>
                                                <LoaderCircle className="size-3 animate-spin" />
                                                Releasing
                                              </>
                                            ) : (
                                              <>
                                                <Rocket className="size-3" />
                                                Release
                                              </>
                                            )}
                                          </Button>
                                        </TableCell>
                                      ) : null}
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                          {bundles.length > visibleBundleCount ? (
                            <button
                              type="button"
                              className="absolute -right-8 bottom-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
                              title="Load more"
                              onClick={() =>
                                setVisibleBundleCount((current) =>
                                  Math.min(current + 5, bundles.length),
                                )
                              }
                            >
                              <ChevronDown className="size-3" />
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <Separator className="" />

              {/* Release History */}
              {selectedApp ? (
                <section className="">
                  <div className="mx-auto max-w-screen-xl">
                    <div className="flex items-center gap-2 border-b border-border px-6 py-4">
                      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                        <Rocket className="size-4 text-muted-foreground" />
                        Releases
                      </h2>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-7 w-7 text-muted-foreground/45 hover:text-muted-foreground"
                        onClick={openReleaseColumnsDialog}
                      >
                        <SlidersHorizontal className="size-3.5" />
                        <span className="sr-only">Edit release columns</span>
                      </Button>
                    </div>

                    {releaseHistory.length === 0 && !loadingReleaseHistory ? (
                      <div className="p-5">
                        <div className="rounded-lg border border-dashed py-12 text-center">
                          <Rocket className="mx-auto size-6 text-muted-foreground/40" />
                          <p className="mt-3 text-sm font-medium">No release history yet</p>
                          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                            Release a bundle to start recording audit history.
                          </p>
                          <p className="mt-4">
                            <Link
                              href="/docs/setup"
                              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                            >
                              Read the setup guide
                            </Link>
                          </p>
                        </div>
                      </div>
                    ) : (
                      (() => {
                        const visible = releaseHistory.slice(0, visibleReleaseCount);

                        // Current release per channel = the most recent non-reverted release.
                        const currentReleaseIds = new Set<string>();
                        const seenChannels = new Set<string>();
                        for (const release of releaseHistory) {
                          const key = getReleaseTargetKey(release.channel);
                          if (!seenChannels.has(key) && release.revertedAt === null) {
                            currentReleaseIds.add(release.id);
                            seenChannels.add(key);
                          }
                        }

                        return (
                          <div className="relative">
                            <div className="overflow-auto">
                              <Table
                                className="table-fixed"
                                style={{ minWidth: `${releaseTableMinWidth}px` }}
                              >
                                <TableHeader>
                                  <TableRow>
                                    {hasReleaseColumn('version') ? (
                                      <TableHead className="border-r border-border">
                                        Bundle
                                      </TableHead>
                                    ) : null}
                                    {hasReleaseColumn('channel') && !hideChannelColumns ? (
                                      <TableHead className="border-r border-border">
                                        Channel
                                      </TableHead>
                                    ) : null}
                                    {hasReleaseColumn('previous') ? (
                                      <TableHead className="border-r border-border">
                                        Previous
                                      </TableHead>
                                    ) : null}
                                    {hasReleaseColumn('releaser') ? (
                                      <TableHead className="border-r border-border">
                                        Releaser
                                      </TableHead>
                                    ) : null}
                                    {hasReleaseColumn('date') ? (
                                      <TableHead className="border-r border-border">Date</TableHead>
                                    ) : null}
                                    {hasReleaseColumn('downloads') ? (
                                      <TableHead
                                        className="w-[90px] border-r border-border text-right whitespace-nowrap"
                                        title={STAT_COLUMN_HINTS.downloads}
                                      >
                                        Downloads
                                      </TableHead>
                                    ) : null}
                                    {hasReleaseColumn('applied') ? (
                                      <TableHead
                                        className="w-[85px] border-r border-border text-right whitespace-nowrap"
                                        title={STAT_COLUMN_HINTS.applied}
                                      >
                                        Applied
                                      </TableHead>
                                    ) : null}
                                    {hasReleaseColumn('errors') ? (
                                      <TableHead
                                        className="w-[70px] border-r border-border text-right whitespace-nowrap"
                                        title={STAT_COLUMN_HINTS.errors}
                                      >
                                        Errors
                                      </TableHead>
                                    ) : null}
                                    {hasReleaseColumn('rollbacks') ? (
                                      <TableHead
                                        className="w-[90px] border-r border-border text-right whitespace-nowrap"
                                        title={STAT_COLUMN_HINTS.rollbacks}
                                      >
                                        Rollbacks
                                      </TableHead>
                                    ) : null}
                                    {hasReleaseColumn('action') ? (
                                      <TableHead className="w-[120px] text-center whitespace-nowrap">
                                        Action
                                      </TableHead>
                                    ) : null}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {visible.map((row) => {
                                    const isCurrent = currentReleaseIds.has(row.id);
                                    const isReverted = row.revertedAt !== null;
                                    const canRevert = isCurrent && !isReverted;
                                    const counts = row.eventCounts ?? createEmptyEventCounts();

                                    return (
                                      <TableRow
                                        key={row.id}
                                        className={isReverted ? 'opacity-50' : undefined}
                                      >
                                        {hasReleaseColumn('version') ? (
                                          <TableCell className="border-r border-border">
                                            <span className="flex items-center gap-1.5">
                                              <span
                                                className="block max-w-full truncate font-mono text-sm font-medium"
                                                title={row.bundleVersion}
                                              >
                                                {row.bundleVersion}
                                              </span>
                                              {isCurrent ? (
                                                <Check
                                                  className="size-3.5 text-emerald-500"
                                                  strokeWidth={3}
                                                />
                                              ) : null}
                                            </span>
                                          </TableCell>
                                        ) : null}
                                        {hasReleaseColumn('channel') && !hideChannelColumns ? (
                                          <TableCell className="border-r border-border truncate text-sm text-muted-foreground">
                                            {formatReleaseTarget(row.channel)}
                                          </TableCell>
                                        ) : null}
                                        {hasReleaseColumn('previous') ? (
                                          <TableCell className="border-r border-border font-mono text-xs text-muted-foreground">
                                            <span
                                              className="block truncate"
                                              title={row.previousBundleVersion ?? '—'}
                                            >
                                              {row.previousBundleVersion ?? '—'}
                                            </span>
                                          </TableCell>
                                        ) : null}
                                        {hasReleaseColumn('releaser') ? (
                                          <TableCell className="border-r border-border truncate text-xs text-muted-foreground">
                                            {formatReleasedBy(row.promotedBy)}
                                          </TableCell>
                                        ) : null}
                                        {hasReleaseColumn('date') ? (
                                          <TableCell className="border-r border-border truncate text-xs text-muted-foreground">
                                            {formatDate(row.promotedAt)}
                                          </TableCell>
                                        ) : null}
                                        {hasReleaseColumn('downloads') ? (
                                          <TableCell className="border-r border-border text-right text-xs tabular-nums text-muted-foreground">
                                            <span
                                              className="inline-flex items-center justify-end gap-1"
                                              title={STAT_COLUMN_HINTS.downloads}
                                            >
                                              <Download className="size-3 shrink-0" />
                                              {counts.downloads}
                                            </span>
                                          </TableCell>
                                        ) : null}
                                        {hasReleaseColumn('applied') ? (
                                          <TableCell className="border-r border-border text-right text-xs tabular-nums text-muted-foreground">
                                            <span
                                              className="inline-flex items-center justify-end gap-1"
                                              title={STAT_COLUMN_HINTS.applied}
                                            >
                                              <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
                                              {counts.applied}
                                            </span>
                                          </TableCell>
                                        ) : null}
                                        {hasReleaseColumn('errors') ? (
                                          <TableCell
                                            className={`border-r border-border text-right text-xs tabular-nums ${counts.downloadErrors > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
                                          >
                                            <span
                                              className="inline-flex items-center justify-end gap-1"
                                              title={STAT_COLUMN_HINTS.errors}
                                            >
                                              <AlertTriangle className="size-3 shrink-0" />
                                              {counts.downloadErrors}
                                            </span>
                                          </TableCell>
                                        ) : null}
                                        {hasReleaseColumn('rollbacks') ? (
                                          <TableCell
                                            className={`border-r border-border text-right text-xs tabular-nums ${counts.rollbacks > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                                          >
                                            <span
                                              className="inline-flex items-center justify-end gap-1"
                                              title={STAT_COLUMN_HINTS.rollbacks}
                                            >
                                              <RotateCcw className="size-3 shrink-0" />
                                              {counts.rollbacks}
                                            </span>
                                          </TableCell>
                                        ) : null}
                                        {hasReleaseColumn('action') ? (
                                          <TableCell className="text-center">
                                            {isReverted ? (
                                              <span
                                                className="text-xs text-muted-foreground"
                                                title={`Reverted ${row.revertedAt ? formatDate(row.revertedAt) : 'recently'} by ${formatReleasedBy(row.revertedBy)}`}
                                              >
                                                Reverted
                                              </span>
                                            ) : canRevert ? (
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs"
                                                disabled={revertConfirm !== null}
                                                onClick={() => openRevertConfirm(row)}
                                              >
                                                <RotateCcw className="size-3" />
                                                Revert
                                              </Button>
                                            ) : null}
                                          </TableCell>
                                        ) : null}
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                            {releaseHistory.length > visibleReleaseCount ? (
                              <button
                                type="button"
                                className="absolute -right-8 bottom-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
                                title="Load more"
                                onClick={() =>
                                  setVisibleReleaseCount((current) =>
                                    Math.min(current + 5, releaseHistory.length),
                                  )
                                }
                              >
                                <ChevronDown className="size-3" />
                              </button>
                            ) : null}
                          </div>
                        );
                      })()
                    )}
                  </div>
                </section>
              ) : null}

              {selectedApp ? <Separator className="" /> : null}

              {/* Events */}
              {selectedApp ? (
                <section className="">
                  <div className="mx-auto max-w-screen-xl">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-4">
                      <div className="flex items-center gap-2 mr-5">
                        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                          <Activity className="size-4 text-muted-foreground" />
                          Events
                        </h2>
                      </div>

                      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-1 sm:flex-wrap sm:items-center">
                        <Select
                          value={eventPlatform}
                          onValueChange={(value) => setEventPlatform(value as EventPlatformFilter)}
                        >
                          <SelectTrigger className="h-8 w-full text-xs sm:w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">
                              <span className="flex items-center gap-1.5">
                                <Smartphone className="size-3.5 text-muted-foreground" />
                                All platforms
                              </span>
                            </SelectItem>
                            <SelectItem value="ios">
                              <span className="flex items-center gap-1.5">
                                <PlatformIcon platform="ios" className="size-4" /> iOS
                              </span>
                            </SelectItem>
                            <SelectItem value="android">
                              <span className="flex items-center gap-1.5">
                                <PlatformIcon platform="android" className="size-4" /> Android
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        <Select value={eventBundle} onValueChange={setEventBundle}>
                          <SelectTrigger className="h-8 w-full text-xs sm:w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">
                              <span className="flex items-center gap-1.5">
                                <Package className="size-3.5 text-muted-foreground" />
                                All bundles
                              </span>
                            </SelectItem>
                            {eventBundleOptions.map((version) => (
                              <SelectItem key={version} value={version}>
                                <span className="font-mono">{version}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={eventAction}
                          onValueChange={(value) => setEventAction(value as EventActionFilter)}
                        >
                          <SelectTrigger className="h-8 w-full text-xs sm:w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EVENT_ACTION_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.icon ? (
                                  <span className="flex items-center gap-1.5">
                                    <option.icon className="size-3.5 text-muted-foreground" />
                                    {option.label}
                                  </span>
                                ) : (
                                  option.label
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={eventTimeframe}
                          onValueChange={(value) =>
                            setEventTimeframe(value as EventTimeframeFilter)
                          }
                        >
                          <SelectTrigger className="h-8 w-full text-xs sm:w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EVENT_TIMEFRAME_OPTIONS.map((option) => {
                              const Icon = option.icon;
                              return (
                                <SelectItem key={option.value} value={option.value}>
                                  <span className="flex items-center gap-1.5">
                                    <Icon className="size-3.5 text-muted-foreground" />
                                    {option.label}
                                  </span>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="ml-auto hidden h-8 w-8 text-muted-foreground/55 hover:text-muted-foreground sm:inline-flex"
                          disabled={loadingEvents || !selectedAppId}
                          onClick={() => {
                            if (!selectedAppId) return;
                            void loadEvents(selectedAppId);
                          }}
                          title="Refresh events"
                        >
                          {loadingEvents ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="size-3.5" />
                          )}
                          <span className="sr-only">Refresh events</span>
                        </Button>
                      </div>
                    </div>

                    {appEvents.length === 0 && !loadingEvents ? (
                      <div className="p-5">
                        <div className="rounded-lg border border-dashed py-12 text-center">
                          <Clock className="mx-auto size-6 text-muted-foreground/40" />
                          <p className="mt-3 text-sm font-medium">No activity yet</p>
                          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                            Events appear here once devices with the{' '}
                            <Link
                              href="/docs/plugin"
                              className="underline underline-offset-4 hover:text-foreground"
                            >
                              plugin
                            </Link>{' '}
                            start checking for updates.
                          </p>
                          <p className="mt-4">
                            <Link
                              href="/docs/setup"
                              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                            >
                              Read the setup guide
                            </Link>
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="overflow-auto">
                          <Table className="min-w-[600px]">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="border-r border-border">Time</TableHead>
                                <TableHead className="border-r border-border">Platform</TableHead>
                                <TableHead className="border-r border-border">Action</TableHead>
                                <TableHead
                                  className={
                                    !hideChannelColumns ? 'border-r border-border' : undefined
                                  }
                                >
                                  Bundle Version
                                </TableHead>
                                {!hideChannelColumns ? <TableHead>Channel</TableHead> : null}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {appEvents.slice(0, visibleEventCount).map((ev) => (
                                <TableRow key={ev.id}>
                                  <TableCell className="border-r border-border truncate text-xs text-muted-foreground">
                                    {formatDate(ev.createdAt)}
                                  </TableCell>
                                  <TableCell className="border-r border-border truncate text-xs text-muted-foreground">
                                    {formatEventPlatform(ev.platform)}
                                  </TableCell>
                                  <TableCell className="border-r border-border truncate text-xs text-muted-foreground">
                                    {formatEventAction(ev.action)}
                                  </TableCell>
                                  <TableCell
                                    className={`font-mono text-sm ${!hideChannelColumns ? 'border-r border-border' : ''}`}
                                  >
                                    {ev.bundleVersion ? (
                                      <span className="block truncate" title={ev.bundleVersion}>
                                        {ev.bundleVersion}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">Unknown</span>
                                    )}
                                  </TableCell>
                                  {!hideChannelColumns ? (
                                    <TableCell className="truncate text-xs text-muted-foreground">
                                      {formatReleaseTarget(ev.channel)}
                                    </TableCell>
                                  ) : null}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        {appEvents.length > visibleEventCount ? (
                          <button
                            type="button"
                            className="absolute -right-8 bottom-2 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground sm:flex"
                            title="Load more"
                            onClick={() =>
                              setVisibleEventCount((current) =>
                                Math.min(current + 20, appEvents.length),
                              )
                            }
                          >
                            <ChevronDown className="size-3" />
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              <section className="flex-1">
                <div className="mx-auto h-full max-w-screen-xl" />
              </section>
            </>
          )}
        </div>
      </main>

      <ColumnSelectionDialog
        open={bundleColumnsDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            cancelBundleColumnsDialog();
          }
        }}
        title="Bundle columns"
        options={bundleColumnOptions}
        selected={bundleColumnsDraft}
        onToggle={(column) =>
          setBundleColumnsDraft((current) =>
            toggleOrderedColumn(current, column, BUNDLE_COLUMN_KEYS),
          )
        }
        onCancel={cancelBundleColumnsDialog}
        onSave={saveBundleColumnsDialog}
      />

      <ColumnSelectionDialog
        open={releaseColumnsDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            cancelReleaseColumnsDialog();
          }
        }}
        title="Release columns"
        options={releaseColumnOptions}
        selected={releaseColumnsDraft}
        onToggle={(column) =>
          setReleaseColumnsDraft((current) =>
            toggleOrderedColumn(current, column, RELEASE_COLUMN_KEYS),
          )
        }
        onCancel={cancelReleaseColumnsDialog}
        onSave={saveReleaseColumnsDialog}
      />

      {/* Confirm Release Dialog */}
      <Dialog
        open={releaseConfirm !== null}
        onOpenChange={(open) => {
          if (!open && !releaseConfirmBusy) {
            setReleaseConfirm(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="size-4" />
              Confirm release
            </DialogTitle>
            <DialogDescription>
              Choose the channel that should serve this bundle.
            </DialogDescription>
          </DialogHeader>
          {releaseConfirm ? (
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <Label htmlFor="release-channel">Channel</Label>
                <Select
                  value={releaseConfirm.selectedTargetKey}
                  onValueChange={(value) =>
                    setReleaseConfirm((current) =>
                      current
                        ? {
                            ...current,
                            selectedTargetKey: value,
                          }
                        : current,
                    )
                  }
                  disabled={releaseConfirmBusy}
                >
                  <SelectTrigger id="release-channel" className="w-full">
                    <SelectValue placeholder="Select channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {releaseChannels.map((channel) => (
                      <SelectItem
                        key={getReleaseTargetKey(channel)}
                        value={getReleaseTargetKey(channel)}
                        disabled={isCurrentOnChannel(releaseConfirm.bundle, channel)}
                      >
                        {formatReleaseTarget(channel)}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_RELEASE_STREAM_KEY}>New channel…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isCreatingNewReleaseChannel ? (
                <div className="space-y-2">
                  <Label htmlFor="new-release-channel">Channel name</Label>
                  <Input
                    id="new-release-channel"
                    placeholder="Enter a new channel name"
                    value={releaseConfirm.newChannelName}
                    onChange={(event) =>
                      setReleaseConfirm((current) =>
                        current
                          ? {
                              ...current,
                              newChannelName: event.target.value,
                            }
                          : current,
                      )
                    }
                    disabled={releaseConfirmBusy}
                  />
                </div>
              ) : null}
              {!isCreatingNewReleaseChannel ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Current</span>
                  <code className="font-mono text-xs">
                    {releaseCurrentVersion ?? 'Built-in app bundle'}
                  </code>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Release to</span>
                <code className="font-mono text-xs">{releaseConfirm.bundle.version}</code>
              </div>
              {releaseAlreadyCurrent ? (
                <p className="text-xs text-muted-foreground">
                  This bundle is already current on {formatReleaseTarget(releaseSelectedChannel)}.
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={releaseConfirmBusy}
              onClick={() => setReleaseConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                releaseConfirmBusy ||
                releaseConfirm === null ||
                releaseChannelMissing ||
                releaseChannelError !== null ||
                releaseAlreadyCurrent
              }
              onClick={() => void confirmRelease()}
            >
              {releaseConfirmBusy ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Releasing...
                </>
              ) : (
                <>
                  <Rocket className="size-3.5" />
                  Release
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Revert Dialog */}
      <Dialog
        open={revertConfirm !== null}
        onOpenChange={(open) => {
          if (!open && !revertBusy) setRevertConfirm(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="size-4" />
              Confirm revert
            </DialogTitle>
            <DialogDescription>
              Stop serving the currently active bundle on this channel.
            </DialogDescription>
          </DialogHeader>
          {revertConfirm ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Channel</span>
                <span className="font-medium">{formatReleaseTarget(revertConfirm.channel)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Current</span>
                <code className="font-mono text-xs">{revertConfirm.currentVersion}</code>
              </div>
              {revertConfirm.previousVersion ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Revert to</span>
                  <code className="font-mono text-xs">{revertConfirm.previousVersion}</code>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No previous release is available. Devices will fall back to the built-in app bundle.
                </p>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={revertBusy}
              onClick={() => setRevertConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revertBusy || revertConfirm === null}
              onClick={() => void performRevert()}
            >
              {revertBusy ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Reverting...
                </>
              ) : (
                <>
                  <RotateCcw className="size-3.5" />
                  Revert
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create App Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cpu className="size-4" />
              Create app
            </DialogTitle>
            <DialogDescription>
              Choose a stable identifier, e.g. <code className="text-xs">com.example.mobile</code>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-app-slug">App slug</Label>
            <Input
              id="new-app-slug"
              placeholder="com.example.mobile"
              value={newAppSlug}
              onChange={(e) => setNewAppSlug(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createApp} disabled={creatingApp}>
              {creatingApp ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="size-3.5" />
                  Create
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ColumnSelectionDialog<T extends string>({
  open,
  onOpenChange,
  title,
  options,
  selected,
  onToggle,
  onCancel,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  options: Array<{ key: T; label: string }>;
  selected: readonly T[];
  onToggle: (column: T) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" />
            {title}
          </DialogTitle>
          <DialogDescription>Saved only in this browser.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {options.map((option) => {
            const checkboxId = `${title}-${option.key}`;
            return (
              <label
                key={option.key}
                htmlFor={checkboxId}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 hover:bg-muted/40"
              >
                <Checkbox
                  id={checkboxId}
                  checked={selected.includes(option.key)}
                  onCheckedChange={() => onToggle(option.key)}
                />
                <span className="text-xs font-medium">{option.label}</span>
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
