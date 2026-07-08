import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('migrate-from-app-center-to-otakit')!;

export const metadata = blogPostMetadata(post.slug);

export default function AppCenterMigrationPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Microsoft retired App Center, and with it went the CodePush distribution that a lot of hybrid
        and React Native teams relied on for over-the-air updates. If you were pushing web-layer
        updates through App Center on a Capacitor app, you need a new home for that flow. This guide
        maps App Center&apos;s update model onto <A href="/">OtaKit</A> and gives you a clean cutover.
      </p>

      <Callout>
        <p>
          CodePush itself is open source, but the hosted service that made it convenient is gone.
          Self-hosting a CodePush server is one option; moving to a purpose-built Capacitor OTA
          service is usually less work and less to maintain.
        </p>
      </Callout>

      <h2>What maps cleanly</h2>
      <p>
        App Center&apos;s core concepts translate directly:
      </p>
      <ul>
        <li>
          <strong>Deployment keys</strong> (Staging / Production) become <strong>channels</strong> in
          OtaKit. A channel is the stream of bundles a device checks.
        </li>
        <li>
          <strong>codepush release</strong> becomes an OtaKit CLI release.
        </li>
        <li>
          <strong>Mandatory updates</strong> map to force-immediate releases &mdash; see{' '}
          <A href="/blog/forced-and-mandatory-capacitor-updates">forced and mandatory updates</A>.
        </li>
        <li>
          <strong>Rollback</strong> maps to OtaKit&apos;s automatic rollback plus channel
          roll-forward &mdash; see{' '}
          <A href="/blog/capacitor-ota-rollback-strategies">rollback strategies</A>.
        </li>
      </ul>

      <h2>The release command</h2>
      <p>
        Where you ran a CodePush release against a deployment key, you now build your web app and run:
      </p>
      <Pre>{`otakit upload --release staging
# validate on staging, then promote the same bundle
otakit upload --release production`}</Pre>
      <p>
        The promotion pattern &mdash; release to staging, verify, promote the exact bundle to
        production &mdash; is the same discipline App Center encouraged, and it&apos;s covered in{' '}
        <A href="/blog/automate-channel-promotion-ota">channel promotion</A>.
      </p>

      <h2>Plugin swap</h2>
      <p>
        Remove the CodePush/App Center SDK and install{' '}
        <Code>@otakit/capacitor-plugin</Code>. On the app side, the important call is{' '}
        <Code>notifyAppReady()</Code> after a successful boot &mdash; it&apos;s the signal that arms
        automatic rollback, the equivalent of CodePush&apos;s <Code>notifyApplicationReady</Code>.
      </p>

      <h2>Cutover plan</h2>
      <ol>
        <li>Ship one store release that swaps the SDK to OtaKit. This is the only review you need.</li>
        <li>As users update, their devices start checking OtaKit channels.</li>
        <li>Keep any self-hosted CodePush endpoint alive until the old binaries age out, then retire it.</li>
      </ol>

      <Callout>
        <p>
          One upside of the move: no per-MAU or bandwidth metering. App Center pricing was generous,
          but its replacement market mostly meters usage. OtaKit&apos;s CDN-direct model doesn&apos;t
          &mdash; most apps pay $0&ndash;25/mo regardless of install base.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Start at <A href="/docs/setup">Setup</A> and the <A href="/docs/cli">CLI reference</A>. If
        you&apos;re also replacing App Center&apos;s native cloud builds, our{' '}
        <A href="/blog/github-actions-ios-build-signing">GitHub Actions iOS</A> and{' '}
        <A href="/blog/github-actions-android-build-capacitor">Android</A> guides cover that half.
      </p>
    </BlogArticle>
  );
}
