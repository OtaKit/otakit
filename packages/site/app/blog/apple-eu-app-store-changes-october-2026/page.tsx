import { BlogArticle, Callout, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('apple-eu-app-store-changes-october-2026')!;

export const metadata = blogPostMetadata(post.slug);

export default function AppleEuChangesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        On 18 August, Apple announced a new set of business terms for apps in the European Union,
        agreed with the European Commission. They take effect on <strong>1 October 2026</strong>.
        Every developer distributing in the EU moves onto a single set of terms, the per-install
        Core Technology Fee is gone, and linking out to your own website for purchases gets a
        clearly lower rate.
      </p>
      <p>
        This post covers what changed, what it means for a typical Capacitor or web-based app, and
        what to do before and after 1 October. It is not legal or tax advice; read Apple&apos;s
        updated terms before changing how you charge.
      </p>

      <h2>The new EU rates</h2>
      <p>From Apple&apos;s announcement:</p>
      <DataTable
        headers={['How the user pays', 'Standard rate', 'Reduced rate (eligible programs)']}
        rows={[
          ['App Store app, Apple In-App Purchase', '26%', '15%'],
          ['App Store app, alternative payment processor', '20%', '10%'],
          ['App Store app, link-out to your website', '15%', '10%'],
          [
            'App distributed outside the App Store (alternative marketplace or web)',
            '5% Core Technology Commission',
            '5%',
          ],
        ]}
      />
      <p>
        The reduced rates apply to the Small Business Program and a few partner programs. For In-App
        Purchase, auto-renewing subscriptions also drop to 15% after the first year.
      </p>
      <p>What is removed:</p>
      <ul>
        <li>
          The <strong>Core Technology Fee</strong>, the per-install fee that hit apps with very large
          install counts. It becomes the 5% Core Technology Commission on digital transactions in
          apps distributed outside the App Store.
        </li>
        <li>The Initial Acquisition Fee and the Store Services Fee.</li>
      </ul>
      <p>
        There are also age rules: users under 13 cannot access web purchase links, and users under
        18 must pass a parental gate before alternative payments or web links.
      </p>

      <h2>What it means in practice</h2>
      <p>
        The big shift is that the web link-out is now the cheapest way to take payment inside an
        App Store app in the EU, at 15% versus 26% for In-App Purchase. Before, the stack of fees
        made most alternatives barely worth the engineering. Now the gap is large enough to test.
      </p>
      <p>A few consequences for app teams:</p>
      <ul>
        <li>
          <strong>Subscriptions:</strong> a link-out to a web checkout (for example, Stripe) can
          leave you with meaningfully more revenue per EU subscriber. The trade-off is conversion:
          Apple Pay inside IAP is very low friction, and every extra screen loses buyers.
        </li>
        <li>
          <strong>Alternative distribution</strong> is simpler to evaluate, with one 5% commission
          instead of a per-install fee. For most consumer apps, the App Store&apos;s reach still
          wins.
        </li>
        <li>
          <strong>Physical goods and services</strong> are unaffected. They never used In-App
          Purchase.
        </li>
      </ul>

      <h2>What to do as a Capacitor team</h2>
      <ol>
        <li>
          <strong>Accept the updated agreement.</strong> Apple published an updated Developer Program
          License Agreement with Attachment 14 for EU terms. Sign in to App Store Connect and accept
          it.
        </li>
        <li>
          <strong>Model the numbers per storefront.</strong> Compare 26% IAP against 15% link-out
          plus your payment processor&apos;s fee, and against a realistic drop in conversion. Test,
          do not assume.
        </li>
        <li>
          <strong>Build the link-out as a native-reviewed flow.</strong> The link-out entitlement,
          the external purchase screen and the parental gate are part of what App Review looks at.
          Ship the first version in a store build.
        </li>
        <li>
          <strong>Show it only where it applies.</strong> Decide per storefront and per user age.
          Your server should decide who sees which option, so you can change it without shipping
          code.
        </li>
      </ol>

      <Callout>
        <p>
          <strong>Where live updates fit, and where they do not.</strong> Adding a new way to pay is
          the kind of change Apple expects to review, so do not introduce it through an over-the-air
          update. Once the flow is approved, paywall copy, layout, plan cards and pricing display
          are ordinary web changes, and iterating on them quickly is where most of the revenue
          gains come from.
        </p>
      </Callout>

      <h2>Iterate the paywall, not the binary</h2>
      <p>
        Most of the money in a pricing change is in the details: which plan is highlighted, how the
        annual discount is shown, where the web option sits, what the copy says. Each of those is a
        small web change. Waiting days for review to test each one means you run a handful of
        experiments a quarter.
      </p>
      <p>
        With <A href="/">OtaKit</A>, a Capacitor app gets those changes the same day. Release to a
        staging channel, check on your own devices, then release to production, or to a slice of
        users first with a{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollout</A>. If a variant
        underperforms, roll back. For the rules on what can change over the air, see{' '}
        <A href="/blog/apple-guideline-2-5-2-explained">Apple guideline 2.5.2 explained</A>.
      </p>
      <p>
        The US has its own, separate situation after the Epic ruling. We cover both markets, and how
        to wire Stripe into a Capacitor app, in{' '}
        <A href="/blog/stripe-payments-capacitor-app-store-rules">
          can a Capacitor app use Stripe?
        </A>
      </p>
    </BlogArticle>
  );
}
