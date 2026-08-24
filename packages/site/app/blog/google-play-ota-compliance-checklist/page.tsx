import { BlogArticle, Callout, Code, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('google-play-ota-compliance-checklist')!;

export const metadata = blogPostMetadata(post.slug);

export default function GooglePlayCompliancePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Apple&apos;s OTA rules get most of the attention, but Google Play has its own policy on
        downloading code &mdash; and Capacitor apps need to respect it too. The good news: like
        Apple, Google&apos;s restriction targets native/executable code, not the interpreted
        JavaScript your web layer is made of. Here&apos;s what the policy actually says and a
        checklist to keep your <A href="/">OtaKit</A> setup compliant.
      </p>

      <Callout>
        <p>
          Short version: Google Play restricts downloading executable code (like dex or native
          libraries) that changes app behavior in policy-violating ways. Updating your web layer over
          the air is standard practice and stays within policy.
        </p>
      </Callout>

      <h2>What the policy restricts</h2>
      <p>
        Google Play&apos;s Device and Network Abuse policy prohibits apps from introducing or
        exploiting code that isn&apos;t part of the app to evade Play&apos;s policies &mdash; the
        concern is native/executable code (DEX, .so libraries) downloaded at runtime to change what
        the app does. That&apos;s the abuse vector the policy is written against.
      </p>
      <p>
        Interpreted code executed in a web view &mdash; your HTML, CSS, and JavaScript &mdash; is a
        different category and is how hybrid apps have always worked. Shipping bug fixes, UI changes,
        and content to your web layer over the air is well within policy.
      </p>

      <h2>The compliance checklist</h2>
      <ul>
        <li>
          <strong>Web layer only.</strong> OTA updates carry your web build. Never download and
          execute native code (DEX, native libraries) to change behavior.
        </li>
        <li>
          <strong>Native changes go through Play.</strong> New permissions, native SDKs, or
          Capacitor/plugin upgrades ship as a Play release &mdash; not OTA.
        </li>
        <li>
          <strong>Don&apos;t change the app&apos;s core purpose via OTA.</strong> Update and improve
          the reviewed app; don&apos;t repurpose it after approval.
        </li>
        <li>
          <strong>Respect data-safety declarations.</strong> If an OTA update changes what data you
          collect, update your Play Data safety form accordingly.
        </li>
        <li>
          <strong>Keep the update path secure.</strong> Signed, hash-verified bundles over HTTPS
          &mdash; a tampered update is both a security and a policy problem. See{' '}
          <A href="/blog/capacitor-ota-update-security">OTA security</A>.
        </li>
      </ul>

      <h2>How OtaKit helps you stay compliant</h2>
      <p>
        OtaKit ships only your web build and checks the bundle&apos;s dependencies at upload time,
        warning when it detects native code the installed shell doesn&apos;t have. The{' '}
        <Code>runtimeVersion</Code> mechanism keeps bundles matched to compatible shells, so a device
        never runs a web layer that expects native capabilities it doesn&apos;t have.
      </p>

      <Callout>
        <p>
          The through-line across both stores: interpreted web-layer updates are fine; downloading
          native executable code to change behavior is not. Stay in the web layer.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/apple-guideline-2-5-2-explained">Apple guideline 2.5.2 explained</A> for
        the iOS side, and{' '}
        <A href="/blog/app-store-compliant-ota-updates">the complete compliant-OTA guide</A> for both
        stores together.
      </p>
    </BlogArticle>
  );
}
