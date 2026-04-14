import Link from 'next/link';

import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Next.js Guide — OtaKit Docs',
  description: 'Step-by-step guide: from Next.js + Capacitor to your first OTA update.',
};

export default function GuidePage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Next.js guide</h1>
      <P>
        This walkthrough takes a Next.js app from zero to its first OTA update with the default
        hosted OtaKit flow.
      </P>

      <Separator className="my-10" />

      <div className="space-y-12">
        <Step number="1" title="Create the Next.js app">
          <Pre>{`npx create-next-app@latest my-app
cd my-app`}</Pre>
        </Step>

        <Step number="2" title="Configure Next.js for static export">
          <Pre>{`// next.config.ts
const nextConfig = {
  output: "export",
};

export default nextConfig;`}</Pre>
        </Step>

        <Step number="3" title="Add Capacitor">
          <Pre>{`npm install @capacitor/core @capacitor/cli
npx cap init my-app com.example.myapp`}</Pre>
          <P>
            Set <Code>webDir</Code> to <Code>out</Code> in <Code>capacitor.config.ts</Code>:
          </P>
          <Pre>{`import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "my-app",
  webDir: "out",
};

export default config;`}</Pre>
        </Step>

        <Step number="4" title="Add native platforms">
          <Pre>{`npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android`}</Pre>
        </Step>

        <Step number="5" title="Install the OtaKit plugin">
          <Pre>{`npm install @otakit/capacitor-updater
npx cap sync`}</Pre>
        </Step>

        <Step number="6" title="Create an OtaKit app and log in">
          <P>
            Create an app in the{' '}
            <Link
              href="/dashboard"
              className="font-medium text-foreground underline underline-offset-4"
            >
              OtaKit dashboard
            </Link>{' '}
            and copy its <Code>appId</Code>. Then install the CLI and log in:
          </P>
          <Pre>{`npm install -g @otakit/cli
otakit login`}</Pre>
        </Step>

        <Step number="7" title="Configure the plugin">
          <Pre>{`const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "my-app",
  webDir: "out",
  plugins: {
    OtaKit: {
      appId: "YOUR_OTAKIT_APP_ID",
      appReadyTimeout: 10000,
    }
  }
};`}</Pre>
        </Step>

        <Step number="8" title="Add notifyAppReady()">
          <P>Create a client component that confirms the app loaded successfully:</P>
          <Pre>{`// app/components/AppReady.tsx
"use client";
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

export function AppReady() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      OtaKit.notifyAppReady();
    }
  }, []);

  return null;
}`}</Pre>
          <P>Add it to your root layout:</P>
          <Pre>{`// app/layout.tsx
import { AppReady } from "./components/AppReady";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppReady />
        {children}
      </body>
    </html>
  );
}`}</Pre>
        </Step>

        <Step number="9" title="Build and run on a device">
          <Pre>{`npm run build
npx cap sync
npx cap run ios       # or: npx cap run android`}</Pre>

        <P>
          Note: The app must be published to the App Store (and/or Play Store) at least once with the OtaKit plugin configured 
          before end users&rsquo; devices can receive live updates.
        </P>
        </Step>

        <Step number="10" title="Ship your first OTA update">
          <P>Make a visible change to your app, rebuild, and release:</P>
          <Pre>{`npm run build
otakit upload --release`}</Pre>
          <P>
            Relaunch the app on your device. By default, OtaKit downloads the update in the
            background and activates it on the next cold launch.
          </P>
        </Step>
      </div>

      <Separator className="my-10" />

      <H2>Next</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Add{' '}
          <Link
            href="/docs/ci"
            className="font-medium text-foreground underline underline-offset-4"
          >
            CI automation
          </Link>
          .
        </li>
        <li>
          Keep the base channel first, then add{' '}
          <Link
            href="/docs/channels"
            className="font-medium text-foreground underline underline-offset-4"
          >
            channels
          </Link>{' '}
          only when you need them.
        </li>
        <li>
          Use the{' '}
          <Link
            href="/docs/plugin"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Plugin API
          </Link>{' '}
          and{' '}
          <Link
            href="/docs/cli"
            className="font-medium text-foreground underline underline-offset-4"
          >
            CLI reference
          </Link>{' '}
          for advanced flows.
        </li>
      </ul>
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

function Step({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex size-7 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
          {number}
        </div>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="ml-10">{children}</div>
    </div>
  );
}
