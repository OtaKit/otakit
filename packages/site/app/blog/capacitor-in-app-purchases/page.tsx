import { BlogArticle, Callout, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-in-app-purchases')!;

export const metadata = blogPostMetadata(post.slug);

export default function InAppPurchasesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        If your Capacitor app sells digital goods or subscriptions, Apple and Google require you to use
        their in-app purchase systems &mdash; StoreKit and Google Play Billing &mdash; and take their cut.
        Getting IAP right is part native integration, part store-compliance, and part relentless paywall
        iteration. This guide covers all three, and where <A href="/">OtaKit</A> lets you optimize the
        revenue-critical parts without a store review.
      </p>

      <Callout>
        <p>
          The compliance line: digital goods consumed in the app must go through IAP. Physical goods and
          real-world services use normal payment processors. Getting this wrong is a guaranteed rejection.
        </p>
      </Callout>

      <h2>1. Use a maintained IAP plugin</h2>
      <p>
        Don&apos;t hand-roll StoreKit and Billing bindings. Use a Capacitor IAP plugin that wraps both,
        handles the purchase lifecycle, and surfaces receipts:
      </p>
      <Pre>{`npx cap sync`}</Pre>

      <h2>2. Configure products in the stores</h2>
      <ul>
        <li>Define products/subscriptions in App Store Connect and Google Play Console.</li>
        <li>Match the product IDs exactly in your app config.</li>
        <li>Set up sandbox/test accounts &mdash; you can&apos;t test real purchases against production.</li>
      </ul>

      <h2>3. Verify receipts server-side</h2>
      <p>
        Never grant entitlements based on the client alone. Validate the receipt with Apple/Google from
        your backend, then unlock the feature. This is the difference between a paywall and a suggestion.
      </p>

      <h2>4. Iterate the paywall over the air</h2>
      <p>
        The <em>native</em> purchase mechanism is fixed once shipped, but the <strong>paywall</strong>
        &mdash; layout, copy, pricing display, which plan is highlighted, the trial framing &mdash; is
        web-layer UI, and it&apos;s the single highest-leverage thing to A/B test. Ship variants over the
        air and measure:
      </p>
      <Pre>{`otakit upload --release experiment-paywall-b`}</Pre>
      <p>
        Combine with <A href="/blog/ab-testing-capacitor-live-updates">A/B testing</A> to find the paywall
        that converts, then promote it &mdash; no store cycle per iteration.
      </p>

      <Callout>
        <p>
          Being able to tune pricing presentation and paywall copy the same day, instead of every two
          weeks, compounds fast on revenue. This is one of the strongest business cases for OTA in a paid
          app.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/first-app-store-review-guide">passing app review</A> for the IAP compliance
        pitfalls, and <A href="/blog/feature-flags-in-capacitor-apps">feature flags</A> to gate premium
        features.
      </p>
    </BlogArticle>
  );
}
