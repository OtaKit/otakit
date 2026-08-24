import { BlogArticle, Callout, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('first-app-store-review-guide')!;

export const metadata = blogPostMetadata(post.slug);

export default function FirstReviewGuidePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Your first submission to the App Store or Google Play is where a lot of projects stall &mdash;
        usually on avoidable things. Review isn&apos;t out to get you, but it is consistent about a
        handful of issues. This guide covers the common rejection reasons, a pre-submission checklist
        for Capacitor apps, and how over-the-air updates take the pressure off getting everything
        perfect on day one.
      </p>

      <Callout>
        <p>
          Mental model: get the app approved once, cleanly. After that, most fixes and improvements
          ship over the air &mdash; you rarely wait on review again.
        </p>
      </Callout>

      <h2>The usual rejection reasons</h2>
      <ul>
        <li>
          <strong>Incomplete or broken app.</strong> Placeholder screens, dead buttons, obvious bugs.
          Reviewers open everything.
        </li>
        <li>
          <strong>Crashes on launch.</strong> Test on a real device, on the OS versions you claim to
          support &mdash; not just the simulator.
        </li>
        <li>
          <strong>Privacy gaps.</strong> Missing privacy policy, inaccurate data-safety labels, or a
          missing <A href="/blog/ios-privacy-manifest-for-capacitor">iOS privacy manifest</A>.
        </li>
        <li>
          <strong>Login walls without a demo account.</strong> If the app requires sign-in, provide
          working review credentials.
        </li>
        <li>
          <strong>Permissions without justification.</strong> Every permission needs a clear reason
          string and an in-app purpose the reviewer can see.
        </li>
        <li>
          <strong>Payments outside the rules.</strong> Digital goods generally must use In-App
          Purchase / Play Billing.
        </li>
      </ul>

      <h2>Pre-submission checklist for Capacitor apps</h2>
      <ul>
        <li>Run the release build on a real iOS and Android device, not just simulators.</li>
        <li>Confirm every core flow works offline-to-online and handles network failure gracefully.</li>
        <li>Fill in accurate store metadata, screenshots, and a reachable privacy policy URL.</li>
        <li>
          Provide demo credentials and any &ldquo;how to test&rdquo; notes reviewers need in the
          review information field.
        </li>
        <li>
          Add the iOS privacy manifest and make sure plugins/SDKs are current so their manifests are
          included.
        </li>
        <li>Set correct age ratings and permission usage descriptions.</li>
        <li>Verify the app does what the listing says &mdash; no more, no less.</li>
      </ul>

      <h2>How OTA changes the stakes</h2>
      <p>
        The reason a first review feels high-stakes is that a native release cycle is slow &mdash; a
        rejection or a post-launch bug means days of waiting. With OTA in place, that&apos;s only true
        for native changes. Once your Capacitor app is approved with an OTA plugin like{' '}
        <A href="/">OtaKit</A> configured, you can fix the web-layer issues that inevitably surface
        after launch and ship them the same day &mdash; no resubmission.
      </p>
      <p>
        That said, don&apos;t use OTA as a crutch to submit an unfinished app. Review expects a
        complete app; OTA is for iterating on it. See{' '}
        <A href="/blog/app-store-compliant-ota-updates">what OTA can and can&apos;t change</A>.
      </p>

      <Callout>
        <p>
          Submit a complete, tested app; then let OTA absorb the long tail of post-launch fixes. That
          combination is what makes shipping on mobile feel fast.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Read the <A href="/blog/ios-privacy-manifest-for-capacitor">iOS privacy manifest guide</A>{' '}
        and <A href="/blog/apple-guideline-2-5-2-explained">Apple guideline 2.5.2</A>, then get OTA
        set up with the <A href="/docs/setup">setup guide</A>.
      </p>
    </BlogArticle>
  );
}
