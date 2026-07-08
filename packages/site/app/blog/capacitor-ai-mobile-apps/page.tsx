import { BlogArticle, Callout, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-ai-mobile-apps')!;

export const metadata = blogPostMetadata(post.slug);

export default function AiMobileAppsPage() {
  return (
    <BlogArticle post={post}>
      <p>
        AI apps have a property most apps don&apos;t: they change constantly. Models get swapped, prompts
        get tuned, the UX around a feature evolves weekly as you learn what works. A two-week store review
        cycle is a terrible fit for that pace. This is the case for building AI mobile apps on Capacitor
        plus over-the-air updates &mdash; and why that combination ships faster than the alternatives.
      </p>

      <Callout>
        <p>
          The insight: almost everything you iterate on in an AI app &mdash; prompts, model routing, the
          chat UI, result formatting &mdash; lives in the web layer. That&apos;s exactly what OTA updates
          ship without a store review.
        </p>
      </Callout>

      <h2>Why Capacitor for AI apps</h2>
      <ul>
        <li>
          <strong>One web codebase, both platforms.</strong> Build your AI UX once in your web stack; ship
          iOS and Android from it.
        </li>
        <li>
          <strong>The web ecosystem.</strong> The best AI SDKs, streaming UIs, and markdown/chat components
          are web-first. Capacitor lets you use them directly.
        </li>
        <li>
          <strong>Fast iteration.</strong> No native rebuild to change a prompt or a component.
        </li>
      </ul>

      <h2>Why OTA is the multiplier</h2>
      <p>
        A model provider ships a better model on Tuesday. You want your app using it Tuesday, not in the
        next release two weeks out. With OTA you tune the prompt or swap the model reference and push it:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>
      <p>
        The same applies to killing a bad prompt that&apos;s producing weird outputs &mdash; that&apos;s a
        hotfix, not a release. See <A href="/blog/deploy-hotfixes-capacitor-ota">deploy a hotfix in
        minutes</A>.
      </p>

      <h2>Experiment relentlessly</h2>
      <p>
        AI UX is won by iteration: which prompt, which framing, which model, which UI. OTA turns each of
        those into a same-day experiment rather than a release. See{' '}
        <A href="/blog/ab-testing-capacitor-live-updates">A/B testing with live updates</A> and{' '}
        <A href="/blog/feature-flags-in-capacitor-apps">feature flags</A>.
      </p>

      <h2>Keep secrets on the server</h2>
      <p>
        One caution: don&apos;t ship API keys in the bundle. Proxy model calls through your backend so keys
        stay server-side &mdash; OTA ships the client, not your secrets. Store any user tokens in the
        keystore &mdash; see <A href="/blog/secure-token-storage-capacitor">secure token storage</A>.
      </p>

      <Callout>
        <p>
          Built your AI app with an AI builder? Get it native the same way &mdash; see{' '}
          <A href="/blog/bolt-app-to-ios-android-with-capacitor">Bolt.new</A>,{' '}
          <A href="/blog/lovable-app-to-ios-android-with-capacitor">Lovable</A>, and{' '}
          <A href="/blog/base44-app-to-ios-android-with-capacitor">Base44</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Start with <A href="/docs/setup">Setup</A> and{' '}
        <A href="/blog/react-to-ios-android-with-capacitor">the React guide</A> to get your AI app native.
      </p>
    </BlogArticle>
  );
}
