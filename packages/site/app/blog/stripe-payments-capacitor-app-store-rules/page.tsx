import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('stripe-payments-capacitor-app-store-rules')!;

export const metadata = blogPostMetadata(post.slug);

export default function StripeCapacitorPage() {
  return (
    <BlogArticle post={post}>
      <p>
        &ldquo;Can I just use Stripe?&rdquo; is one of the first questions every team asks when
        their web app becomes a Capacitor app. The honest answer in 2026 is: it depends on what you
        sell, and where your users are. The rules moved a lot in the last eighteen months, so here is
        the current picture, followed by a checkout flow that works.
      </p>
      <p>
        This is a practical summary, not legal advice. App Store and Play policies change, and the
        US rules are still in court. Check the current guidelines before you launch a payment
        change.
      </p>

      <h2>The rules at a glance</h2>
      <DataTable
        headers={['What you sell', 'iOS', 'Android (Google Play)']}
        rows={[
          [
            'Physical goods and real-world services (food, rides, tickets, consulting)',
            'Stripe or any processor. In-App Purchase is not used.',
            'Stripe or any processor.',
          ],
          [
            'Digital content and subscriptions, default',
            'In-App Purchase',
            'Google Play Billing',
          ],
          [
            'Digital goods, US storefront',
            'In-App Purchase, plus a link to your own web checkout is allowed',
            'Check Play’s current US programs for alternative billing and external links',
          ],
          [
            'Digital goods, EU storefronts (from 1 October 2026)',
            'In-App Purchase (26%), alternative processor (20%) or web link-out (15%)',
            'Play’s EU alternative billing and external offers programs',
          ],
          [
            'Reader apps (content bought elsewhere: books, music, video)',
            'May link to your website to manage accounts, with Apple’s entitlement',
            'See Play’s policy for the equivalent case',
          ],
        ]}
      />

      <h2>The US: link-outs are allowed</h2>
      <p>
        Since the April 2025 court order in <em>Epic v. Apple</em>, apps on the US storefront can
        include buttons and links that send users to a website to buy digital goods, and Apple may
        not restrict how those links look. As of September 2026, Apple charges no commission on
        those purchases. The Ninth Circuit upheld the contempt finding but said Apple may eventually
        charge a commission tied to its actual costs; the district court is working out that rate,
        and the Supreme Court is set to hear Apple&apos;s appeal this term.
      </p>
      <p>
        In practice: a link-out to Stripe Checkout is allowed on the US storefront today, and the
        economics may change. Build it so the commission is a number you can update, not an
        assumption baked into your pricing.
      </p>

      <h2>The EU: three options, three rates</h2>
      <p>
        From 1 October 2026, Apple&apos;s new EU terms apply: 26% for In-App Purchase, 20% for an
        alternative processor inside the app, 15% for a web link-out, with lower rates for small
        businesses. Users under 13 cannot see web purchase links, and users under 18 need a parental
        gate. Details in{' '}
        <A href="/blog/apple-eu-app-store-changes-october-2026">Apple&apos;s new EU terms</A>.
      </p>

      <h2>A Stripe Checkout flow that returns to the app</h2>
      <p>
        For physical goods, or digital goods where a link-out is allowed, the cleanest setup is
        Stripe Checkout in the system browser. Card details never touch your WebView, Apple Pay and
        Google Pay work inside Checkout, and you do not need a native Stripe SDK.
      </p>
      <p>
        <strong>1. Create the session on your server.</strong> Use a universal link (iOS) or app link
        (Android) as the return URL so the purchase ends back in the app:
      </p>
      <Pre>{`// server
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  line_items: [{ price: 'price_pro_monthly', quantity: 1 }],
  client_reference_id: user.id,
  success_url: 'https://app.example.com/checkout/success?session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'https://app.example.com/checkout/cancel',
});

return { url: session.url };`}</Pre>
      <p>
        <strong>2. Open it from the app</strong> with the Browser plugin, which uses{' '}
        <Code>SFSafariViewController</Code> on iOS and Custom Tabs on Android:
      </p>
      <Pre>{`import { Browser } from '@capacitor/browser';

async function startCheckout() {
  const { url } = await api.post('/billing/checkout');
  await Browser.open({ url });
}`}</Pre>
      <p>
        <strong>3. Handle the return.</strong> When Stripe redirects to your universal link, the OS
        opens your app and fires <Code>appUrlOpen</Code>:
      </p>
      <Pre>{`import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

App.addListener('appUrlOpen', async ({ url }) => {
  const { pathname } = new URL(url);
  if (pathname.startsWith('/checkout/')) {
    await Browser.close();
    await refreshEntitlements();
    router.push(pathname === '/checkout/success' ? '/welcome-pro' : '/pricing');
  }
});`}</Pre>
      <p>
        If you have not set up universal links yet, see{' '}
        <A href="/blog/capacitor-deep-links-universal-links">deep links and universal links</A>.
      </p>
      <p>
        <strong>4. Grant access from the webhook, not the redirect.</strong> The redirect tells you
        the user came back. The <Code>checkout.session.completed</Code> webhook tells you they paid.
        Unlock features on the server when the webhook arrives, and have the app read entitlements
        from your API.
      </p>

      <h2>Show the right option to the right user</h2>
      <p>
        With different rules per country, the app should not hard-code which payment options exist.
        Let the server decide from the user&apos;s storefront and age, and return a list:
      </p>
      <Pre>{`// GET /billing/options
{
  "options": [
    { "type": "iap", "productId": "pro_monthly" },
    { "type": "web", "label": "Pay on our website", "url": "/billing/checkout" }
  ]
}`}</Pre>
      <p>
        When a court ruling or a policy update changes the rules, you update the server, not every
        installed app.
      </p>

      <Callout>
        <p>
          <strong>Where live updates fit:</strong> a new way to pay is something Apple and Google
          expect to review, so ship the first version of any payment flow in a store build. After
          that, the paywall is web code: copy, layout, plan order, how you present annual pricing.
          Those are the changes that move revenue, and you can ship them over the air.
        </p>
      </Callout>

      <h2>Iterate your paywall weekly</h2>
      <p>
        Pricing pages are rarely right the first time. Teams that test often find large gains in
        small details, but a store review for every experiment limits you to a handful per quarter.
      </p>
      <p>
        With <A href="/">OtaKit</A>, paywall changes in a Capacitor app go out the same day. Release
        to a staging channel for your own devices, then to production, or to a subset first with a{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollout</A>. If you use
        In-App Purchase as well, see{' '}
        <A href="/blog/capacitor-in-app-purchases">in-app purchases in Capacitor</A>.
      </p>
    </BlogArticle>
  );
}
