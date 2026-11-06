'use client';

import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';

import type { DashboardInitialData } from '@/app/components/dashboard-types';
import { ProductDashboard } from '@/app/components/ProductDashboard';
import { DemoConsole } from '@/lib/demo/api';
import { installDemoFetch } from '@/lib/demo/fetch';
import {
  DEMO_APPS,
  DEMO_BROKEN_VERSION,
  DEMO_NEXT_VERSION,
  DEMO_ORGANIZATION,
  DEMO_USER,
} from '@/lib/demo/scenario';
import type { DemoChange } from '@/lib/demo/world';
import { setConversionTracking } from '@/lib/gtag';

import { DemoGuide, type DemoMission } from './DemoGuide';
import { DemoHeader } from './DemoHeader';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://otakit.app').replace(/\/+$/, '');
/** How often the event list and chart pick up the fleet's new events. */
const LIVE_REFRESH_MS = 3000;
const DEVICES = DEMO_APPS[0].lanes.reduce((sum, lane) => sum + lane.devices, 0);

function demoInitialData(now: number): DashboardInitialData {
  return {
    user: { ...DEMO_USER, createdAt: new Date(now).toISOString() },
    activeOrganization: { ...DEMO_ORGANIZATION, role: 'owner', pushEnabled: false },
    memberships: [
      {
        id: 'demo-membership',
        organizationId: DEMO_ORGANIZATION.id,
        organizationName: DEMO_ORGANIZATION.name,
        role: 'owner',
      },
    ],
    apps: DEMO_APPS.map((app) => ({
      id: app.id,
      slug: app.slug,
      createdAt: new Date(now - app.createdAgo).toISOString(),
      bundleCount: app.bundles.length,
    })),
    organizationApiKeys: [],
    billingEnabled: false,
    analyticsEnabled: true,
    remoteMcpOAuthEnabled: false,
  };
}

function missionOf(change: DemoChange): DemoMission[] {
  const production = change.channel === null;
  const next = change.bundleVersion === DEMO_NEXT_VERSION && production;
  if (change.type === 'released' && next) {
    return change.rolloutPercent === 100 ? ['release', 'complete'] : ['release'];
  }
  if (change.type === 'rollout' && next && change.rolloutPercent === 100) return ['complete'];
  if (change.type === 'auto_reverted') return ['autoRevert'];
  if (change.type === 'reverted' && change.bundleVersion === DEMO_BROKEN_VERSION)
    return ['autoRevert'];
  return [];
}

/**
 * The real dashboard on a simulated fleet. The simulation runs in the browser:
 * the dashboard's API requests are answered by it, and nothing leaves the page.
 */
export function DemoApp() {
  const [generation, setGeneration] = useState(0);
  const [demo, setDemo] = useState<{ console: DemoConsole; now: number } | null>(null);
  const [liveRefresh, setLiveRefresh] = useState({ events: 0, releases: 0 });
  const [done, setDone] = useState<ReadonlySet<DemoMission>>(new Set());

  // Built after the first paint: the fleet follows the viewer's clock.
  useEffect(() => {
    let uninstall: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      const created = new DemoConsole(now);
      uninstall = installDemoFetch(created);
      setDemo({ console: created, now });
    }, 20);
    setConversionTracking(false);
    return () => {
      window.clearTimeout(timer);
      uninstall?.();
      setConversionTracking(true);
    };
  }, [generation]);

  // The fleet keeps moving; the list and chart refresh quietly.
  useEffect(() => {
    if (!demo) return;
    const tick = window.setInterval(() => demo.console.advanceTo(Date.now()), 1000);
    const refresh = window.setInterval(
      () => setLiveRefresh((current) => ({ ...current, events: current.events + 1 })),
      LIVE_REFRESH_MS,
    );
    const unsubscribe = demo.console.worlds.map((world) =>
      world.subscribe((change) => {
        setLiveRefresh((current) => ({
          events: current.events + 1,
          releases: current.releases + 1,
        }));
        const reached = missionOf(change);
        if (reached.length > 0) setDone((current) => new Set([...current, ...reached]));
        if (change.type === 'auto_reverted') {
          toast.error(
            `Auto-revert reverted ${change.bundleVersion} on ${change.channel ?? 'base'}`,
            {
              description: `${change.rollbackSharePercent}% of its launches rolled back. Devices are returning to the previous bundle.`,
              duration: 12_000,
            },
          );
        }
      }),
    );
    return () => {
      window.clearInterval(tick);
      window.clearInterval(refresh);
      for (const stop of unsubscribe) stop();
    };
  }, [demo]);

  const initialData = useMemo(() => (demo ? demoInitialData(demo.now) : null), [demo]);

  function reset() {
    setDemo(null);
    setDone(new Set());
    setLiveRefresh({ events: 0, releases: 0 });
    setGeneration((value) => value + 1);
  }

  if (!demo || !initialData) {
    return (
      <div className="m-3 flex min-h-[calc(100vh-1.5rem)] flex-col items-center justify-center gap-3 border border-border text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
        Starting {DEVICES.toLocaleString('en-US')} simulated devices
      </div>
    );
  }

  return (
    <>
      <ProductDashboard
        key={generation}
        initialData={initialData}
        header={<DemoHeader siteUrl={SITE_URL} />}
        brandHref={SITE_URL}
        docsHref={`${SITE_URL}/docs`}
        selectionStorageKey="demo:selectedAppId"
        liveRefresh={liveRefresh}
        // Room below the dashboard so the guide never covers its end on phones.
        shellClassName="mb-40 sm:mb-3"
      />
      <DemoGuide done={done} devices={DEVICES} onReset={reset} />
    </>
  );
}
