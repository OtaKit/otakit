import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('ionic-appflow-is-shutting-down')!;

export const metadata = blogPostMetadata(post.slug);

export default function AppflowShutdownPage() {
  return (
    <BlogArticle post={post}>
      <p>
        If you shipped Capacitor or Ionic apps through Ionic Appflow, the wind-down puts your two
        most operationally important features on the clock: <strong>Live Updates</strong> and
        <strong> native cloud builds</strong>. The good news is that neither is hard to replace, and
        the live-update half in particular maps almost one-to-one onto <A href="/">OtaKit</A>. This
        guide covers what actually changes, what you need to move, and a safe cutover plan.
      </p>

      <Callout>
        <p>
          The urgent part is Live Updates. A retired backend eventually stops serving update
          manifests, and a device that can&apos;t reach its update server just keeps running the last
          bundle it has. Migrate the update channel first; move the CI builds at your own pace.
        </p>
      </Callout>

      <h2>What you actually lose</h2>
      <p>
        Appflow bundled several things under one subscription. When you unbundle them, most have
        clean, cheaper replacements:
      </p>
      <ul>
        <li>
          <strong>Live Updates</strong> &mdash; over-the-air web-layer updates. This is the piece
          that needs a live server, so it&apos;s the one to move first.
        </li>
        <li>
          <strong>Native cloud builds</strong> (iOS/Android) &mdash; replaceable with GitHub Actions,
          GitLab CI, Codemagic, or Xcode Cloud. See our{' '}
          <A href="/blog/github-actions-ios-build-signing">iOS build in GitHub Actions</A> and{' '}
          <A href="/blog/github-actions-android-build-capacitor">Android build</A> guides.
        </li>
        <li>
          <strong>Automations</strong> &mdash; the deploy-to-channel step becomes one CLI call in
          your own pipeline.
        </li>
      </ul>

      <h2>Why not just move to another platform-priced tool</h2>
      <p>
        Appflow&apos;s pricing is exactly why teams are looking to leave rather than renew: live
        updates were tied into a broad, seat-and-tier platform. OtaKit takes the opposite approach
        &mdash; no MAU metering, no bandwidth metering, CDN-direct delivery from a static signed
        manifest, and a fully MIT-licensed stack you can self-host. Most apps land in the $0&ndash;25/mo
        range. We break down the head-to-head in{' '}
        <A href="/blog/capacitor-vs-appflow">Capacitor + OtaKit vs Appflow</A>.
      </p>

      <h2>Migrating Live Updates to OtaKit</h2>
      <p>
        Appflow&apos;s live update model and OtaKit&apos;s are conceptually the same: a channel maps
        to a stream of web-build bundles that devices check for on launch. The move is mechanical:
      </p>
      <ol>
        <li>
          Swap the plugin. Remove the Appflow live-update dependency and install{' '}
          <Code>@otakit/capacitor-plugin</Code>. Point config at your OtaKit app and channel.
        </li>
        <li>
          Wire a release step. Where Appflow ran a deploy automation, run the OtaKit CLI:
          <Pre>{`otakit upload --release production`}</Pre>
        </li>
        <li>
          Keep <Code>notifyAppReady()</Code>. If you were calling Appflow&apos;s ready signal after a
          successful boot, the OtaKit equivalent plays the same role &mdash; it&apos;s what arms
          automatic rollback.
        </li>
      </ol>
      <p>
        The full config and API translation lives in our{' '}
        <A href="/blog/migrate-from-capgo-and-capawesome">migration guide</A>, and the general
        Appflow replacement rundown is in{' '}
        <A href="/blog/ionic-appflow-alternative">the best Appflow alternative</A>.
      </p>

      <h2>A safe cutover plan for your install base</h2>
      <p>
        Devices in the wild are still pointed at Appflow. Cut over without stranding anyone:
      </p>
      <ol>
        <li>
          Ship one <strong>store release</strong> that swaps the live-update plugin to OtaKit. This
          is the only step that requires a review, because it changes native dependencies.
        </li>
        <li>
          As users update through the store, their devices start checking OtaKit instead. From then
          on every web-layer change ships over the air again.
        </li>
        <li>
          Keep Appflow live until the tail of your install base has moved to the new binary, then
          let it lapse.
        </li>
      </ol>

      <Callout>
        <p>
          Because the plugin swap is a native change, plan it like any store release &mdash; and use
          it as the last one you&apos;ll need to wait on for a while. After it lands, OtaKit ships the
          web layer without another review.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Start with <A href="/docs/setup">Setup</A>, then the{' '}
        <A href="/docs/cli">CLI reference</A> for the release command. If you want the honest
        feature-by-feature comparison first, read{' '}
        <A href="/blog/best-ota-tools-for-capacitor-2026">the best OTA tools for Capacitor</A>.
      </p>
    </BlogArticle>
  );
}
