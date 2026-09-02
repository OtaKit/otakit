'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState, useEffect, useCallback, type ElementType } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  BadgeCheck,
  Calendar,
  Check,
  ChevronDown,
  ChevronsUpDown,
  CircleAlert,
  Clock,
  Copy,
  Cpu,
  Download,
  Filter,
  Hash,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Smartphone,
} from 'lucide-react';

import { toast } from 'sonner';

import { DashboardHeader } from '@/app/components/DashboardHeader';
import { SetupInline } from '@/app/components/setup/SetupInline';
import { PricingDialog, type PricingDialogBillingData } from '@/app/components/PricingDialog';
import { trackConversion } from '@/lib/gtag';
import type {
  ApiError,
  AppSummary,
  BundleSummaryItem,
  DashboardInitialData,
  DeviceEvent,
  Platform,
  ReleaseHistoryItem,
} from '@/app/components/dashboard-types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  SelectSeparator,
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
type ReleaseTarget = {
  channel: string | null;
  runtimeVersion: string | null;
};
type BundleTableColumn =
  | 'version'
  | 'size'
  | 'uploaded'
  | 'runtime'
  | 'targets'
  | 'downloads'
  | 'applied'
  | 'errors'
  | 'rollbacks'
  | 'action';
const BASE_RELEASE_STREAM_LABEL = 'base';
const BASE_RELEASE_STREAM_KEY = '$base';
const NEW_RELEASE_STREAM_KEY = '$new';
const NULL_RUNTIME_TARGET_KEY = '$runtime-null';
const CHANNEL_NAME_REGEX = /^[A-Za-z0-9._-]{1,64}$/;
const RESERVED_CHANNEL_NAMES = new Set(['base', 'default']);
const BUNDLE_COLUMNS_STORAGE_KEY = 'dashboard:bundle-columns:v3';
const STAT_COLUMN_HINTS = {
  downloads: 'Devices that downloaded this update',
  applied: 'Devices that activated this update successfully',
  errors: 'Devices that failed to download or stage this update (e.g. due to disk space)',
  rollbacks: 'Devices that rolled back after activation (e.g. due to app crash)',
} as const;
const BUNDLE_COLUMN_OPTIONS: Array<{ key: BundleTableColumn; label: string }> = [
  { key: 'version', label: 'Version' },
  { key: 'runtime', label: 'Runtime' },
  { key: 'size', label: 'Size' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'targets', label: 'Targets' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'applied', label: 'Applied' },
  { key: 'errors', label: 'Errors' },
  { key: 'rollbacks', label: 'Rollbacks' },
  { key: 'action', label: 'Action' },
];
const BUNDLE_COLUMN_KEYS = BUNDLE_COLUMN_OPTIONS.map((option) => option.key);
const DEFAULT_BUNDLE_COLUMNS: BundleTableColumn[] = [
  'version',
  'runtime',
  'size',
  'uploaded',
  'targets',
  'action',
];
const BUNDLE_COLUMN_WIDTHS: Record<BundleTableColumn, number> = {
  version: 208,
  runtime: 208,
  size: 96,
  uploaded: 96,
  targets: 240,
  downloads: 64,
  applied: 64,
  errors: 64,
  rollbacks: 64,
  action: 116,
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

function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function formatTimeOnly(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
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

function getReleaseTargetKey(channel: string | null, runtimeVersion: string | null): string {
  return `${channel ?? BASE_RELEASE_STREAM_KEY}::${runtimeVersion ?? NULL_RUNTIME_TARGET_KEY}`;
}

function compareNullableStrings(a: string | null, b: string | null): number {
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

function compareReleaseTargets(a: ReleaseTarget, b: ReleaseTarget): number {
  const byChannel = compareNullableStrings(a.channel, b.channel);
  if (byChannel !== 0) {
    return byChannel;
  }
  return compareNullableStrings(a.runtimeVersion, b.runtimeVersion);
}

function formatReleaseTarget(channel: string | null, runtimeVersion: string | null): string {
  const label = channel ?? BASE_RELEASE_STREAM_LABEL;
  return runtimeVersion ? `${label} · ${runtimeVersion}` : label;
}

function parseIntegerInRange(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

function isValidChannelName(channel: string): boolean {
  return CHANNEL_NAME_REGEX.test(channel) && !RESERVED_CHANNEL_NAMES.has(channel.toLowerCase());
}

function isCurrentOnTarget(
  bundle: BundleSummaryItem,
  channel: string | null,
  runtimeVersion: string | null,
): boolean {
  return bundle.currentTargets.some(
    (target) => target.channel === channel && target.runtimeVersion === runtimeVersion,
  );
}

function findCurrentVersionOnTarget(
  bundles: BundleSummaryItem[],
  channel: string | null,
  runtimeVersion: string | null,
): string | null {
  const currentBundle = bundles.find((bundle) =>
    bundle.currentTargets.some(
      (target) => target.channel === channel && target.runtimeVersion === runtimeVersion,
    ),
  );
  return currentBundle?.version ?? null;
}

function getReleaseTargetsForRuntime(
  targets: ReleaseTarget[],
  runtimeVersion: string | null,
): ReleaseTarget[] {
  const byKey = new Map<string, ReleaseTarget>();
  const baseTarget = { channel: null, runtimeVersion };
  byKey.set(getReleaseTargetKey(baseTarget.channel, baseTarget.runtimeVersion), baseTarget);

  for (const target of targets) {
    if (target.runtimeVersion !== runtimeVersion) {
      continue;
    }
    byKey.set(getReleaseTargetKey(target.channel, target.runtimeVersion), target);
  }

  return Array.from(byKey.values()).sort(compareReleaseTargets);
}

function getDefaultReleaseTargetKey(bundle: BundleSummaryItem, targets: ReleaseTarget[]): string {
  const firstAvailableTarget = targets.find(
    (target) => !isCurrentOnTarget(bundle, target.channel, target.runtimeVersion),
  );
  return firstAvailableTarget === undefined
    ? NEW_RELEASE_STREAM_KEY
    : getReleaseTargetKey(firstAvailableTarget.channel, firstAvailableTarget.runtimeVersion);
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
  shellClassName?: string;
  brandHref?: string;
  dashboardHref?: string;
  settingsHref?: string;
  docsHref?: string;
};

/* ─── Main Component ───────────────────────────────────────────────── */

export function ProductDashboard({
  initialData,
  shellClassName,
  brandHref,
  dashboardHref,
  settingsHref,
  docsHref,
}: ProductDashboardProps) {
  const router = useRouter();
  // Docs live on the marketing site, not the console — resolve an absolute base
  // so these links don't 404 against console.otakit.app.
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://otakit.app').replace(/\/+$/, '');
  const docsUrl = docsHref ?? `${siteUrl}/docs`;
  const selectionStorageKey = 'selectedAppId';
  const [apps, setApps] = useState<AppSummary[]>(initialData.apps);
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);
  const [pricingDialogBillingData, setPricingDialogBillingData] =
    useState<PricingDialogBillingData | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('pricing') === '1' || params.get('checkout') === 'success') {
      setPricingDialogOpen(true);
    }
  }, [initialData.activeOrganization.id]);

  // App — ?app= wins so a link to one app is shareable, then the last local
  // selection, then the first app.
  const [selectedAppId, setSelectedAppId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return initialData.apps[0]?.id ?? null;
    const requested = new URLSearchParams(window.location.search).get('app');
    if (requested && initialData.apps.some((a) => a.id === requested)) return requested;
    const saved = localStorage.getItem(selectionStorageKey);
    if (saved && initialData.apps.some((a) => a.id === saved)) return saved;
    return initialData.apps[0]?.id ?? null;
  });
  useEffect(() => {
    if (selectedAppId) localStorage.setItem(selectionStorageKey, selectedAppId);
    else localStorage.removeItem(selectionStorageKey);

    // Keep the address bar in step without adding history entries.
    const url = new URL(window.location.href);
    if (selectedAppId) url.searchParams.set('app', selectedAppId);
    else url.searchParams.delete('app');
    if (url.toString() !== window.location.href) {
      window.history.replaceState(null, '', url);
    }
  }, [selectedAppId, selectionStorageKey]);

  useEffect(() => {
    setApps(initialData.apps);
  }, [initialData.apps]);

  // Bundles (one row per version)
  const [bundles, setBundles] = useState<BundleSummaryItem[]>([]);
  const [loadingBundles, setLoadingBundles] = useState(false);
  const [bundlesLoadedOnce, setBundlesLoadedOnce] = useState(false);
  const [releaseHistory, setReleaseHistory] = useState<ReleaseHistoryItem[]>([]);
  const [releasesLoadedOnce, setReleasesLoadedOnce] = useState(false);
  const dashboardReady = !selectedAppId || (bundlesLoadedOnce && releasesLoadedOnce);

  // Events (loaded with filters)
  const [appEvents, setAppEvents] = useState<DeviceEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventPlatform, setEventPlatform] = useState<EventPlatformFilter>('all');
  const [eventBundle, setEventBundle] = useState<string>('all');
  const [eventAction, setEventAction] = useState<EventActionFilter>('all');
  const [eventChannel, setEventChannel] = useState<string>('all');
  const [eventRuntime, setEventRuntime] = useState<string>('all');
  const [eventTimeframe, setEventTimeframe] = useState<EventTimeframeFilter>('24h');
  const [visibleBundleCount, setVisibleBundleCount] = useState(5);
  const [visibleEventCount, setVisibleEventCount] = useState(20);
  const [bundleColumnsDialogOpen, setBundleColumnsDialogOpen] = useState(false);
  const [bundleColumns, setBundleColumns] = useState<BundleTableColumn[]>(() =>
    readStoredColumns(BUNDLE_COLUMNS_STORAGE_KEY, BUNDLE_COLUMN_KEYS, DEFAULT_BUNDLE_COLUMNS),
  );
  const [bundleColumnsDraft, setBundleColumnsDraft] = useState<BundleTableColumn[]>(bundleColumns);
  const [appIdCopied, setAppIdCopied] = useState(false);
  const [copiedVersion, setCopiedVersion] = useState<string | null>(null);

  // Release
  const [releasingAction, setReleasingAction] = useState<{
    version: string;
    targetKey: string;
  } | null>(null);
  const [releaseConfirm, setReleaseConfirm] = useState<{
    bundle: BundleSummaryItem;
    selectedTargetKey: string;
    newChannelName: string;
    forceImmediate: boolean;
    autoRevert: boolean;
    autoRevertRatePercent: string;
    autoRevertMinSample: string;
  } | null>(null);

  // Revert
  const [revertConfirm, setRevertConfirm] = useState<{
    releaseId: string;
    channel: string | null;
    runtimeVersion: string | null;
    currentVersion: string;
    previousVersion: string | null;
    forceImmediate: boolean;
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
  const showEmptyEvents = Boolean(
    selectedApp && bundles.length > 0 && appEvents.length === 0 && !loadingEvents,
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

  const releaseTargets = useMemo(() => {
    const targets = new Map<string, ReleaseTarget>();

    for (const bundle of bundles) {
      for (const target of bundle.currentTargets) {
        targets.set(getReleaseTargetKey(target.channel, target.runtimeVersion), target);
      }
      for (const entry of bundle.deployedTargets) {
        targets.set(getReleaseTargetKey(entry.channel, entry.runtimeVersion), entry);
      }
    }

    for (const release of releaseHistory) {
      const target = { channel: release.channel, runtimeVersion: release.runtimeVersion };
      targets.set(getReleaseTargetKey(target.channel, target.runtimeVersion), target);
    }

    return Array.from(targets.values()).sort(compareReleaseTargets);
  }, [bundles, releaseHistory]);
  const releaseTargetOptions = useMemo(() => {
    if (!releaseConfirm) {
      return releaseTargets;
    }

    return getReleaseTargetsForRuntime(releaseTargets, releaseConfirm.bundle.runtimeVersion);
  }, [releaseConfirm, releaseTargets]);
  const releaseSelectedTarget = useMemo<ReleaseTarget | null>(() => {
    if (!releaseConfirm) {
      return null;
    }

    if (releaseConfirm.selectedTargetKey === NEW_RELEASE_STREAM_KEY) {
      const normalized = releaseConfirm.newChannelName.trim();
      return {
        channel: normalized.length > 0 ? normalized : null,
        runtimeVersion: releaseConfirm.bundle.runtimeVersion,
      };
    }

    return (
      releaseTargetOptions.find(
        (target) =>
          getReleaseTargetKey(target.channel, target.runtimeVersion) ===
          releaseConfirm.selectedTargetKey,
      ) ?? null
    );
  }, [releaseConfirm, releaseTargetOptions]);
  const releaseCurrentVersion = useMemo(() => {
    if (!releaseConfirm || !releaseSelectedTarget) {
      return null;
    }

    return findCurrentVersionOnTarget(
      bundles,
      releaseSelectedTarget.channel,
      releaseSelectedTarget.runtimeVersion,
    );
  }, [bundles, releaseConfirm, releaseSelectedTarget]);
  const releaseConfirmBusy =
    releaseConfirm !== null &&
    releaseSelectedTarget !== null &&
    releasingAction?.version === releaseConfirm.bundle.version &&
    releasingAction.targetKey ===
      getReleaseTargetKey(releaseSelectedTarget.channel, releaseSelectedTarget.runtimeVersion);
  const isCreatingNewReleaseChannel = releaseConfirm?.selectedTargetKey === NEW_RELEASE_STREAM_KEY;
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
      releaseTargetOptions.some(
        (target) =>
          target.channel !== null && target.channel.toLowerCase() === normalized.toLowerCase(),
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
  }, [releaseTargetOptions, releaseConfirm]);
  const releaseAlreadyCurrent =
    releaseConfirm !== null &&
    releaseSelectedTarget !== null &&
    !isCreatingNewReleaseChannel &&
    releaseChannelError === null &&
    isCurrentOnTarget(
      releaseConfirm.bundle,
      releaseSelectedTarget.channel,
      releaseSelectedTarget.runtimeVersion,
    );
  const releaseAutoRevertRateValue =
    releaseConfirm?.autoRevert === true
      ? parseIntegerInRange(releaseConfirm.autoRevertRatePercent, 1, 95)
      : null;
  const releaseAutoRevertMinSampleValue =
    releaseConfirm?.autoRevert === true
      ? parseIntegerInRange(releaseConfirm.autoRevertMinSample, 10, 100000)
      : null;
  const releaseAutoRevertInvalid =
    releaseConfirm?.autoRevert === true &&
    (releaseAutoRevertRateValue === null || releaseAutoRevertMinSampleValue === null);

  const eventBundleOptions = useMemo(() => bundles.map((bundle) => bundle.version), [bundles]);

  // Latest release event per (bundle version + target), so the merged table can
  // show who shipped each release and offer a revert.
  const releaseByKey = useMemo(() => {
    const map = new Map<string, ReleaseHistoryItem>();
    for (const release of releaseHistory) {
      const key = `${release.bundleVersion}::${getReleaseTargetKey(release.channel, release.runtimeVersion)}`;
      const existing = map.get(key);
      if (!existing || new Date(release.promotedAt) > new Date(existing.promotedAt)) {
        map.set(key, release);
      }
    }
    return map;
  }, [releaseHistory]);

  const eventChannelOptions = useMemo(() => {
    const channels = new Set<string>();
    for (const target of releaseTargets) {
      if (target.channel) channels.add(target.channel);
    }
    const custom = Array.from(channels).sort((a, b) => a.localeCompare(b));
    // Surface the default (no-channel) stream as "base" alongside named channels.
    return custom.length > 0 ? ['base', ...custom] : [];
  }, [releaseTargets]);

  const eventRuntimeOptions = useMemo(() => {
    const runtimes = new Set<string>();
    for (const target of releaseTargets) {
      if (target.runtimeVersion) runtimes.add(target.runtimeVersion);
    }
    for (const bundle of bundles) {
      if (bundle.runtimeVersion) runtimes.add(bundle.runtimeVersion);
    }
    return Array.from(runtimes).sort((a, b) => a.localeCompare(b));
  }, [releaseTargets, bundles]);

  const bundleColumnOptions = useMemo(
    () =>
      BUNDLE_COLUMN_OPTIONS.map((option) =>
        option.key === 'targets' ? { ...option, label: 'Release' } : option,
      ),
    [],
  );
  const bundleColumnSet = useMemo(() => new Set(bundleColumns), [bundleColumns]);
  const hasBundleColumn = useCallback(
    (column: BundleTableColumn) => bundleColumnSet.has(column),
    [bundleColumnSet],
  );
  const bundleTableMinWidth = Math.max(
    160,
    bundleColumns.reduce((total, column) => total + BUNDLE_COLUMN_WIDTHS[column], 0),
  );

  // ── Data loading ──────────────────────────────────────────────────

  const loadBundles = useCallback(async (appId: string) => {
    setLoadingBundles(true);
    try {
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
  }, []);

  const loadEvents = useCallback(
    async (appId: string) => {
      setLoadingEvents(true);
      try {
        const params = new URLSearchParams({
          platform: eventPlatform,
          bundle: eventBundle,
          action: eventAction,
          channel: eventChannel,
          runtime: eventRuntime,
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
    [eventAction, eventBundle, eventChannel, eventRuntime, eventPlatform, eventTimeframe],
  );

  const loadReleaseHistory = useCallback(async (appId: string) => {
    try {
      const res = await fetch(`/api/v1/apps/${encodeURIComponent(appId)}/releases?limit=100`);
      const data = await parseJson<{ releases?: ReleaseHistoryItem[] } & ApiError>(res);
      if (!res.ok) throw new Error(data.error ?? 'Failed to load release history');
      setReleaseHistory(data.releases ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load release history');
      setReleaseHistory([]);
    } finally {
      setReleasesLoadedOnce(true);
    }
  }, []);

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
    if (eventChannel === 'all') {
      return;
    }
    if (!eventChannelOptions.includes(eventChannel)) {
      setEventChannel('all');
    }
  }, [eventChannel, eventChannelOptions]);

  useEffect(() => {
    if (eventRuntime === 'all') {
      return;
    }
    if (!eventRuntimeOptions.includes(eventRuntime)) {
      setEventRuntime('all');
    }
  }, [eventRuntime, eventRuntimeOptions]);

  useEffect(() => {
    setEventBundle('all');
    setEventChannel('all');
    setEventRuntime('all');
  }, [selectedAppId]);

  useEffect(() => {
    setVisibleBundleCount(5);
    setVisibleEventCount(20);
  }, [selectedAppId]);

  useEffect(() => {
    setAppIdCopied(false);
  }, [selectedAppId]);

  useEffect(() => {
    setVisibleEventCount(20);
  }, [eventPlatform, eventBundle, eventAction, eventChannel, eventRuntime, eventTimeframe]);

  useEffect(() => {
    window.localStorage.setItem(BUNDLE_COLUMNS_STORAGE_KEY, JSON.stringify(bundleColumns));
  }, [bundleColumns]);

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

  function requestRelease(bundle: BundleSummaryItem) {
    if (releasingAction !== null) return;
    setReleaseConfirm({
      bundle,
      selectedTargetKey: getDefaultReleaseTargetKey(
        bundle,
        getReleaseTargetsForRuntime(releaseTargets, bundle.runtimeVersion),
      ),
      newChannelName: '',
      forceImmediate: false,
      autoRevert: false,
      autoRevertRatePercent: '20',
      autoRevertMinSample: '50',
    });
  }

  async function releaseBundle(
    bundle: BundleSummaryItem,
    target: ReleaseTarget | null,
    forceImmediate = false,
    autoRevert: { ratePercent: number; minSample: number } | null = null,
  ): Promise<boolean> {
    if (!selectedAppId || !target) return false;
    if (isCurrentOnTarget(bundle, target.channel, target.runtimeVersion)) {
      toast.success(
        `${bundle.version} is already current on ${formatReleaseTarget(target.channel, target.runtimeVersion)}`,
      );
      return false;
    }

    setReleasingAction({
      version: bundle.version,
      targetKey: getReleaseTargetKey(target.channel, target.runtimeVersion),
    });
    try {
      const expectedCurrentReleaseId =
        releaseHistory.find(
          (release) =>
            release.revertedAt === null &&
            release.channel === target.channel &&
            release.runtimeVersion === target.runtimeVersion,
        )?.id ?? null;
      const res = await fetch(`/api/v1/apps/${encodeURIComponent(selectedAppId)}/releases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          bundleId: bundle.id,
          channel: target.channel,
          expectedCurrentReleaseId,
          forceImmediate,
          autoRevert: autoRevert !== null,
          ...(autoRevert
            ? {
                autoRevertRatePercent: autoRevert.ratePercent,
                autoRevertMinSample: autoRevert.minSample,
              }
            : {}),
        }),
      });
      const data = await parseJson<
        ApiError & {
          publicationStatus?: 'published' | 'manifest_sync_pending';
        }
      >(res);
      if (!res.ok) throw new Error(data.error ?? 'Release failed');
      if (data.publicationStatus === 'manifest_sync_pending') {
        toast.warning(
          'Release saved, but it is not live on devices yet. OtaKit will keep retrying.',
        );
      } else {
        toast.success(
          `Released ${bundle.version} to ${formatReleaseTarget(target.channel, target.runtimeVersion)}`,
        );
      }
      trackConversion('release_created');
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
    if (releaseChannelError || releaseChannelMissing || releaseAutoRevertInvalid) {
      return;
    }
    await releaseBundle(
      releaseConfirm.bundle,
      releaseSelectedTarget,
      releaseConfirm.forceImmediate,
      releaseConfirm.autoRevert &&
        releaseAutoRevertRateValue !== null &&
        releaseAutoRevertMinSampleValue !== null
        ? {
            ratePercent: releaseAutoRevertRateValue,
            minSample: releaseAutoRevertMinSampleValue,
          }
        : null,
    );
  }

  function openRevertConfirm(row: ReleaseHistoryItem) {
    setRevertConfirm({
      releaseId: row.id,
      channel: row.channel,
      runtimeVersion: row.runtimeVersion,
      currentVersion: row.bundleVersion,
      previousVersion: row.previousBundleVersion ?? null,
      forceImmediate: false,
    });
  }

  async function performRevert() {
    if (!selectedAppId || !revertConfirm || revertBusy) return;
    setRevertBusy(true);
    try {
      const res = await fetch(
        `/api/v1/apps/${encodeURIComponent(selectedAppId)}/releases/${encodeURIComponent(revertConfirm.releaseId)}/revert`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedCurrentReleaseId: revertConfirm.releaseId,
            ...(revertConfirm.forceImmediate ? { forceImmediate: true } : {}),
          }),
        },
      );
      const data = await parseJson<
        ApiError & {
          publicationStatus?: 'published' | 'manifest_sync_pending';
        }
      >(res);
      if (!res.ok) throw new Error(data.error ?? 'Revert failed');
      if (data.publicationStatus === 'manifest_sync_pending') {
        toast.warning(
          'Revert saved, but it is not live on devices yet. OtaKit will keep retrying.',
        );
      } else {
        toast.success(
          `Reverted ${formatReleaseTarget(revertConfirm.channel, revertConfirm.runtimeVersion)}`,
        );
      }
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
      trackConversion('app_created');
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
        docsHref={docsUrl}
      />

      <main className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">
        <div className="pointer-events-none absolute inset-0 z-10 hidden justify-center sm:flex">
          <div className="h-full w-full max-w-screen-xl border-x border-border" />
        </div>
        <div className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">
          {/* Messages handled by sonner toast */}

          {/* App selector bar */}
          <section className="border-b border-border">
            <div className="mx-auto max-w-screen-xl">
              <div className="flex flex-wrap items-center gap-3 px-6 pb-5 pt-8">
                <h2 className="flex items-center gap-3 text-[15px] font-semibold">
                  <Cpu className="size-6 shrink-0 text-muted-foreground" />
                  App
                </h2>
                <div className="mx-1 h-4 w-px bg-border" />
                {apps.length > 0 ? (
                  <>
                    <Select
                      value={selectedAppId ?? ''}
                      onValueChange={(value) => {
                        if (value === '__new_app__') {
                          setCreateDialogOpen(true);
                          return;
                        }
                        setSelectedAppId(value);
                      }}
                    >
                      <SelectTrigger
                        className="h-8 w-40 border-0 bg-transparent px-2 shadow-none hover:bg-accent sm:w-56"
                        icon={<ChevronsUpDown className="size-4 opacity-50" />}
                      >
                        <SelectValue placeholder="Select app" />
                      </SelectTrigger>
                      <SelectContent>
                        {apps.map((app) => (
                          <SelectItem key={app.id} value={app.id}>
                            {app.slug}
                          </SelectItem>
                        ))}
                        <SelectSeparator />
                        <SelectItem value="__new_app__" className="text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Plus className="size-3.5" />
                            New app
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    {selectedApp ? (
                      <div className="hidden items-center gap-3 sm:flex">
                        <Separator orientation="vertical" className="h-4" />
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Hash className="size-3" />
                          App ID:
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
                          title={String(selectedAppId) ?? 'App id'}
                        >
                          {truncate(selectedApp.id, 16)}
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
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => setCreateDialogOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    New app
                  </Button>
                )}
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
                      <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
                        <p className="text-sm font-medium">Ship your first update</p>
                        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                          Five steps, checked off as they actually happen.
                        </p>
                        <div className="mt-5">
                          <SetupInline />
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-4 text-muted-foreground"
                          onClick={() => setCreateDialogOpen(true)}
                        >
                          <Plus className="size-3.5" />
                          Or create an app here
                        </Button>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {/* Bundles */}
              {selectedApp ? (
                <section className="">
                  <div className="mx-auto max-w-screen-xl bg-muted/30">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-6 pb-5 pt-8">
                      <div className="flex items-center gap-3">
                        <Package className="size-6 shrink-0 text-muted-foreground" />
                        <div className="flex flex-col gap-0.5">
                          <h2 className="text-[15px] font-semibold leading-tight">Updates</h2>
                          <p className="text-xs leading-tight text-muted-foreground">
                            Bundles &amp; releases
                          </p>
                        </div>
                      </div>
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
                    </div>

                    {bundles.length === 0 && !loadingBundles ? (
                      <div className="p-5">
                        <div className="border-dashed border-border py-12 text-center rounded-lg border">
                          <Download className="mx-auto size-6 text-muted-foreground/40" />
                          <p className="mt-3 text-sm font-medium">No bundles yet</p>
                          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                            Ask your coding agent to build and upload your web assets, or run{' '}
                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                              otakit upload
                            </code>
                            .
                          </p>
                        </div>
                      </div>
                    ) : bundles.length > 0 ? (
                      <>
                        <div className="relative">
                          <div className="overflow-auto">
                            <Table
                              className="w-full table-fixed text-xs [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_td]:border-r [&_td]:border-border [&_td]:py-2 [&_td:last-child]:border-r-0 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6 [&_th]:border-r [&_th]:border-border [&_th:last-child]:border-r-0"
                              style={{ minWidth: `${bundleTableMinWidth}px` }}
                            >
                              <colgroup>
                                {bundleColumns.map((col) => (
                                  <col
                                    key={col}
                                    style={
                                      col === 'targets'
                                        ? undefined
                                        : { width: `${BUNDLE_COLUMN_WIDTHS[col]}px` }
                                    }
                                  />
                                ))}
                              </colgroup>
                              <TableHeader>
                                <TableRow>
                                  {hasBundleColumn('version') ? (
                                    <TableHead className="">Bundle</TableHead>
                                  ) : null}
                                  {hasBundleColumn('runtime') ? (
                                    <TableHead className="">Runtime</TableHead>
                                  ) : null}
                                  {hasBundleColumn('size') ? (
                                    <TableHead className="">Size</TableHead>
                                  ) : null}
                                  {hasBundleColumn('uploaded') ? (
                                    <TableHead className="">Uploaded</TableHead>
                                  ) : null}
                                  {hasBundleColumn('targets') ? (
                                    <TableHead className="">Release</TableHead>
                                  ) : null}
                                  {hasBundleColumn('downloads') ? (
                                    <TableHead
                                      className="text-center align-middle"
                                      title={STAT_COLUMN_HINTS.downloads}
                                    >
                                      <Download className="mx-auto size-3.5 text-blue-600/55 dark:text-blue-400/60" />
                                      <span className="sr-only">Downloads</span>
                                    </TableHead>
                                  ) : null}
                                  {hasBundleColumn('applied') ? (
                                    <TableHead
                                      className="text-center align-middle"
                                      title={STAT_COLUMN_HINTS.applied}
                                    >
                                      <BadgeCheck className="mx-auto size-3.5 text-emerald-600/55 dark:text-emerald-400/60" />
                                      <span className="sr-only">Applied</span>
                                    </TableHead>
                                  ) : null}
                                  {hasBundleColumn('errors') ? (
                                    <TableHead
                                      className="text-center align-middle"
                                      title={STAT_COLUMN_HINTS.errors}
                                    >
                                      <CircleAlert className="mx-auto size-3.5 text-amber-600/55 dark:text-amber-400/60" />
                                      <span className="sr-only">Errors</span>
                                    </TableHead>
                                  ) : null}
                                  {hasBundleColumn('rollbacks') ? (
                                    <TableHead
                                      className="text-center align-middle"
                                      title={STAT_COLUMN_HINTS.rollbacks}
                                    >
                                      <RotateCcw className="mx-auto size-3.5 text-red-600/55 dark:text-red-400/60" />
                                      <span className="sr-only">Rollbacks</span>
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
                                  const currentSet = new Set(
                                    b.currentTargets.map((target) =>
                                      getReleaseTargetKey(target.channel, target.runtimeVersion),
                                    ),
                                  );

                                  return (
                                    <TableRow key={b.version}>
                                      {hasBundleColumn('version') ? (
                                        <TableCell className="font-mono text-xs">
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              className="group inline-flex min-w-0 items-center gap-1 transition-colors hover:text-foreground/80"
                                              title={`Copy ${b.version}`}
                                              onClick={() => {
                                                void navigator.clipboard.writeText(b.version);
                                                setCopiedVersion(b.version);
                                                toast.success('Bundle copied');
                                                setTimeout(
                                                  () =>
                                                    setCopiedVersion((c) =>
                                                      c === b.version ? null : c,
                                                    ),
                                                  2000,
                                                );
                                              }}
                                            >
                                              <span className="truncate">{b.version}</span>
                                              {copiedVersion === b.version ? (
                                                <Check className="size-3 shrink-0 text-emerald-500" />
                                              ) : (
                                                <Copy className="size-3 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
                                              )}
                                            </button>
                                            <button
                                              type="button"
                                              className="shrink-0 text-muted-foreground/40 transition-colors hover:text-foreground"
                                              title="Filter activity by this bundle"
                                              onClick={() => setEventBundle(b.version)}
                                            >
                                              <Filter className="size-3" />
                                            </button>
                                          </div>
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('runtime') ? (
                                        <TableCell className="truncate font-mono text-xs text-muted-foreground">
                                          {b.runtimeVersion ?? 'any'}
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('size') ? (
                                        <TableCell className=" text-xs text-muted-foreground">
                                          {formatBytes(b.size)}
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('uploaded') ? (
                                        <TableCell className=" text-xs text-muted-foreground">
                                          <div className="leading-tight">
                                            {formatDateOnly(b.createdAt)}
                                          </div>
                                          <div className="leading-tight">
                                            {formatTimeOnly(b.createdAt)}
                                          </div>
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('targets') ? (
                                        <TableCell className="align-middle">
                                          {b.deployedTargets.length === 0 ? (
                                            <span className="text-muted-foreground">
                                              Not released
                                            </span>
                                          ) : (
                                            <div className="flex flex-wrap items-center gap-1">
                                              {b.deployedTargets
                                                .filter((entry) =>
                                                  currentSet.has(
                                                    getReleaseTargetKey(
                                                      entry.channel,
                                                      entry.runtimeVersion,
                                                    ),
                                                  ),
                                                )
                                                .map((entry) => {
                                                  const tKey = getReleaseTargetKey(
                                                    entry.channel,
                                                    entry.runtimeVersion,
                                                  );
                                                  const rel = releaseByKey.get(
                                                    `${b.version}::${tKey}`,
                                                  );
                                                  const canRevert =
                                                    rel != null && rel.revertedAt === null;
                                                  const detail = `Channel: ${entry.channel ?? 'base'}${rel ? ` · live since ${formatDate(rel.promotedAt)} · by ${formatReleasedBy(rel.promotedBy)}` : ''}${rel?.autoRevert ? ` · auto-revert at ≥${rel.autoRevertRatePercent}% of ≥${rel.autoRevertMinSample} devices` : ''}`;
                                                  return (
                                                    <DropdownMenu key={tKey}>
                                                      <DropdownMenuTrigger asChild>
                                                        <button
                                                          type="button"
                                                          title={detail}
                                                          className="inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-500/30 transition-colors hover:bg-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/25"
                                                        >
                                                          {rel?.autoRevert ? (
                                                            <span className="relative flex size-1.5 shrink-0">
                                                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                                                              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                                                            </span>
                                                          ) : (
                                                            <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                                                          )}
                                                          <span className="truncate">
                                                            {entry.channel ?? 'base'}
                                                          </span>
                                                          <ChevronDown className="size-2.5 shrink-0 opacity-50" />
                                                        </button>
                                                      </DropdownMenuTrigger>
                                                      <DropdownMenuContent
                                                        align="start"
                                                        className="w-60"
                                                      >
                                                        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 px-2 py-1.5 text-[11px]">
                                                          <span className="text-muted-foreground">
                                                            Channel
                                                          </span>
                                                          <span className="font-medium">
                                                            {entry.channel ?? 'base'}
                                                          </span>
                                                          {rel ? (
                                                            <>
                                                              <span className="text-muted-foreground">
                                                                Live since
                                                              </span>
                                                              <span>
                                                                {formatDate(rel.promotedAt)}
                                                              </span>
                                                              <span className="text-muted-foreground">
                                                                Released by
                                                              </span>
                                                              <span className="truncate">
                                                                {formatReleasedBy(rel.promotedBy)}
                                                              </span>
                                                            </>
                                                          ) : null}
                                                          {rel?.previousBundleVersion ? (
                                                            <>
                                                              <span className="text-muted-foreground">
                                                                Previous
                                                              </span>
                                                              <span className="truncate font-mono">
                                                                {rel.previousBundleVersion}
                                                              </span>
                                                            </>
                                                          ) : null}
                                                          {rel?.forceImmediate ? (
                                                            <>
                                                              <span className="text-muted-foreground">
                                                                Rollout
                                                              </span>
                                                              <span className="font-medium text-amber-600 dark:text-amber-400">
                                                                Force immediate
                                                              </span>
                                                            </>
                                                          ) : null}
                                                          {rel?.autoRevert ? (
                                                            <>
                                                              <span className="text-muted-foreground">
                                                                Guard
                                                              </span>
                                                              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                                                Auto-revert at ≥
                                                                {rel.autoRevertRatePercent}% of ≥
                                                                {rel.autoRevertMinSample} devices /
                                                                24h
                                                              </span>
                                                            </>
                                                          ) : null}
                                                        </div>
                                                        {canRevert ? (
                                                          <>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem
                                                              disabled={revertConfirm !== null}
                                                              onClick={() => openRevertConfirm(rel)}
                                                            >
                                                              <RotateCcw className="size-3.5" />
                                                              Revert to previous
                                                            </DropdownMenuItem>
                                                          </>
                                                        ) : null}
                                                      </DropdownMenuContent>
                                                    </DropdownMenu>
                                                  );
                                                })}
                                              {b.deployedTargets
                                                .filter(
                                                  (entry) =>
                                                    !currentSet.has(
                                                      getReleaseTargetKey(
                                                        entry.channel,
                                                        entry.runtimeVersion,
                                                      ),
                                                    ),
                                                )
                                                .map((entry) => {
                                                  const tKey = getReleaseTargetKey(
                                                    entry.channel,
                                                    entry.runtimeVersion,
                                                  );
                                                  const rel = releaseByKey.get(
                                                    `${b.version}::${tKey}`,
                                                  );
                                                  const autoRevertedAt =
                                                    rel?.revertedAt != null &&
                                                    rel.revertedBy === 'system:auto-revert'
                                                      ? rel.revertedAt
                                                      : null;
                                                  const wasAutoReverted = autoRevertedAt !== null;
                                                  return (
                                                    <span
                                                      key={tKey}
                                                      title={`Previously live · Channel: ${entry.channel ?? 'base'} · released ${formatDate(entry.deployedAt)}${rel ? ` · by ${formatReleasedBy(rel.promotedBy)}` : ''}${autoRevertedAt ? ` · auto-reverted ${formatDate(autoRevertedAt)}` : ''}`}
                                                      className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                                                    >
                                                      {wasAutoReverted ? (
                                                        <ShieldAlert className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
                                                      ) : null}
                                                      <span className="truncate">
                                                        {entry.channel ?? 'base'}
                                                      </span>
                                                    </span>
                                                  );
                                                })}
                                            </div>
                                          )}
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('downloads') ? (
                                        <TableCell
                                          className="text-center align-middle text-xs tabular-nums text-muted-foreground"
                                          title={STAT_COLUMN_HINTS.downloads}
                                        >
                                          {b.eventCounts.downloads}
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('applied') ? (
                                        <TableCell
                                          className="text-center align-middle text-xs tabular-nums text-muted-foreground"
                                          title={STAT_COLUMN_HINTS.applied}
                                        >
                                          {b.eventCounts.applied}
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('errors') ? (
                                        <TableCell
                                          className={`text-center align-middle text-xs tabular-nums ${b.eventCounts.downloadErrors > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
                                          title={STAT_COLUMN_HINTS.errors}
                                        >
                                          {b.eventCounts.downloadErrors}
                                        </TableCell>
                                      ) : null}
                                      {hasBundleColumn('rollbacks') ? (
                                        <TableCell
                                          className={`text-center align-middle text-xs tabular-nums ${b.eventCounts.rollbacks > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                                          title={STAT_COLUMN_HINTS.rollbacks}
                                        >
                                          {b.eventCounts.rollbacks}
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

              {selectedApp ? <Separator className="" /> : null}

              {/* Events */}
              {selectedApp ? (
                <section className={cn(showEmptyEvents && 'flex flex-1')}>
                  <div
                    className={cn(
                      'mx-auto max-w-screen-xl bg-muted/30',
                      showEmptyEvents && 'flex w-full flex-1 flex-col',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-6 pb-5 pt-8">
                      <div className="mr-5 flex items-center gap-3">
                        <Activity className="size-6 shrink-0 text-muted-foreground" />
                        <div className="flex flex-col gap-0.5">
                          <h2 className="text-[15px] font-semibold leading-tight">Events</h2>
                          <p className="text-xs leading-tight text-muted-foreground">
                            Device activity
                          </p>
                        </div>
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

                        {eventChannelOptions.length > 0 ? (
                          <Select value={eventChannel} onValueChange={setEventChannel}>
                            <SelectTrigger className="h-8 w-full text-xs sm:w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">
                                <span className="flex items-center gap-1.5">
                                  <Hash className="size-3.5 text-muted-foreground" />
                                  All channels
                                </span>
                              </SelectItem>
                              {eventChannelOptions.map((channel) => (
                                <SelectItem key={channel} value={channel}>
                                  {channel}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : null}

                        {eventRuntimeOptions.length > 0 ? (
                          <Select value={eventRuntime} onValueChange={setEventRuntime}>
                            <SelectTrigger className="h-8 w-full text-xs sm:w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">
                                <span className="flex items-center gap-1.5">
                                  <Cpu className="size-3.5 text-muted-foreground" />
                                  All runtimes
                                </span>
                              </SelectItem>
                              {eventRuntimeOptions.map((runtime) => (
                                <SelectItem key={runtime} value={runtime}>
                                  <span className="font-mono">{runtime}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : null}

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
                      <div className={cn('p-5', showEmptyEvents && 'flex flex-1')}>
                        <div
                          className={cn(
                            'rounded-lg border border-dashed py-12 text-center',
                            showEmptyEvents &&
                              'flex min-h-64 w-full flex-col items-center justify-center',
                          )}
                        >
                          <Clock className="mx-auto size-6 text-muted-foreground/40" />
                          <p className="mt-3 text-sm font-medium">No activity yet</p>
                          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                            Events appear here once devices with the{' '}
                            <Link
                              href={`${docsUrl}/plugin`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-4 hover:text-foreground"
                            >
                              plugin
                            </Link>{' '}
                            start checking for updates.
                          </p>
                          <p className="mt-4">
                            <Link
                              href={`${docsUrl}/setup`}
                              target="_blank"
                              rel="noopener noreferrer"
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
                          <Table className="min-w-[680px] [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6 [&_thead_th]:border-r [&_thead_th]:border-border [&_thead_th:last-child]:border-r-0">
                            <TableHeader>
                              <TableRow>
                                <TableHead>Time</TableHead>
                                <TableHead>Platform</TableHead>
                                <TableHead>Action</TableHead>
                                <TableHead>Bundle</TableHead>
                                <TableHead>Channel</TableHead>
                                <TableHead>Runtime</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {appEvents.slice(0, visibleEventCount).map((ev) => (
                                <TableRow key={ev.id}>
                                  <TableCell className="truncate text-xs text-muted-foreground">
                                    {formatDate(ev.createdAt)}
                                  </TableCell>
                                  <TableCell className="truncate text-xs text-muted-foreground">
                                    {formatEventPlatform(ev.platform)}
                                  </TableCell>
                                  <TableCell className="truncate text-xs text-muted-foreground">
                                    {formatEventAction(ev.action)}
                                  </TableCell>
                                  <TableCell className="font-mono text-xs">
                                    {ev.bundleVersion ? (
                                      <span className="block truncate" title={ev.bundleVersion}>
                                        {ev.bundleVersion}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">Unknown</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="truncate text-xs text-muted-foreground">
                                    {ev.channel ?? 'base'}
                                  </TableCell>
                                  <TableCell className="truncate font-mono text-xs text-muted-foreground">
                                    {ev.runtimeVersion ?? 'any'}
                                  </TableCell>
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

              {showEmptyEvents ? null : (
                <section className="flex-1">
                  <div className="mx-auto h-full max-w-screen-xl" />
                </section>
              )}
            </>
          )}
        </div>
      </main>

      <PricingDialog
        open={pricingDialogOpen}
        onOpenChange={setPricingDialogOpen}
        canManageBilling={
          initialData.activeOrganization.role === 'owner' ||
          initialData.activeOrganization.role === 'admin'
        }
        initialBillingData={pricingDialogBillingData}
        onBillingDataChange={setPricingDialogBillingData}
      />

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
            <DialogDescription>Choose the channel that should serve this bundle.</DialogDescription>
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
                    {releaseTargetOptions.map((target) => (
                      <SelectItem
                        key={getReleaseTargetKey(target.channel, target.runtimeVersion)}
                        value={getReleaseTargetKey(target.channel, target.runtimeVersion)}
                        disabled={isCurrentOnTarget(
                          releaseConfirm.bundle,
                          target.channel,
                          target.runtimeVersion,
                        )}
                      >
                        {target.channel ?? 'base'}
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
              <div className="flex items-start gap-2">
                <Checkbox
                  id="release-force-immediate"
                  checked={releaseConfirm.forceImmediate}
                  onCheckedChange={(checked) =>
                    setReleaseConfirm((current) =>
                      current ? { ...current, forceImmediate: checked === true } : current,
                    )
                  }
                  disabled={releaseConfirmBusy}
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="release-force-immediate" className="text-sm font-normal">
                    Force immediate update
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Devices apply and reload on their next check. For broken releases, not routine
                    rollouts.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="release-auto-revert"
                  checked={releaseConfirm.autoRevert}
                  onCheckedChange={(checked) =>
                    setReleaseConfirm((current) =>
                      current ? { ...current, autoRevert: checked === true } : current,
                    )
                  }
                  disabled={releaseConfirmBusy}
                />
                <div className="grid w-full gap-1 leading-none">
                  <Label htmlFor="release-auto-revert" className="text-sm font-normal">
                    Auto-revert if unhealthy
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically revert this release when too many devices roll back within a 24
                    hour window. Device-reported data.
                  </p>
                  {releaseConfirm.autoRevert ? (
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label
                          htmlFor="release-auto-revert-rate"
                          className="text-xs font-normal text-muted-foreground"
                        >
                          Rollback rate (%)
                        </Label>
                        <Input
                          id="release-auto-revert-rate"
                          inputMode="numeric"
                          value={releaseConfirm.autoRevertRatePercent}
                          onChange={(event) =>
                            setReleaseConfirm((current) =>
                              current
                                ? { ...current, autoRevertRatePercent: event.target.value }
                                : current,
                            )
                          }
                          disabled={releaseConfirmBusy}
                          aria-invalid={releaseAutoRevertRateValue === null}
                        />
                        {releaseAutoRevertRateValue === null ? (
                          <p className="text-xs text-destructive">Integer between 1 and 95.</p>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        <Label
                          htmlFor="release-auto-revert-min-sample"
                          className="text-xs font-normal text-muted-foreground"
                        >
                          Min. devices
                        </Label>
                        <Input
                          id="release-auto-revert-min-sample"
                          inputMode="numeric"
                          value={releaseConfirm.autoRevertMinSample}
                          onChange={(event) =>
                            setReleaseConfirm((current) =>
                              current
                                ? { ...current, autoRevertMinSample: event.target.value }
                                : current,
                            )
                          }
                          disabled={releaseConfirmBusy}
                          aria-invalid={releaseAutoRevertMinSampleValue === null}
                        />
                        {releaseAutoRevertMinSampleValue === null ? (
                          <p className="text-xs text-destructive">Integer between 10 and 100000.</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {releaseAlreadyCurrent ? (
                <p className="text-xs text-muted-foreground">
                  This bundle is already current on{' '}
                  {formatReleaseTarget(
                    releaseSelectedTarget?.channel ?? null,
                    releaseSelectedTarget?.runtimeVersion ?? null,
                  )}
                  .
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
                releaseAlreadyCurrent ||
                releaseAutoRevertInvalid
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
                <span className="font-medium">{revertConfirm.channel ?? 'base'}</span>
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
                  No previous release is available. Devices will fall back to the built-in app
                  bundle.
                </p>
              )}
              {revertConfirm.previousVersion ? (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="revert-force-immediate"
                    checked={revertConfirm.forceImmediate}
                    onCheckedChange={(checked) =>
                      setRevertConfirm((current) =>
                        current ? { ...current, forceImmediate: checked === true } : current,
                      )
                    }
                    disabled={revertBusy}
                  />
                  <div className="grid gap-1 leading-none">
                    <Label htmlFor="revert-force-immediate" className="text-sm font-normal">
                      Force immediate update
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Devices apply and reload the reverted-to release on their next check.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={revertBusy} onClick={() => setRevertConfirm(null)}>
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
