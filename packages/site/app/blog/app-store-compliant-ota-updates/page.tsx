import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('app-store-compliant-ota-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function AppStoreCompliantOtaPage() {
  return (
    <BlogArticle post={post}>
      <p>
        The most common worry about over-the-air updates is also the most misunderstood: &ldquo;will
        Apple reject my app for this?&rdquo; The short answer is no — OTA updates to the web layer of
        a Capacitor app are explicitly allowed by both Apple and Google, and have been for years.
        The longer answer is that there&apos;s a line, it&apos;s clearly drawn, and staying on the
        right side of it is straightforward once you know where it is.
      </p>
      <p>
        This is the practical guide to that line: what the stores actually say, what you can and
        cannot ship over the air, and how to keep your <A href="/">OtaKit</A> setup compliant.
      </p>

      <Callout>
        <p>
          Mental model: a store release changes the native shell. An OTA update changes the web app
          running inside it. Apple and Google care about the shell; the web layer is yours to
          update.
        </p>
      </Callout>

      <h2>What Apple actually says</h2>
      <p>
        The relevant rule is App Store Review Guideline <strong>2.5.2</strong>, which requires that
        apps be self-contained and not download code that changes their features or functionality in
        ways that create a materially different experience from what App Review approved. Crucially,
        it carves out an explicit exception: code executed by Apple&apos;s built-in WebKit or
        JavaScriptCore is fine, as long as it doesn&apos;t provide store, payment, or other native
        capabilities that circumvent review.
      </p>
      <p>
        A Capacitor app&apos;s web layer runs in exactly that WebKit web view. Updating your HTML,
        CSS, and JavaScript over the air is the sanctioned case, not a loophole — the same mechanism
        Ionic&apos;s Appflow, Capgo, Capawesome, and OtaKit all rely on. What you may not do is use
        OTA to add native functionality or fundamentally change what the app is.
      </p>

      <h2>What Google actually says</h2>
      <p>
        Google Play&apos;s Device and Network Abuse policy restricts apps from downloading
        executable code (dex, native code) that changes the app&apos;s behavior in ways that violate
        policy. Interpreted code — JavaScript running in a web view — is not the target. Bug fixes,
        UI changes, and content updates to your web layer are standard practice and stay within
        policy.
      </p>

      <h2>The line, in one table</h2>
      <DataTable
        headers={['Ship over the air', 'Requires a store release']}
        rows={[
          ['HTML / CSS / JavaScript', 'New or updated native plugins'],
          ['UI, layout, copy, content', 'Changed permissions or entitlements'],
          ['Bug fixes in the web layer', 'Capacitor runtime upgrades'],
          ['Feature flags, config, A/B tests', 'Anything touching ios/ or android/'],
          ['Business logic in your JS', 'Native SDKs (payments, auth providers)'],
        ]}
      />

      <h2>Four rules that keep you compliant</h2>
      <ol>
        <li>
          <strong>Never ship native code over the air.</strong> Plugins, permissions, and the
          runtime go through review. OtaKit checks dependencies at upload and warns on mismatches.
        </li>
        <li>
          <strong>Don&apos;t fundamentally change the app.</strong> Update and improve what App
          Review saw; don&apos;t use OTA to turn a notes app into a casino.
        </li>
        <li>
          <strong>Keep payments native.</strong> Don&apos;t use OTA to route around In-App Purchase
          or introduce a payment path review never saw.
        </li>
        <li>
          <strong>Version native compatibility.</strong> Bump <Code>runtimeVersion</Code> on store
          releases so bundles only reach shells that can run them — this keeps behavior consistent
          with what was reviewed.
        </li>
      </ol>

      <Pre>{`# a normal, compliant release: your built web layer, nothing native
npm run build
otakit upload --release`}</Pre>

      <Callout>
        <p>
          If a change would require you to bump <Code>runtimeVersion</Code>, it&apos;s a store
          release — not an OTA update. That single rule keeps almost everyone on the right side of
          the line.
        </p>
      </Callout>

      <h2>Why this is safe to rely on</h2>
      <p>
        OTA for the web layer isn&apos;t a gray-area trick that might stop working — it&apos;s the
        documented, intended behavior of hybrid frameworks, used by thousands of production apps.
        The stores draw the line at native capability precisely because updating interpreted web
        code inside their own web view is something they designed for. Stay in the web layer and
        you&apos;re building on solid ground.
      </p>

      <h2>Where to go next</h2>
      <p>
        For the primary-source deep dive with the exact guideline text, see{' '}
        <A href="/blog/ota-policies-for-app-store-and-google-play">
          are OTA updates allowed? App Store and Google Play rules explained
        </A>
        . Then <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> shows the delivery
        flow end to end.
      </p>
    </BlogArticle>
  );
}
