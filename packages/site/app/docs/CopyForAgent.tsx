'use client';

import { useState } from 'react';
import { Check, ClipboardCopy } from 'lucide-react';

import { site } from '@/lib/site';

/* "Copy guide for coding agent" button for the Quick setup page. Clicking it
   copies a complete, self-contained setup guide to the clipboard so a reader
   can paste it straight into Claude Code, Cursor, Codex CLI, or any other
   coding agent. The copied text leads with the docs + llms.txt links so the
   agent can pull the full API reference, then inlines the quick-guide steps so
   it has everything it needs without a network round-trip. */
function buildGuide(): string {
  return `# Set up OtaKit in my Capacitor app

OtaKit is over-the-air live updates for Capacitor apps — ship instant updates without app store delays. Use these docs as you work; read the llms.txt first for the full API reference, then follow the steps below.

- Docs: ${site.url}/docs
- Full docs as plain text (for LLMs): ${site.url}/docs/llms.txt
- Quick setup: ${site.url}/docs/setup

## 1. Create your app in the dashboard

Sign in to the OtaKit dashboard (${site.console}/dashboard), create an app, and copy its OtaKit \`appId\`.

## 2. Install the Capacitor plugin

\`\`\`bash
npm install @otakit/capacitor-updater
npx cap sync
\`\`\`

## 3. Configure the plugin

Add the OtaKit plugin to \`capacitor.config.ts\` and paste in the \`appId\` from the dashboard.

\`\`\`ts
// capacitor.config.ts
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

export default config;
\`\`\`

Note: the app must be published to the app store at least once with the OtaKit plugin configured before it can receive updates.

Optional: set \`launchPolicy\`, \`resumePolicy\`, \`runtimePolicy\`, and \`checkInterval\` if you want something other than the hosted defaults — see ${site.url}/docs/plugin.

## 4. Add notifyAppReady()

Call \`notifyAppReady()\` once the app has loaded. If a new bundle is activated and the app never confirms it started successfully, OtaKit rolls back automatically.

\`\`\`ts
import { OtaKit } from "@otakit/capacitor-updater";

await OtaKit.notifyAppReady();
\`\`\`

For React-style apps, wrap it in a client-side effect:

\`\`\`ts
"use client";
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
}
\`\`\`

## 5. Install the CLI and sign in

\`\`\`bash
npm install -g @otakit/cli
otakit login
\`\`\`

## 6. Build and release

\`\`\`bash
npm run build
otakit upload --release
\`\`\`

That publishes the bundle to the base channel. By default OtaKit downloads it in the background and activates it on the next cold app launch.

Adapt the appId, config, and release flow to my project. If you need options or APIs not shown here, consult ${site.url}/docs/llms.txt.
`;
}

export function CopyForAgent({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard
      ?.writeText(buildGuide())
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy the setup guide for a coding agent"
      className={`inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${className}`}
    >
      {copied ? (
        <Check className="size-4 text-emerald-500" strokeWidth={2} aria-hidden />
      ) : (
        <ClipboardCopy className="size-4" strokeWidth={2} aria-hidden />
      )}
      {copied ? 'Copied for coding agent' : 'Copy guide for coding agent'}
    </button>
  );
}
