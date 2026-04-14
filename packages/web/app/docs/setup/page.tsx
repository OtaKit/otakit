import Link from 'next/link';

import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Setup — OtaKit Docs',
  description: 'Set up the default hosted OtaKit flow in a Capacitor project.',
};

export default function SetupPage() {
  return (
    <>
      <H1>Setup</H1>
      <P>This is the most simple, default hosted setup path.</P>

      <Separator className="my-10" />

      <H2>1. Create your app in the dashboard</H2>
      <P>
        Sign in to the{' '}
        <Link
          href="/dashboard"
          className="font-medium text-foreground underline underline-offset-4"
        >
          OtaKit dashboard
        </Link>
        , create an app, and copy its OtaKit <Code>appId</Code>.
      </P>

      <Separator className="my-10" />

      <H2>2. Install the Capacitor plugin</H2>
      <Pre>{`npm install @otakit/capacitor-updater
npx cap sync`}</Pre>

      <Separator className="my-10" />

      <H2>3. Configure the plugin</H2>
      <P>
        Add the OtaKit plugin to <Code>capacitor.config.ts</Code> and paste in the{' '}
        <Code>appId</Code> from the dashboard.
      </P>
      <Pre>{`// capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "out",
  plugins: {
    OtaKit: {
      appId: "YOUR_OTAKIT_APP_ID",
    }
  }
};

export default config;`}</Pre>

      <P>Note: Your app must be published to the app store at least once with the OtaKit     
      plugin configured before it can receive updates!</P>

      <Separator className="my-10" />

      <H2>4. Add notifyAppReady()</H2>
      <P>
        Call <Code>notifyAppReady()</Code> once your app has loaded. If the new bundle is activated
        and your app never confirms that it started successfully, OtaKit rolls back automatically.
      </P>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";

await OtaKit.notifyAppReady();`}</Pre>
      <P>For React-style apps, wrap it in a client-side effect:</P>
      <Pre>{`"use client";
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

export function AppReadyProvider() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      OtaKit.notifyAppReady();
    }
  }, []);

  return null;
}`}</Pre>

      <Separator className="my-10" />

      <H2>5. Install the CLI and sign in</H2>
      <Pre>{`npm install -g @otakit/cli
otakit login`}</Pre>

      <Separator className="my-10" />

      <H2>6. Build and release</H2>
      <Pre>{`npm run build
otakit upload --release`}</Pre>
      <P>
        That publishes the bundle to the base channel. By default, OtaKit downloads it in the
        background and activates it on the next cold app launch.
      </P>

      <Separator className="my-10" />

      <P>
        Next, continue with the{' '}
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
        </Link>{' '}
        if you want a full walkthrough. Use the{' '}
        <Link
          href="/docs/plugin"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Plugin API
        </Link>{' '}
        and{' '}
        <Link href="/docs/cli" className="font-medium text-foreground underline underline-offset-4">
          CLI reference
        </Link>{' '}
        for advanced flows and exact command details.
      </P>
    </>
  );
}

function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold tracking-tight">{children}</h1>;
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-0 text-lg font-semibold tracking-tight">{children}</h2>;
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
