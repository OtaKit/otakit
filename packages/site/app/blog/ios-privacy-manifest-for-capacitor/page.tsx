import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('ios-privacy-manifest-for-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function PrivacyManifestPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Apple now requires a privacy manifest for App Store submissions, and it&apos;s a common
        source of surprise rejections for Capacitor apps. The manifest declares what data your app
        collects and why it uses certain sensitive APIs. This guide explains what a Capacitor app
        needs, how plugins factor in, and the mistakes that get submissions bounced.
      </p>

      <Callout>
        <p>
          Mental model: the privacy manifest is a native, store-time declaration &mdash; it&apos;s
          part of the binary you submit, not something you change over the air.
        </p>
      </Callout>

      <h2>What the privacy manifest is</h2>
      <p>
        A <Code>PrivacyInfo.xcprivacy</Code> file that ships inside your app (and inside SDKs it
        uses). It declares two main things: the data types your app collects, and the reasons it
        calls certain &ldquo;required reason&rdquo; APIs &mdash; APIs Apple has flagged because they
        can be misused for fingerprinting (file timestamps, disk space, system boot time,{' '}
        <Code>UserDefaults</Code>, and a few others).
      </p>

      <h2>What a Capacitor app needs to check</h2>
      <ul>
        <li>
          <strong>Your app&apos;s own manifest.</strong> Add a <Code>PrivacyInfo.xcprivacy</Code> to
          the iOS project declaring the data you collect and required-reason APIs you use.
        </li>
        <li>
          <strong>Plugin manifests.</strong> Capacitor plugins that touch sensitive APIs should ship
          their own privacy manifests. Keep plugins updated &mdash; maintained plugins add these as
          Apple&apos;s requirements tighten.
        </li>
        <li>
          <strong>Third-party SDK manifests.</strong> Analytics, ads, and similar SDKs each need
          their manifest; Apple aggregates them into your app&apos;s privacy report.
        </li>
      </ul>

      <h2>A minimal example</h2>
      <p>
        A required-reason declaration for <Code>UserDefaults</Code> (commonly used for app settings)
        looks like this:
      </p>
      <Pre>{`<!-- ios/App/App/PrivacyInfo.xcprivacy -->
<dict>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>CA92.1</string></array>
    </dict>
  </array>
</dict>`}</Pre>
      <p>
        Add it to the Xcode project so it&apos;s bundled with the app. The exact data types and
        reason codes depend on what your app and plugins actually do &mdash; declare accurately, not
        defensively.
      </p>

      <h2>Common rejection causes</h2>
      <ul>
        <li>Missing manifest entirely &mdash; the most frequent cause.</li>
        <li>Using a required-reason API without declaring a reason code.</li>
        <li>Outdated plugins or SDKs that lack their own manifests.</li>
        <li>Data-collection declarations that don&apos;t match your Play/App Store privacy labels.</li>
      </ul>

      <h2>Why OTA doesn&apos;t touch this</h2>
      <p>
        The privacy manifest is native and evaluated at submission, so it&apos;s firmly in
        store-release territory &mdash; you can&apos;t (and don&apos;t need to) change it over the
        air. It&apos;s a good example of the OTA line: native compliance artifacts go through review;
        your web layer ships over the air. See{' '}
        <A href="/blog/app-store-compliant-ota-updates">what OTA can and can&apos;t change</A>.
      </p>

      <Callout>
        <p>
          Keep your Capacitor and plugin versions current &mdash; a lot of privacy-manifest
          compliance is handled for you by up-to-date plugins.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/first-app-store-review-guide">passing your first store review</A> for the
        broader submission checklist, and the <A href="/docs/plugin">plugin docs</A> for OtaKit&apos;s
        own footprint.
      </p>
    </BlogArticle>
  );
}
