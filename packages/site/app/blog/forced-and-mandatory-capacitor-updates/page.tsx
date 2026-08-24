import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('forced-and-mandatory-capacitor-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function ForcedUpdatesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Most over-the-air updates can wait for the next cold start &mdash; the user closes the app,
        reopens it later, and quietly gets the new version. But some updates can&apos;t wait: a
        security fix, a broken payment flow, a change your backend now requires. For those you need a
        forced, immediate update. This guide covers how to do that with <A href="/">OtaKit</A>{' '}
        without being heavy-handed.
      </p>

      <Callout>
        <p>
          Mental model: the default is patient (apply on next launch). A forced update is the
          exception you reach for when &ldquo;later&rdquo; isn&apos;t acceptable.
        </p>
      </Callout>

      <h2>The two levers: policy and force-immediate</h2>
      <p>
        OtaKit separates <em>what</em> happens from <em>when</em>. Update policies (
        <Code>launchPolicy</Code>, <Code>resumePolicy</Code>, <Code>runtimePolicy</Code>) control the
        normal cadence &mdash; download in the background, apply on next start. For an urgent
        release, you override that at release time.
      </p>

      <h2>Ship an immediate update</h2>
      <p>
        Releasing with <Code>--force-immediate</Code> tells devices to apply and reload the new
        bundle on their very next check, instead of waiting for a cold start:
      </p>
      <Pre>{`npm run build
otakit upload --release --force-immediate`}</Pre>
      <p>
        Use this sparingly. An immediate reload interrupts whatever the user is doing, so reserve it
        for genuine emergencies &mdash; not routine releases. For everything else, the default
        background-then-next-launch behavior is a better experience.
      </p>

      <h2>Build a &ldquo;mandatory update&rdquo; gate yourself</h2>
      <p>
        Sometimes you want the app to <em>block</em> until it&apos;s on a minimum version &mdash; for
        example when the API contract changed. You can implement this in your own code by listening
        for update events and gating the UI until the required bundle is active:
      </p>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";

// download and apply the staged update, then reload
OtaKit.addListener("updateStaged", async () => {
  await OtaKit.apply(); // reloads into the new bundle
});`}</Pre>
      <p>
        Pair that with a version check against your backend: if the device is below the minimum
        supported version, show a blocking &ldquo;updating&rdquo; screen until the new bundle
        applies. See the <A href="/docs/events">events docs</A> for the full listener surface.
      </p>

      <h2>Don&apos;t forget: OTA can&apos;t force native updates</h2>
      <p>
        A forced OTA update only moves the web layer. If the thing that must change is native &mdash;
        a plugin, a permission, the Capacitor runtime &mdash; no OTA flag can deliver it; that&apos;s
        a store release. For those, the &ldquo;mandatory update&rdquo; you build should point users
        to the store. Know the line: see{' '}
        <A href="/blog/app-store-compliant-ota-updates">what OTA can and can&apos;t change</A>.
      </p>

      <Callout>
        <p>
          Rule of thumb: background updates by default, <Code>--force-immediate</Code> for
          emergencies, and a self-built version gate only when the app genuinely can&apos;t function
          on an old bundle.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/background-vs-foreground-app-updates">background vs foreground update
        UX</A> for the everyday case, and{' '}
        <A href="/docs/update-strategies">update strategies</A> for the full policy matrix.
      </p>
    </BlogArticle>
  );
}
