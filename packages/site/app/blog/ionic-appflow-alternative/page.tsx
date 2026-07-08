import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('ionic-appflow-alternative')!;

export const metadata = blogPostMetadata(post.slug);

export default function AppflowAlternativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        If you&apos;re paying for Ionic Appflow mainly to get live updates, there&apos;s a leaner,
        cheaper way to do exactly that. <A href="/">OtaKit</A> delivers the same capability &mdash;
        signed, rollback-safe over-the-air updates for Capacitor apps &mdash; without the platform
        subscription, and with an open-source stack you can self-host. This guide covers why teams
        switch and how the migration works.
      </p>

      <Callout>
        <p>
          You don&apos;t lose the feature you rely on. You drop the platform overhead around it.
        </p>
      </Callout>

      <h2>Why teams move off Appflow for live updates</h2>
      <ul>
        <li>
          <strong>Pricing.</strong> Appflow is a tiered platform subscription. OtaKit doesn&apos;t
          meter monthly active users or bandwidth, so most apps land in the $0&ndash;25/mo range and
          the cost doesn&apos;t climb with your install base.
        </li>
        <li>
          <strong>You already have CI.</strong> If your builds run in GitHub Actions or GitLab, the
          platform&apos;s build service is a feature you&apos;re paying for but not using.
        </li>
        <li>
          <strong>No lock-in.</strong> OtaKit&apos;s stack is MIT-licensed and self-hostable &mdash;
          you can run the whole thing yourself if you want.
        </li>
        <li>
          <strong>Modern delivery.</strong> CDN-direct downloads, delta updates, and end-to-end
          encryption with a key only you hold.
        </li>
      </ul>

      <h2>What you keep</h2>
      <p>
        Everything that matters about live updates: releasing to channels, automatic rollback when a
        bundle fails to boot, runtime-version compatibility so bundles only reach shells that can run
        them, and signed, hash-verified delivery. See{' '}
        <A href="/blog/capacitor-ota-update-security">OTA security</A> and{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>.
      </p>

      <h2>Migrating is a small change</h2>
      <p>
        Because your app is already a Capacitor app, switching the live-update layer is mostly a
        plugin swap:
      </p>
      <Pre>{`# remove the Appflow live-update plugin, then:
npm install @otakit/capacitor-updater
npx cap sync`}</Pre>
      <Pre>{`// capacitor.config.ts
plugins: {
  OtaKit: { appId: "YOUR_OTAKIT_APP_ID" },
}`}</Pre>
      <p>
        Add the <Code>notifyAppReady()</Code> handshake, install the CLI, and release:
      </p>
      <Pre>{`npm install -g @otakit/cli
otakit login
npm run build
otakit upload --release`}</Pre>
      <p>
        Cut over gradually if you like &mdash; ship an OTA store build with OtaKit configured, let it
        roll out, then decommission Appflow live updates once the new shell is in the wild.
      </p>

      <Callout>
        <p>
          If you use Appflow for native cloud builds too, you can keep those and just move live
          updates to OtaKit &mdash; or replace the builds with{' '}
          <A href="/blog/github-actions-ios-build-signing">CI you control</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See the head-to-head in{' '}
        <A href="/blog/capacitor-vs-appflow">Capacitor + OtaKit vs Appflow</A>, and{' '}
        <A href="/blog/ionic-live-updates-with-capacitor">live updates for Ionic apps</A> for the
        full setup.
      </p>
    </BlogArticle>
  );
}
