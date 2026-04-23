'use client';

import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import {
  type BundleInfo,
  type CheckResult,
  type OtaKitState,
  OtaKit,
} from '@otakit/capacitor-updater';
import { useCallback, useEffect, useRef, useState } from 'react';

type LogLevel = 'info' | 'success' | 'error';

type LogEntry = {
  id: number;
  level: LogLevel;
  message: string;
  time: string;
};

const LOG_CLASS: Record<LogLevel, string> = {
  info: 'text-slate-300',
  success: 'text-emerald-300',
  error: 'text-rose-300',
};

const PLUGIN_NAME = 'OtaKit';
const SPLASH_PLUGIN_NAME = 'SplashScreen';

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function shortId(value: string | undefined): string {
  if (!value) return '-';
  return `${value.slice(0, 8)}...`;
}

function bundleLabel(bundle: BundleInfo | null | undefined): string {
  if (!bundle) return '-';
  const version = nonEmptyString(bundle.version);
  const bundleId = nonEmptyString(bundle.id);

  if (version && bundleId) {
    return `${version} (${shortId(bundleId)})`;
  }
  if (version) {
    return version;
  }
  if (bundleId) {
    return shortId(bundleId);
  }
  return 'Unknown bundle';
}

function latestDetails(result: CheckResult | null | undefined) {
  if (!result || result.kind === 'no_update') {
    return null;
  }
  return result.latest ?? null;
}

function latestVersionLabel(result: CheckResult | null | undefined): string {
  return nonEmptyString(latestDetails(result)?.version) ?? '-';
}

function latestSizeLabel(result: CheckResult | null | undefined): string {
  const size = finiteNumber(latestDetails(result)?.size);
  return size === null ? '-' : `${size} bytes`;
}

function latestShaLabel(result: CheckResult | null | undefined): string {
  return shortId(nonEmptyString(latestDetails(result)?.sha256) ?? undefined);
}

function describeCheckResult(result: CheckResult): string {
  if (result.kind === 'no_update') {
    return 'No update available';
  }

  const version = nonEmptyString(result.latest?.version);
  if (result.kind === 'already_staged') {
    return version
      ? `${version} is already staged and ready to apply.`
      : 'The latest update is already staged and ready to apply.';
  }

  return version ? `${version} is available.` : 'An update is available.';
}

function describeDownloadResult(
  result: Awaited<ReturnType<typeof OtaKit.download>>,
): string {
  if (result.kind !== 'staged') {
    return 'No new update';
  }

  const version = nonEmptyString(result.bundle?.version);
  return version
    ? `Prepared ${version}. It is staged and ready to apply.`
    : 'Prepared the latest bundle. It is staged and ready to apply.';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForPluginAvailability(timeoutMs = 3000): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return Capacitor.isPluginAvailable(PLUGIN_NAME);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Capacitor.isPluginAvailable(PLUGIN_NAME)) {
      return true;
    }
    await sleep(100);
  }

  return Capacitor.isPluginAvailable(PLUGIN_NAME);
}

async function hideNativeSplashScreen(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }
  if (!Capacitor.isPluginAvailable(SPLASH_PLUGIN_NAME)) {
    return;
  }
  try {
    await SplashScreen.hide();
  } catch {
    // Ignore splash hide failures so startup can continue.
  }
}

type EnvironmentState = {
  isReady: boolean;
  platform: string;
  isNative: boolean;
  pluginAvailable: boolean;
};

const INITIAL_ENVIRONMENT: EnvironmentState = {
  isReady: false,
  platform: '-',
  isNative: false,
  pluginAvailable: false,
};

const BUILD_LABEL = process.env.NEXT_PUBLIC_BUILD_TIME ?? '-';

export default function Home() {
  const [environment, setEnvironment] = useState(INITIAL_ENVIRONMENT);

  const [status, setStatus] = useState('Booting...');
  const [startupScreenVisible, setStartupScreenVisible] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const logSeqRef = useRef(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [runtimeState, setRuntimeState] = useState<OtaKitState | null>(null);
  const [latest, setLatest] = useState<CheckResult | null>(null);
  const [lastFailure, setLastFailure] = useState<BundleInfo | null>(null);

  useEffect(() => {
    setEnvironment({
      isReady: true,
      platform: Capacitor.getPlatform(),
      isNative: Capacitor.isNativePlatform(),
      pluginAvailable: Capacitor.isPluginAvailable(PLUGIN_NAME),
    });
  }, []);

  const addLog = useCallback((level: LogLevel, message: string) => {
    logSeqRef.current += 1;
    const entry: LogEntry = {
      id: logSeqRef.current,
      level,
      message,
      time: new Date().toLocaleTimeString(),
    };
    setLogs((prev) => [entry, ...prev].slice(0, 50));
  }, []);

  const withAction = useCallback(
    async <T,>(label: string, action: () => Promise<T>) => {
      setBusyAction(label);
      try {
        const result = await action();
        addLog('success', `${label}: ok`);
        return result;
      } catch (error) {
        const message = toErrorMessage(error);
        addLog('error', `${label}: ${message}`);
        throw error;
      } finally {
        setBusyAction(null);
      }
    },
    [addLog],
  );

  const refresh = useCallback(async () => {
    const [state, failure] = await Promise.all([
      OtaKit.getState(),
      OtaKit.getLastFailure(),
    ]);
    setRuntimeState(state);
    setLastFailure(failure);
  }, []);

  useEffect(() => {
    if (!environment.isReady) {
      return;
    }

    void (async () => {
      setStatus('Initializing...');
      try {
        const pluginAvailable = await waitForPluginAvailability();
        setEnvironment((prev) =>
          prev.pluginAvailable === pluginAvailable
            ? prev
            : { ...prev, pluginAvailable }
        );

        if (!pluginAvailable) {
          setStatus('OtaKit plugin unavailable ("OtaKit" not registered)');
          return;
        }

        // throw new DOMException('Sartup failed - rollback expected')

        await withAction('notifyAppReady', () => OtaKit.notifyAppReady());
        await withAction('refresh', refresh);
        setStatus('Ready');
      } catch (error) {
        setStatus(`Init failed: ${toErrorMessage(error)}`);
      } finally {
        await hideNativeSplashScreen();
        setStartupScreenVisible(false);
      }
    })();
  }, [environment.isReady, refresh, withAction]);

  const isBusy = busyAction !== null;

  const checkLatest = async () => {
    const value = await withAction('check', () => OtaKit.check());
    setLatest(value);
    setStatus(describeCheckResult(value));
  };

  const downloadLatest = async () => {
    const result = await withAction('download', () => OtaKit.download());
    setStatus(describeDownloadResult(result));
    await refresh();
  };

  const applyStaged = async () => {
    if (!runtimeState?.staged) return;
    const label = bundleLabel(runtimeState.staged);
    if (!window.confirm(`Apply staged update ${label} now and reload?`)) {
      return;
    }
    await withAction('apply', () => OtaKit.apply());
  };

  const updateNow = async () => {
    if (
      !window.confirm(
        runtimeState?.staged
          ? `Apply staged update ${bundleLabel(runtimeState.staged)} now and reload?`
          : 'Download the latest update, apply it, and reload now?',
      )
    ) {
      return;
    }
    await withAction('update', () => OtaKit.update());
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {startupScreenVisible ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 px-6">
          <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-cyan-950/30">
            <div className="flex items-center gap-3">
              <div className="size-3 rounded-full bg-cyan-400 shadow-[0_0_24px_rgba(34,211,238,0.75)]" />
              <p className="text-sm font-semibold text-cyan-200">Preparing OtaKit demo</p>
            </div>
            <p className="mt-4 text-sm text-slate-300">{status}</p>
            <p className="mt-2 text-xs text-slate-500">
              This mirrors the recommended startup gate: keep a loading screen visible until
              startup work finishes and the app has called <code>notifyAppReady()</code>.
            </p>
          </div>
        </div>
      ) : null}
      <main
        className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}
      >
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h1 className="text-2xl font-bold text-cyan-300">OtaKit Demo</h1>
          <p className="mt-2 text-xs text-slate-400">
            platform={environment.platform} native={String(environment.isNative)} plugin=
            {String(environment.pluginAvailable)} build={BUILD_LABEL}
          </p>
          <p className="mt-2 text-sm text-slate-200">Status: {status}</p>
          {busyAction ? <p className="mt-1 text-xs text-amber-300">Running: {busyAction}</p> : null}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          Placeholder text for demoing updates 38
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 font-semibold text-cyan-200">Manual Flow</h2>
          <div className="grid gap-3 md:grid-cols-6">
            <div>
              <button
                className="w-full rounded bg-slate-700 px-3 py-2 text-sm disabled:opacity-50"
                onClick={() => void withAction('refresh', refresh)}
                disabled={isBusy}
              >
                1. Refresh
              </button>
              <p className="mt-1 text-xs text-slate-400">
                Inspect current, staged, bundles, and last failure.
              </p>
            </div>
            <div>
              <button
                className="w-full rounded bg-indigo-700 px-3 py-2 text-sm disabled:opacity-50"
                onClick={() => void checkLatest()}
                disabled={isBusy}
              >
                2. Check
              </button>
              <p className="mt-1 text-xs text-slate-400">
                Ask the server if a newer bundle exists or is already staged.
              </p>
            </div>
            <div>
              <button
                className="w-full rounded bg-violet-700 px-3 py-2 text-sm disabled:opacity-50"
                onClick={() => void downloadLatest()}
                disabled={isBusy}
              >
                3. Download
              </button>
              <p className="mt-1 text-xs text-slate-400">
                Ensure the latest bundle is staged without re-downloading it unnecessarily.
              </p>
            </div>
            <div>
              <button
                className="w-full rounded bg-amber-700 px-3 py-2 text-sm disabled:opacity-50"
                onClick={() => void applyStaged()}
                disabled={isBusy || !runtimeState?.staged}
              >
                4. Apply
              </button>
              <p className="mt-1 text-xs text-slate-400">
                Activate the staged bundle now and reload.
              </p>
            </div>
            <div>
              <button
                className="w-full rounded bg-emerald-700 px-3 py-2 text-sm disabled:opacity-50"
                onClick={() => void updateNow()}
                disabled={isBusy}
              >
                5. Update Now
              </button>
              <p className="mt-1 text-xs text-slate-400">
                Apply the staged bundle, or download the latest one and apply it.
              </p>
            </div>
            <div>
              <button
                className="w-full rounded bg-teal-700 px-3 py-2 text-sm disabled:opacity-50"
                onClick={() => void withAction('notifyAppReady', () => OtaKit.notifyAppReady())}
                disabled={isBusy}
              >
                6. Notify Ready
              </button>
              <p className="mt-1 text-xs text-slate-400">Confirm the running bundle is healthy.</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-2 font-semibold text-cyan-200">Runtime State</h2>
            <ul className="space-y-1 text-sm">
              <li>Current: {bundleLabel(runtimeState?.current)}</li>
              <li>Fallback: {bundleLabel(runtimeState?.fallback)}</li>
              <li>Staged: {bundleLabel(runtimeState?.staged)}</li>
              <li>Builtin: {runtimeState?.builtinVersion ?? '-'}</li>
            </ul>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-2">
              <h2 className="font-semibold text-cyan-200">Diagnostics</h2>
            </div>
            <ul className="space-y-1 text-sm">
              <li>Latest version: {latestVersionLabel(latest)}</li>
              <li>Latest status: {latest?.kind ?? '-'}</li>
              <li>Latest size: {latestSizeLabel(latest)}</li>
              <li>Latest SHA: {latestShaLabel(latest)}</li>
              <li>Last failure: {bundleLabel(lastFailure)}</li>
            </ul>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-cyan-200">Log</h2>
            <div className="text-right">
              <button
                className="rounded bg-slate-700 px-2 py-1 text-xs"
                onClick={() => setLogs([])}
              >
                Clear
              </button>
              <p className="mt-1 text-[10px] text-slate-400">Clears visible logs only.</p>
            </div>
          </div>
          <div className="max-h-56 overflow-auto rounded bg-slate-950 p-3">
            {logs.length === 0 ? (
              <p className="text-xs text-slate-500">No entries yet.</p>
            ) : (
              logs.map((log) => (
                <p key={log.id} className={`mb-1 text-xs ${LOG_CLASS[log.level]}`}>
                  [{log.time}] {log.message}
                </p>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
