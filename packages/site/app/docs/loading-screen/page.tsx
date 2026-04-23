import Link from 'next/link';

import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Loading Screen Guide — OtaKit Docs',
  description:
    'Recommended startup pattern: keep a splash or loading screen visible until your app finishes booting and calls notifyAppReady().',
};

export default function LoadingScreenGuidePage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Loading screen guide</h1>
      <P>
        OtaKit does not manage a splash screen for you. The recommended setup is: keep a native
        splash screen or app loading screen visible while your app boots, then call{' '}
        <Code>notifyAppReady()</Code>, then hide that loading UI.
      </P>

      <Separator className="my-10" />

      <H2>Why this matters</H2>
      <P>
        A newly activated bundle starts in a trial state. OtaKit only marks it healthy after your
        app calls <Code>notifyAppReady()</Code>. If the new bundle crashes, hangs, or never reaches
        that point, OtaKit rolls it back automatically.
      </P>
      <P>
        Your startup UI should cover the time between native launch and the moment your app is
        actually usable. If you release the splash too early, users can see a blank or
        half-initialized screen right before <Code>notifyAppReady()</Code>.
      </P>

      <Separator className="my-10" />

      <H2>Recommended pattern</H2>
      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
        <li>Show a native splash screen or a full-screen in-app loading view immediately.</li>
        <li>Run your normal startup work: auth restore, config fetch, app hydration, first render.</li>
        <li>Call <Code>notifyAppReady()</Code> once the current bundle is genuinely usable.</li>
        <li>Hide the splash screen or loading view only after that startup work is done.</li>
      </ol>

      <Separator className="my-10" />

      <H2>With Capacitor Splash Screen</H2>
      <P>
        If you want the native launch screen to stay visible until your JS app is ready, use the{' '}
        <Code>@capacitor/splash-screen</Code> plugin and disable auto-hide.
      </P>
      <Pre>{`npm install @capacitor/splash-screen
npx cap sync`}</Pre>
      <P>Then configure Capacitor to keep the splash screen up:</P>
      <Pre>{`// capacitor.config.ts
plugins: {
  SplashScreen: {
    launchAutoHide: false,
  },
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    appReadyTimeout: 10000,
  },
}`}</Pre>
      <P>
        During startup, call <Code>notifyAppReady()</Code> and then hide the splash screen:
      </P>
      <Pre>{`import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { OtaKit } from "@otakit/capacitor-updater";

async function finishStartup() {
  if (Capacitor.isNativePlatform()) {
    await OtaKit.notifyAppReady();
    await SplashScreen.hide();
  }
}`}</Pre>

      <Separator className="my-10" />

      <H2>React and Next.js pattern</H2>
      <P>
        For React-style apps, use one small client component that owns startup. It can wait for
        your app bootstrap, call <Code>notifyAppReady()</Code>, then hide the splash screen or
        remove an in-app loading overlay.
      </P>
      <Pre>{`"use client";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { OtaKit } from "@otakit/capacitor-updater";

export function AppReadyGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // Run your own startup work here.
        // await restoreSession();
        // await loadInitialData();

        if (Capacitor.isNativePlatform()) {
          await OtaKit.notifyAppReady();
          await SplashScreen.hide();
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <div className="startup-screen">Loading…</div>;
  }

  return <>{children}</>;
}`}</Pre>
      <P>
        The important part is not the exact component shape. The important part is the order:
        startup work, then <Code>notifyAppReady()</Code>, then release the loading UI.
      </P>

      <Separator className="my-10" />

      <H2>Rules of thumb</H2>
      <ul className="mt-4 list-disc space-y-3 pl-5 text-sm text-muted-foreground">
        <li>
          Call <Code>notifyAppReady()</Code> from normal app startup, not from the old JS context
          that triggered <Code>apply()</Code> or <Code>update()</Code>.
        </li>
        <li>Do not hide the splash screen before your root UI is actually ready to use.</li>
        <li>
          If startup fails, still release the splash or show an error screen. Do not trap the user
          behind an infinite loader.
        </li>
        <li>
          If you do not want to use <Code>@capacitor/splash-screen</Code>, an in-app fullscreen
          loading view is still fine. The same startup order applies.
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Recommended next step</H2>
      <P>
        Apply this pattern in the{' '}
        <Link
          href="/docs/guide"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Next.js guide
        </Link>{' '}
        or the{' '}
        <Link
          href="/docs/react"
          className="font-medium text-foreground underline underline-offset-4"
        >
          React guide
        </Link>
        .
      </P>
    </>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border bg-muted px-4 py-3 font-mono text-xs leading-6 text-muted-foreground">
      {children}
    </pre>
  );
}
