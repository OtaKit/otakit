import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('codepush-and-expo-updates-alternatives')!;

export const metadata = blogPostMetadata(post.slug);

export default function CodePushAlternativesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        For years, Microsoft CodePush was the default answer to &ldquo;how do I ship a hot fix
        without a store review?&rdquo; It&apos;s now retired. Its natural successor, Expo&apos;s EAS
        Update, is excellent — but it only serves React Native apps. If you&apos;re on Capacitor, or
        you&apos;re choosing a stack and want live updates to be a solved problem, here&apos;s the
        real landscape and how the options compare.
      </p>

      <Callout>
        <p>
          The gap CodePush left: a vendor-neutral, cross-framework way to push web-layer updates
          over the air. For Capacitor apps, that&apos;s exactly what tools like <A href="/">OtaKit</A>{' '}
          exist to fill.
        </p>
      </Callout>

      <h2>What happened to CodePush</h2>
      <p>
        CodePush was folded into Microsoft&apos;s App Center, and App Center&apos;s retirement took
        the standalone CodePush service with it. Microsoft pointed React Native users toward
        Expo&apos;s EAS Update. For teams that had standardized on CodePush — including Cordova and
        older hybrid apps — that meant finding a new home for their update pipeline.
      </p>

      <h2>Why EAS Update isn&apos;t the answer for everyone</h2>
      <p>
        EAS Update is the strong choice <em>if you are building in React Native with Expo</em>. It
        doesn&apos;t serve Capacitor or Cordova apps, and it&apos;s tied to Expo&apos;s build and
        release tooling. If your app is a web app wrapped with Capacitor — as a growing share of
        mobile apps are — you need something built for the web layer.
      </p>

      <h2>The alternatives, compared</h2>
      <DataTable
        headers={['Tool', 'For', 'Notes']}
        rows={[
          ['CodePush', 'React Native / Cordova', 'Retired — no longer an option'],
          ['EAS Update', 'React Native (Expo only)', 'Great, but React Native only'],
          ['OtaKit', 'Capacitor', 'No MAU/bandwidth metering, CDN-direct, delta + E2E encryption, MIT stack'],
          ['Capgo', 'Capacitor', 'Mature; meters monthly active users'],
          ['Capawesome', 'Capacitor', 'Meters monthly active users'],
          ['Appflow', 'Capacitor / Cordova', "Ionic's platform; enterprise pricing"],
        ]}
      />

      <h2>What to look for in a replacement</h2>
      <ul>
        <li>
          <strong>Framework fit.</strong> On Capacitor, pick a Capacitor-native tool — not one
          bolted onto a different runtime.
        </li>
        <li>
          <strong>Safe activation.</strong> Automatic rollback when a bundle fails to boot is
          non-negotiable. OtaKit uses a <Code>notifyAppReady()</Code> handshake and rolls back if it
          never arrives.
        </li>
        <li>
          <strong>Signed, verified delivery.</strong> Bundles should be signed and hash-checked so a
          compromised CDN can&apos;t serve tampered code. See{' '}
          <A href="/blog/capacitor-ota-update-security">OTA security</A>.
        </li>
        <li>
          <strong>Pricing that doesn&apos;t punish growth.</strong> MAU or bandwidth metering means
          your bill scales with success. OtaKit doesn&apos;t meter either.
        </li>
        <li>
          <strong>Efficient updates.</strong> Delta updates matter for asset-heavy apps on mobile
          networks.
        </li>
      </ul>

      <h2>Migrating a Capacitor app to OtaKit</h2>
      <p>
        If you&apos;re moving off a retired or ill-fitting tool, the switch is small: install the
        plugin, set your app id, add the health handshake, and release.
      </p>
      <Pre>{`npm install @otakit/capacitor-updater
npx cap sync

# capacitor.config.ts -> plugins.OtaKit.appId = "YOUR_OTAKIT_APP_ID"

npm install -g @otakit/cli
otakit login
npm run build
otakit upload --release`}</Pre>
      <p>
        Coming from Capgo or Capawesome specifically? The{' '}
        <A href="/blog/migrate-from-capgo-and-capawesome">migration guide</A> has exact config and
        API translations.
      </p>

      <Callout>
        <p>
          CodePush proved teams want to ship fixes in minutes, not days. On Capacitor, that&apos;s
          alive and well — the tooling just moved to where the web layer lives.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> for the mechanics, and
        the <A href="/blog/best-live-update-frameworks-for-capacitor-apps">2026 tool comparison</A>{' '}
        to weigh the Capacitor options side by side.
      </p>
    </BlogArticle>
  );
}
