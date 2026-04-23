import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Loading Screen Guide - OtaKit Docs',
  description: 'Use Capacitor Splash Screen with OtaKit to avoid update activation flicker.',
};

export default function LoadingScreenGuidePage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Loading screen guide</h1>
      <P>
        Immediate updates can reload the WebView while a new bundle is activated. Without a splash
        screen, users may briefly see a blank or half-loaded page. The fix is simple: keep the
        native splash screen visible until your app calls <Code>notifyAppReady()</Code>.
      </P>

      <Separator className="my-10" />

      <H2>Use Capacitor Splash Screen</H2>
      <P>
        OtaKit does not include its own loading UI. Capacitor already has the right native primitive
        for this: <Code>@capacitor/splash-screen</Code>.
      </P>
      <Pre>{`npm install @capacitor/splash-screen
npx cap sync`}</Pre>
      <P>Disable auto-hide so the splash stays up while the WebView starts:</P>
      <Pre>{`// capacitor.config.ts
plugins: {
  SplashScreen: {
    launchAutoHide: false,
  },
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
  },
}`}</Pre>

      <Separator className="my-10" />

      <H2>Call it from app startup</H2>
      <P>
        In your root app startup, call <Code>notifyAppReady()</Code>, then hide the splash screen.
        Do not wait for optional API calls, analytics, push registration, or long background work.
      </P>
      <Pre>{`import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { OtaKit } from "@otakit/capacitor-updater";

async function markAppReady() {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  await OtaKit.notifyAppReady();
  await SplashScreen.hide();
}`}</Pre>

      <Separator className="my-10" />

      <H2>React and Next.js</H2>
      <P>Add a tiny client component near the root of your app:</P>
      <Pre>{`"use client";
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { OtaKit } from "@otakit/capacitor-updater";

export function AppReady() {
  useEffect(() => {
    async function markReady() {
      if (Capacitor.isNativePlatform()) {
        await OtaKit.notifyAppReady();
        await SplashScreen.hide();
      }
    }

    void markReady();
  }, []);

  return null;
}`}</Pre>
      <P>
        Render it once from your root layout or root app component. If startup data fails, still
        call <Code>notifyAppReady()</Code> once the app can render. Show offline, signed-out, empty,
        or retry states in your normal UI.
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
