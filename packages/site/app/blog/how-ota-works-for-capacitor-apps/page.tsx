import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('how-ota-works-for-capacitor-apps')!;

export const metadata = blogPostMetadata(post.slug);

export default function HowOtaWorksPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Every Capacitor app is really two things shipped together: a native shell that goes through
        the App Store and Google Play, and a web layer — the HTML, CSS, and JavaScript that make up
        almost everything your users see. Store review moves the shell. Over-the-air (OTA) updates
        move the web layer, directly to installed devices, in minutes instead of days.
      </p>
      <p>
        This post walks through what actually happens between <Code>otakit upload</Code> on your
        machine and a user opening the new version on their phone. None of it is magic, and
        understanding the moving parts makes it much easier to trust OTA in production.
      </p>

      <h2>What moves over the air (and what doesn&apos;t)</h2>
      <p>
        The OTA payload is your built web output — the <Code>dist</Code> or <Code>out</Code> folder
        you&apos;d normally embed in the binary. JavaScript, CSS, HTML, images, fonts, copy, feature
        flags: all of it can ship over the air.
      </p>
      <p>
        What can&apos;t: native code. New Capacitor plugins, changed permissions or entitlements,
        and anything that touches the native project still requires a store release. That&apos;s not
        an OtaKit limitation — it&apos;s the compliance line Apple and Google draw, and it&apos;s
        exactly why OTA for the web layer is{' '}
        <A href="/blog/ota-policies-for-app-store-and-google-play">allowed in the first place</A>.
      </p>

      <Callout>
        <p>
          Mental model: a store release changes the shell. An OTA release changes the web app
          running inside it.
        </p>
      </Callout>

      <h2>Five concepts, one sentence each</h2>
      <ul>
        <li>
          <strong>App</strong> — your Capacitor app, identified by an OtaKit <Code>appId</Code>.
        </li>
        <li>
          <strong>Bundle</strong> — one uploaded web build, with a version, SHA-256 hash, and size.
        </li>
        <li>
          <strong>Release</strong> — the act of making a bundle live for devices.
        </li>
        <li>
          <strong>Channel</strong> — who gets it: production, beta, staging, or any track you name.
        </li>
        <li>
          <strong>Runtime version</strong> — which native shells can safely run it.
        </li>
      </ul>
      <p>
        Channels and runtime versions answer two different questions on purpose. A channel is an
        audience decision (&ldquo;who should see this rollout?&rdquo;). A runtime version is a
        compatibility contract (&ldquo;which store builds can run this bundle without crashing?&rdquo;).
        Keeping them separate is what lets you support several native versions in the wild at once
        without routing rules that nobody on the team can explain.
      </p>

      <h2>The delivery flow, end to end</h2>
      <ol>
        <li>You build your web app as usual.</li>
        <li>
          <Code>otakit upload --release</Code> uploads the build and releases it in one step.
        </li>
        <li>OtaKit publishes a signed manifest for that app + channel + runtime version lane.</li>
        <li>The plugin on each device checks the manifest on launch and on foreground resume.</li>
        <li>If a newer bundle exists, the device downloads it — directly from the CDN edge.</li>
        <li>The download is verified against the SHA-256 hash the signed manifest declares.</li>
        <li>The verified bundle is staged, then activated according to your update policies.</li>
        <li>
          Your app calls <Code>notifyAppReady()</Code> to confirm the new bundle booted. No
          confirmation, no promotion — the device rolls back automatically.
        </li>
      </ol>

      <Pre>{`npm run build
otakit upload --release            # base channel

# or stage it on a test channel first, then promote the same bundle
otakit upload --release staging
otakit release <bundle-id> --channel production`}</Pre>

      <h2>Why the manifest is signed</h2>
      <p>
        A device should never install &ldquo;whatever the server points at.&rdquo; In OtaKit, the
        plugin fetches a manifest for its lane, verifies the manifest&apos;s ES256 signature against
        keys pinned in the app, and only then downloads the bundle — which must match the SHA-256
        hash the manifest declares, byte for byte. A compromised CDN or a man-in-the-middle
        can&apos;t swap in a bundle you didn&apos;t publish.
      </p>
      <p>
        For teams whose bundle contents are themselves sensitive, OtaKit also supports opt-in{' '}
        <strong>end-to-end encryption</strong> (AES-256-GCM with a key only you hold), so storage
        and the CDN only ever see ciphertext. The details are in the{' '}
        <A href="/docs/security">security docs</A>.
      </p>

      <h2>Delta updates: download only what changed</h2>
      <p>
        By default a release ships as a single zip. With the <Code>deltas</Code> strategy, OtaKit
        uploads your build as per-file, content-addressed objects instead — and devices download
        only the files that actually changed between releases. For asset-heavy apps this is the
        difference between re-downloading 50&nbsp;MB of unchanged images and pulling a few hundred
        kilobytes of new JavaScript.
      </p>
      <Pre>{`otakit upload --release --strategy deltas`}</Pre>

      <h2>Safe activation: the part that makes OTA boring</h2>
      <p>
        Getting code onto a device is the easy half. The hard half is making sure a broken release
        can&apos;t strand users on a white screen. OtaKit keeps three bundles on the device —
        current, fallback, and staged — and treats every newly activated bundle as unproven.
      </p>
      <p>
        A fresh bundle starts in a trial state. If your app doesn&apos;t call{' '}
        <Code>notifyAppReady()</Code> within the ready window (10 seconds by default), OtaKit
        assumes startup failed and rolls the device back to the last known-good bundle
        automatically. A bad release degrades into a non-event instead of an incident.
      </p>

      <Callout>
        <p>
          OTA without a health handshake is fast. OTA with one is fast <em>and</em> survivable.
        </p>
      </Callout>

      <h2>When updates apply: policies, not surprises</h2>
      <p>
        OtaKit separates <em>what</em> happens from <em>when</em>. Three settings —{' '}
        <Code>launchPolicy</Code>, <Code>resumePolicy</Code>, and <Code>runtimePolicy</Code> — each
        take one of four values: <Code>off</Code>, <Code>shadow</Code> (download and stage, never
        apply), <Code>apply-staged</Code> (apply whatever is already staged), or{' '}
        <Code>immediate</Code>.
      </p>
      <p>
        The default combination downloads new bundles silently in the background and activates them
        on the next cold start — users just find themselves on the new version. If you want a
        &ldquo;restart to update&rdquo; prompt instead, listen for the <Code>updateStaged</Code>{' '}
        event and call <Code>apply()</Code> on accept. And for emergencies, releasing with{' '}
        <Code>--force-immediate</Code> makes devices apply and reload on their very next check. See{' '}
        <A href="/docs/update-strategies">update strategies</A> for the full decision guide.
      </p>

      <h2>What still requires a store submission</h2>
      <p>
        Adding or removing native plugins, changing permissions or entitlements, upgrading
        Capacitor itself — anything native goes through the store. When such a build ships, bump{' '}
        <Code>runtimeVersion</Code> in the plugin config so the new shell starts its own OTA lane
        and never receives a bundle built for the old one. The OtaKit CLI even checks your
        dependencies at upload time and warns when a bundle depends on native code the installed
        app doesn&apos;t have.
      </p>

      <h2>Where to go next</h2>
      <p>
        The <A href="/docs/setup">setup guide</A> gets a Capacitor app updating over the air in a
        few minutes. If you&apos;re evaluating tools, the{' '}
        <A href="/blog/best-live-update-frameworks-for-capacitor-apps">
          2026 live-update comparison
        </A>{' '}
        covers how OtaKit stacks up against Capgo and Capawesome.
      </p>
    </BlogArticle>
  );
}
