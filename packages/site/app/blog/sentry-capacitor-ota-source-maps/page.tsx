import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('sentry-capacitor-ota-source-maps')!;

export const metadata = blogPostMetadata(post.slug);

export default function SentryCapacitorOtaPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Error tracking in a Capacitor app has one twist that web and native guides both miss. Your
        store build number says which native shell a user has. It does not say which JavaScript they
        are running. Once you ship web updates over the air, one store version can run a dozen
        different bundles, and a stack trace is only useful if you know which one.
      </p>
      <p>
        This guide sets up Sentry so every error is tied to the exact bundle that produced it, with
        readable stack traces, no source maps on user devices, and an alert when an update rolls
        back.
      </p>

      <h2>1. Install the SDK</h2>
      <p>
        Sentry&apos;s Capacitor SDK captures JavaScript errors and native crashes, and pairs with the
        SDK for your framework. For a React app:
      </p>
      <Pre>{`npm install @sentry/capacitor @sentry/react
npx cap sync`}</Pre>
      <p>
        Use <Code>@sentry/vue</Code>, <Code>@sentry/angular</Code> or <Code>@sentry/svelte</Code>{' '}
        for other frameworks. Because the Capacitor SDK includes native code, it must be in a store
        build before it can report native crashes.
      </p>

      <h2>2. One version string for everything</h2>
      <p>
        The key idea: pick one identifier per web build, and use it as the Sentry release, the
        OtaKit bundle version and the value your app reports at runtime. The git commit works well:
      </p>
      <Pre>{`// vite.config.ts
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

const release =
  process.env.APP_RELEASE ?? execSync('git rev-parse --short HEAD').toString().trim();

export default defineConfig({
  define: {
    __APP_RELEASE__: JSON.stringify(release),
  },
  build: {
    sourcemap: 'hidden',
  },
});`}</Pre>
      <p>
        <Code>sourcemap: &apos;hidden&apos;</Code> generates source maps without adding a{' '}
        <Code>sourceMappingURL</Code> comment to your bundles. You upload them to Sentry and never
        ship them to devices.
      </p>

      <h2>3. Initialise Sentry with the release</h2>
      <Pre>{`// src/sentry.ts
import * as Sentry from '@sentry/capacitor';
import * as SentryReact from '@sentry/react';
import { OtaKit } from '@otakit/capacitor-updater';

declare const __APP_RELEASE__: string;

Sentry.init(
  {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    release: __APP_RELEASE__,
    tracesSampleRate: 0.1,
  },
  SentryReact.init,
);

// Tag which bundle is active: builtin (shipped in the store build) or an OTA bundle
OtaKit.getState().then(({ current, builtinVersion }) => {
  Sentry.setTag('bundle.status', current.status);
  Sentry.setTag('bundle.version', current.version);
  Sentry.setTag('native.version', builtinVersion);
});`}</Pre>
      <p>
        Now every event carries the web release, and you can filter issues by bundle in the Sentry
        UI. When an error rate jumps, you see immediately whether it started with a specific OTA
        release or with a new store build.
      </p>

      <h2>4. Upload source maps, then remove them</h2>
      <p>
        In CI, after the web build and before the OTA upload, inject debug IDs and upload the maps to
        Sentry. Debug IDs link each minified file to its map, so stack traces resolve even if release
        names drift:
      </p>
      <Pre>{`export APP_RELEASE=$(git rev-parse --short HEAD)

npm run build

npx @sentry/cli sourcemaps inject ./dist
npx @sentry/cli sourcemaps upload --release="$APP_RELEASE" ./dist

# Source maps are for Sentry, not for phones
find ./dist -name "*.map" -delete

OTAKIT_VERSION="$APP_RELEASE" npx @otakit/cli upload --release`}</Pre>
      <p>
        Deleting the maps before the OTA upload keeps your bundle smaller and your original source
        off user devices. Setting <Code>OTAKIT_VERSION</Code> makes the bundle version in the OtaKit
        dashboard match the Sentry release exactly, so you can go from an issue to the release that
        caused it in one step.
      </p>

      <h2>5. Report rollbacks</h2>
      <p>
        <A href="/">OtaKit</A> rolls a bundle back automatically when it does not call{' '}
        <Code>notifyAppReady()</Code> in time, usually because it crashed or hung on startup. That is
        exactly the kind of event you want in Sentry. A rollback that happens during startup occurs
        before your JavaScript runs, so read it on the next launch with{' '}
        <Code>getLastFailure()</Code>, which returns the most recent failure, and listen for
        rollbacks while the app is running:
      </p>
      <Pre>{`import * as Sentry from '@sentry/capacitor';
import { OtaKit } from '@otakit/capacitor-updater';

OtaKit.addListener('rollback', (failure) => {
  Sentry.captureMessage(\`OTA rollback: \${failure.version}\`, {
    level: 'error',
    tags: { 'ota.version': failure.version, 'ota.channel': failure.channel ?? 'base' },
    extra: { reason: failure.reason },
  });
});

// Startup rollbacks happen before JS runs; report each one once
const lastFailure = await OtaKit.getLastFailure();
if (lastFailure && localStorage.getItem('ota.reportedFailure') !== lastFailure.id) {
  Sentry.captureMessage(\`OTA startup rollback: \${lastFailure.version}\`, {
    level: 'error',
    extra: { ...lastFailure },
  });
  localStorage.setItem('ota.reportedFailure', lastFailure.id);
}

// Tell OtaKit this bundle started correctly
await OtaKit.notifyAppReady();`}</Pre>
      <p>
        Set an alert on these messages. A rollback means a release is failing on real devices, and
        you want to know within minutes. For more patterns, see{' '}
        <A href="/docs/events">events and listeners</A>.
      </p>

      <Callout>
        <p>
          <strong>Call <Code>notifyAppReady()</Code> after your app has really started</strong>, for
          example after the first screen renders, not at the top of <Code>main.ts</Code>. If you call
          it too early, a bundle that crashes a second later is marked healthy and will not be rolled
          back.
        </p>
      </Callout>

      <h2>6. Close the loop</h2>
      <p>With this in place, a bad release plays out like this:</p>
      <ol>
        <li>You release bundle <Code>a1b2c3d</Code> to production.</li>
        <li>Sentry shows a new issue, tagged with <Code>bundle.version: a1b2c3d</Code>.</li>
        <li>The stack trace points to the exact line, thanks to the uploaded source maps.</li>
        <li>
          You release the previous bundle again, or ship a fix, over the air. Users get it on their
          next launch, with no App Review in between.
        </li>
      </ol>
      <p>
        Error tracking tells you what broke. OTA updates let you fix it the same hour. Together they
        turn a week-long incident into an afternoon. Next, read{' '}
        <A href="/blog/monitor-capacitor-ota-updates">monitoring Capacitor OTA updates</A> and{' '}
        <A href="/blog/capacitor-ota-rollback-strategies">rollback strategies</A>.
      </p>
    </BlogArticle>
  );
}
