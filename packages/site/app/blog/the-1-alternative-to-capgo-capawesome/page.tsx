import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('the-1-alternative-to-capgo-capawesome')!;

export const metadata = blogPostMetadata(post.slug);

export default function AlternativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        If you&apos;re searching for a Capgo alternative or a Capawesome alternative, you probably
        already know what live updates are — what you&apos;re really asking is whether there&apos;s
        a tool with simpler pricing, less product sprawl, or fewer strings attached. That&apos;s
        exactly the gap OtaKit was built to fill, and this post makes the case with specifics
        rather than adjectives.
      </p>

      <h2>The three reasons teams switch</h2>

      <h3>1. Pricing that ignores MAU entirely</h3>
      <p>
        Capgo and Capawesome both meter monthly active users: as of July 2026, Capgo&apos;s entry
        tier is $12/mo for 2,000 MAU (plus bandwidth and storage), and Capawesome&apos;s is $9/mo
        for 1,000 MAU. Grow your user base and the bill grows with it — even in months where you
        ship nothing.
      </p>
      <p>
        OtaKit bills on one number: <strong>updates delivered</strong>. The free tier covers 10,000
        updates a month with unlimited apps and releases; Pro is $25/mo for a million. Your cost
        tracks your release activity, not your popularity. A 100,000-user app that ships twice a
        month often lands entirely inside the free tier of what would cost real money elsewhere.
      </p>

      <h3>2. Devices never touch our servers</h3>
      <p>
        OtaKit delivers every manifest and bundle from Cloudflare&apos;s edge — 100% of device
        traffic goes CDN-direct. That has a reliability consequence (delivery uptime is
        Cloudflare&apos;s, one of the most resilient networks on earth, not a vendor origin&apos;s)
        and a privacy one: because we don&apos;t meter MAU, we don&apos;t identify devices. No
        fingerprinting, no per-user tracking — just anonymous release analytics.
      </p>

      <h3>3. Open source without an asterisk</h3>
      <p>
        The entire OtaKit stack — Capacitor plugin, CLI, dashboard, ingest service — is
        MIT-licensed in <A href="https://github.com/OtaKit/otakit">a single repo</A>, and the
        self-hosted deployment runs the same code as the hosted platform. Capawesome open-sources
        the plugin but not the cloud; Capgo&apos;s stack is source-available with licensing terms
        worth reading before you depend on them. With OtaKit, leaving the hosted service is an
        infrastructure decision, not a rewrite.
      </p>

      <h2>Feature parity where it counts</h2>
      <p>
        Choosing the simpler tool used to mean giving up features. It doesn&apos;t anymore — the
        capabilities that actually matter in production are all here:
      </p>
      <ul>
        <li>
          <strong>Delta updates</strong> — devices download only the files that changed between
          releases (per-file, content-addressed). Asset-heavy apps update in kilobytes.
        </li>
        <li>
          <strong>End-to-end encryption</strong> — opt-in AES-256-GCM with a key only you hold;
          storage and the CDN only ever see ciphertext.
        </li>
        <li>
          <strong>Automatic rollback</strong> — a bundle that doesn&apos;t confirm a healthy boot
          via <Code>notifyAppReady()</Code> is rolled back on-device, automatically.
        </li>
        <li>
          <strong>Channels with runtime switching</strong> — release to production, beta, or your
          own tracks, and build a &ldquo;join the beta&rdquo; toggle with{' '}
          <Code>setChannel()</Code>, no rebuild needed.
        </li>
        <li>
          <strong>Emergency releases</strong> — <Code>--force-immediate</Code> makes devices apply
          a critical fix on their very next check instead of the next cold start.
        </li>
        <li>
          <strong>Native-compatibility guardrail</strong> — the CLI warns at upload time when your
          bundle depends on native code the installed app doesn&apos;t have, catching the most
          common OTA mistake before it ships.
        </li>
        <li>
          <strong>Update lifecycle events</strong> — build a custom update UX on{' '}
          <Code>updateAvailable</Code>, <Code>updateStaged</Code>, <Code>updateApplied</Code>, and{' '}
          <Code>rollback</Code> listeners.
        </li>
      </ul>

      <h2>What OtaKit deliberately isn&apos;t</h2>
      <p>
        Honesty clause: Capgo and Capawesome both also sell hosted native builds and app store
        publishing. OtaKit doesn&apos;t — it does OTA, and only OTA. If you want one vendor for
        your entire mobile pipeline, that&apos;s a legitimate reason to pick one of them. If you
        want the best focused tool for live updates and you already have CI, that&apos;s the case
        for OtaKit.
      </p>

      <Callout>
        <p>
          OtaKit is the right alternative when you want to pay for updates delivered, keep your
          users untracked, and be able to read — or run — every line of the stack yourself.
        </p>
      </Callout>

      <h2>Try it in ten minutes</h2>
      <p>The whole setup is four steps:</p>
      <Pre>{`npm install @otakit/capacitor-updater
# add appId to capacitor.config.ts, call notifyAppReady() on boot

npm run build
otakit upload --release`}</Pre>
      <p>
        Start with the <A href="/docs/setup">setup guide</A>, see the full picture in the{' '}
        <A href="/blog/best-live-update-frameworks-for-capacitor-apps">
          side-by-side comparison
        </A>
        , or — if you&apos;re already running Capgo or Capawesome in production — go straight to
        the <A href="/blog/migrate-from-capgo-and-capawesome">migration guide</A> with exact config
        translations and a safe cutover plan.
      </p>
    </BlogArticle>
  );
}
