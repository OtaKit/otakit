import type { Metadata } from 'next';
import Link from 'next/link';

import { BlogArticle, Callout, Code, Pre } from '../_components/BlogArticle';
import { getBlogPost } from '@/lib/blog';

const post = getBlogPost('how-ota-works-for-capacitor-apps');

export const metadata: Metadata = {
  title: `${post?.title} — OtaKit Blog`,
  description: post?.description,
};

export default function HowOtaWorksPage() {
  if (!post) {
    return null;
  }

  return (
    <BlogArticle post={post}>
      <p>
        The cleanest way to think about OTA in a Capacitor app is this: your native app shell and
        your web bundle move at different speeds. The App Store and Google Play ship the native
        shell. OTA ships the web layer that runs inside that shell.
      </p>
      <p>
        If you keep that boundary explicit, the rest becomes straightforward. OtaKit ships static
        web bundles, assigns them to release lanes, verifies them on device, and only promotes a
        newly activated bundle after the app proves it started correctly.
      </p>

      <h2>What actually moves over the air</h2>
      <p>
        In a Capacitor app, the OTA payload is the built output of your web app: HTML, CSS,
        JavaScript, and related assets. The native wrapper stays installed from the store build.
      </p>
      <p>
        That is why the OtaKit docs keep talking about <strong>bundle</strong>,{' '}
        <strong>channel</strong>, and <strong>runtime version</strong> instead of “update the app”
        in the abstract. The native app is not replaced. A new web bundle is staged and then loaded
        by the existing shell.
      </p>

      <Callout>
        <p>
          Safe mental model: store release changes the shell, OTA release changes the web layer
          running inside it.
        </p>
      </Callout>

      <h2>The core objects</h2>
      <ul>
        <li>
          <strong>App</strong>: the Capacitor app tied to an OtaKit <Code>appId</Code>.
        </li>
        <li>
          <strong>Bundle</strong>: one uploaded build output with a version, hash, and size.
        </li>
        <li>
          <strong>Release</strong>: promotion of a bundle to a lane that devices can see.
        </li>
        <li>
          <strong>Channel</strong>: rollout audience such as base, staging, or beta.
        </li>
        <li>
          <strong>Runtime version</strong>: compatibility boundary between native builds.
        </li>
      </ul>
      <p>
        OtaKit keeps channels and runtime version separate for a reason. A channel answers “who
        should receive this rollout?” Runtime version answers “which native shell can safely run
        this bundle?”
      </p>

      <h2>The delivery flow</h2>
      <ol>
        <li>You build the web app output.</li>
        <li>You upload that build as a bundle.</li>
        <li>You release it to a channel.</li>
        <li>The server publishes a signed manifest for that lane.</li>
        <li>The app checks the manifest on launch or resume.</li>
        <li>If a newer bundle exists, the app downloads and verifies it.</li>
        <li>The bundle is staged, then activated based on update mode.</li>
        <li>
          The app calls <Code>notifyAppReady()</Code> to confirm the new bundle is healthy.
        </li>
      </ol>

      <Pre>{`npm run build
otakit upload --release staging

# later, promote the same bundle
otakit release <bundle-id> --channel production`}</Pre>

      <h2>Why manifests matter</h2>
      <p>
        The device should not trust an arbitrary URL. In OtaKit, the app first fetches a manifest
        for its <Code>appId + channel + runtimeVersion</Code> lane, then verifies the downloaded zip
        against the hash declared by that manifest.
      </p>
      <p>
        That turns OTA from “download whatever the server points at” into “download the exact bundle
        that a signed manifest says should be running for this lane.”
      </p>

      <h2>Why safe activation matters</h2>
      <p>
        The hardest problem in OTA is not getting code onto the device. It is making sure a broken
        bundle does not strand users there. OtaKit handles that with a small but important state
        machine: current, fallback, and staged bundles.
      </p>
      <p>
        A newly activated bundle enters a trial period. If the app never calls{' '}
        <Code>notifyAppReady()</Code>, OtaKit assumes startup failed and rolls back to the last
        known-good bundle automatically.
      </p>

      <Callout>
        <p>
          OTA without a confirmation handshake is fast. OTA with a confirmation handshake is fast
          and survivable.
        </p>
      </Callout>

      <h2>When to use channels</h2>
      <p>
        Start simple. The base channel is enough for many apps. Add named channels when you need
        tester cohorts, staged rollouts, or promotion from QA to production without rebuilding.
      </p>
      <p>
        Add <Code>runtimeVersion</Code> only when a new store build introduces a compatibility
        boundary. That prevents a new native shell from consuming an older OTA stream by accident.
      </p>

      <h2>What still requires a store submission</h2>
      <p>
        OTA is the right tool for the web layer. It is not the right tool for native changes:
        adding or removing native plugins, changing entitlements, changing permissions, or shipping
        functionality that depends on new native code still belongs in a new store build.
      </p>
      <p>
        That distinction is why our setup docs explicitly tell you to publish the app to the store
        at least once with the OtaKit plugin configured before expecting devices to receive OTA.
      </p>

      <h2>Where to go next</h2>
      <p>
        If you want the concrete setup path, start with{' '}
        <Link href="/docs/setup" className="underline underline-offset-4 hover:text-foreground">
          Setup
        </Link>
        . If you want the runtime details, go straight to the{' '}
        <Link href="/docs/plugin" className="underline underline-offset-4 hover:text-foreground">
          Plugin API
        </Link>{' '}
        and{' '}
        <Link href="/docs/channels" className="underline underline-offset-4 hover:text-foreground">
          Channels &amp; Runtime Version
        </Link>{' '}
        pages.
      </p>
    </BlogArticle>
  );
}
