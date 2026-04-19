'use client';

import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  type BundleInfo,
  type LatestVersion,
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function shortId(value: string | undefined): string {
  if (!value) return '-';
  return `${value.slice(0, 8)}...`;
}

function bundleLabel(bundle: BundleInfo | null | undefined): string {
  if (!bundle) return '-';
  return `${bundle.version} (${shortId(bundle.id)})`;
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

export default function Home() {
  const [environment, setEnvironment] = useState(INITIAL_ENVIRONMENT);

  const [status, setStatus] = useState('Booting...');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const logSeqRef = useRef(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [runtimeState, setRuntimeState] = useState<OtaKitState | null>(null);
  const [latest, setLatest] = useState<LatestVersion | null>(null);
  const [lastFailure, setLastFailure] = useState<BundleInfo | null>(null);

  useEffect(() => {
    setEnvironment({
      isReady: true,
      platform: Capacitor.getPlatform(),
      isNative: Capacitor.isNativePlatform(),
      pluginAvailable: Capacitor.isPluginAvailable('OtaKit'),
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

    if (!environment.pluginAvailable) {
      setStatus('OtaKit plugin unavailable ("OtaKit" not registered)');
      return;
    }

    const listeners: PluginListenerHandle[] = [];
    const listenerApi = OtaKit as unknown as {
      addListener: (
        event: string,
        callback: (payload: unknown) => void,
      ) => Promise<PluginListenerHandle>;
    };

    const addListener = async (event: string) => {
      const handle = await listenerApi.addListener(event, () => {
        addLog('info', `event: ${event}`);
      });
      listeners.push(handle);
    };

    void (async () => {
      setStatus('Initializing...');
      await Promise.all([
        addListener('downloadComplete'),
        addListener('downloadFailed'),
        addListener('updateAvailable'),
        addListener('rollback'),
      ]);

      try {
        await withAction('refresh', refresh);
        await withAction('notifyAppReady', () => OtaKit.notifyAppReady());
        setStatus('Ready');
      } catch (error) {
        setStatus(`Init failed: ${toErrorMessage(error)}`);
      }
    })();

    return () => {
      for (const listener of listeners) {
        void listener.remove();
      }
    };
  }, [addLog, environment.isReady, environment.pluginAvailable, refresh, withAction]);

  const isBusy = busyAction !== null;

  const checkLatest = async () => {
    const value = await withAction('check', () => OtaKit.check());
    setLatest(value);
    if (!value) {
      setStatus('No update available');
    } else if (value.downloaded) {
      setStatus(`Update ${value.version} is already downloaded and ready to apply.`);
    } else {
      setStatus(`Update available: ${value.version}`);
    }
  };

  const downloadLatest = async () => {
    const bundle = await withAction('download', () => OtaKit.download());
    if (bundle) {
      setStatus(`Prepared ${bundle.version}. It is staged and ready to apply.`);
    } else {
      setStatus('No new update');
    }
    await refresh();
  };

  const applyStaged = async () => {
    if (!runtimeState?.staged) return;
    if (!window.confirm(`Apply staged update ${runtimeState.staged.version} now and reload?`)) {
      return;
    }
    await withAction('apply', () => OtaKit.apply());
  };

  const updateNow = async () => {
    if (
      !window.confirm(
        runtimeState?.staged
          ? `Apply staged update ${runtimeState.staged.version} now and reload?`
          : 'Download the latest update, apply it, and reload now?',
      )
    ) {
      return;
    }
    await withAction('update', () => OtaKit.update());
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main
        className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}
      >
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h1 className="text-2xl font-bold text-cyan-300">OtaKit Demo v0.4.0</h1>
          <p className="mt-2 text-xs text-slate-400">
            platform={environment.platform} native={String(environment.isNative)} plugin=
            {String(environment.pluginAvailable)} build={process.env.BUILD_TIME}
          </p>
          <p className="mt-2 text-sm text-slate-200">Status: {status}</p>
          {busyAction ? <p className="mt-1 text-xs text-amber-300">Running: {busyAction}</p> : null}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          Placeholder text for demoing updates 17
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
              <li>Staged: {bundleLabel(runtimeState?.staged)}</li>
              <li>Builtin: {runtimeState?.builtinVersion ?? '-'}</li>
            </ul>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-2">
              <h2 className="font-semibold text-cyan-200">Diagnostics</h2>
            </div>
            <ul className="space-y-1 text-sm">
              <li>Latest version: {latest?.version ?? '-'}</li>
              <li>Latest downloaded: {latest ? String(Boolean(latest.downloaded)) : '-'}</li>
              <li>Latest size: {latest ? `${latest.size} bytes` : '-'}</li>
              <li>Latest SHA: {shortId(latest?.sha256)}</li>
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
