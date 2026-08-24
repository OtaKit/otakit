import { BlogArticle, Callout, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-live-updates-faq')!;

export const metadata = blogPostMetadata(post.slug);

export default function LiveUpdatesFaqPage() {
  return (
    <BlogArticle post={post}>
      <p>
        These are the questions developers actually ask before adopting Capacitor live updates &mdash;
        answered directly, with links to the full details. If you&apos;re evaluating over-the-air
        updates for a Capacitor app, start here.
      </p>

      <h2>Are live updates allowed by Apple and Google?</h2>
      <p>
        Yes, within limits. Apple&apos;s guideline 2.5.2 permits updating interpreted code (your
        JavaScript) as long as you don&apos;t change the app&apos;s core purpose or download native
        executable code. Google Play similarly allows web-layer updates. See{' '}
        <A href="/blog/does-apple-allow-live-updates">does Apple allow live updates</A>,{' '}
        <A href="/blog/does-google-allow-live-updates">does Google allow live updates</A>, and{' '}
        <A href="/blog/apple-guideline-2-5-2-explained">guideline 2.5.2 explained</A>.
      </p>

      <h2>What can I ship over the air, and what can&apos;t I?</h2>
      <p>
        You can ship anything in the web layer: JS, CSS, HTML, assets, most business logic and UI. You
        cannot ship native code changes &mdash; new plugins, permissions, or SDK bumps still need a
        store build. See{' '}
        <A href="/blog/app-store-compliant-ota-updates">app-store-compliant OTA updates</A>.
      </p>

      <h2>How fast do updates reach users?</h2>
      <p>
        A bundle is available the moment you release it. Devices pick it up on their next check
        (typically next launch), and you can force an immediate apply for urgent fixes. See{' '}
        <A href="/blog/deploy-hotfixes-capacitor-ota">deploy a hotfix in minutes</A> and{' '}
        <A href="/blog/background-vs-foreground-app-updates">update UX options</A>.
      </p>

      <h2>What if an update is broken?</h2>
      <p>
        If a new bundle fails to boot (never calls <code>notifyAppReady()</code>), the device
        automatically rolls back to the last known-good bundle. You can also roll the channel forward to
        a fixed build. See <A href="/blog/capacitor-ota-rollback-strategies">rollback strategies</A>.
      </p>

      <h2>Is it secure?</h2>
      <p>
        Bundles are signed and verified against a SHA-256 manifest before activation, and can be
        end-to-end encrypted. A device won&apos;t run a bundle that doesn&apos;t match what your signing
        key vouched for. See <A href="/blog/capacitor-ota-update-security">OTA update security</A>.
      </p>

      <h2>Can I roll out gradually or to specific users?</h2>
      <p>
        Yes. Use staged rollouts to ramp a release, and channels to target beta groups or tenants. See{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A> and{' '}
        <A href="/blog/target-ota-updates-to-specific-users">targeting users</A>.
      </p>

      <h2>How much does it cost?</h2>
      <p>
        With OtaKit, there&apos;s no MAU or bandwidth metering &mdash; most apps pay $0&ndash;25/mo. That
        differs sharply from tools that meter monthly active users. See{' '}
        <A href="/blog/capgo-alternative">the pricing comparison</A>.
      </p>

      <h2>Do updates work offline?</h2>
      <p>
        The device keeps its current bundle and simply checks for updates when it next has a connection.
        A failed or missing check never breaks the installed app. See{' '}
        <A href="/blog/capacitor-offline-support">offline support</A>.
      </p>

      <h2>Can I self-host?</h2>
      <p>
        Yes &mdash; OtaKit is fully MIT-licensed and self-hostable, with static-CDN delivery that makes
        self-hosting practical. See{' '}
        <A href="/blog/self-hosted-capacitor-live-updates">self-hosted live updates</A>.
      </p>

      <Callout>
        <p>
          Still deciding whether Capacitor + OTA is the right stack at all? Read{' '}
          <A href="/blog/react-native-vs-capacitor">React Native vs Capacitor</A> and{' '}
          <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Ready to try it? Start with <A href="/docs/setup">Setup</A>. Want the operational playbook first?
        See the <A href="/blog/mobile-app-update-strategy-checklist">update strategy checklist</A>.
      </p>
    </BlogArticle>
  );
}
