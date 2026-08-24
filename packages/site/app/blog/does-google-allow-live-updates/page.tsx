import { BlogArticle, Callout, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('does-google-allow-live-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function DoesGoogleAllowPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Short answer: <strong>yes</strong> &mdash; Google Play allows over-the-air updates to your
        web-layer code. Android developers ask this less often than iOS developers, because Google&apos;s
        policy has always been more permissive here, but it&apos;s worth knowing exactly what the policy
        restricts so you stay comfortably inside it. Here&apos;s the direct answer for Capacitor apps.
      </p>

      <Callout>
        <p>
          The relevant policy is Google Play&apos;s <strong>Device and Network Abuse</strong> policy. It
          restricts downloading <em>executable code</em> (like dex or native code) from outside Google
          Play &mdash; not interpreted web content.
        </p>
      </Callout>

      <h2>What the policy restricts</h2>
      <p>
        The Device and Network Abuse policy prohibits apps from introducing or exploiting the download of
        executable code (such as dex, JAR, or <code>.so</code> files) from a source other than Google
        Play, in a way that changes the app&apos;s behavior. The intent is to stop apps from sideloading
        native payloads that dodge review and could be malicious. It is not aimed at your JavaScript.
      </p>

      <h2>Why Capacitor OTA is inside the policy</h2>
      <ul>
        <li>Capacitor updates ship <strong>interpreted web assets</strong> &mdash; JS, HTML, CSS &mdash; not dex or native binaries.</li>
        <li>They run in the WebView, the same as any web content your app already loads.</li>
        <li>They don&apos;t alter the app&apos;s native code or dodge Play&apos;s security model.</li>
      </ul>
      <p>
        That&apos;s the same distinction Apple draws with guideline 2.5.2 &mdash; interpreted vs native.
        See the full checklist in{' '}
        <A href="/blog/google-play-ota-compliance-checklist">the Google Play OTA compliance checklist</A>.
      </p>

      <h2>Staying compliant</h2>
      <p>
        Keep updates to the web layer, don&apos;t use them to change the app&apos;s core purpose, and
        don&apos;t ship anything you couldn&apos;t have submitted through Play in the first place. Do that
        and OTA updates raise no policy concern. See{' '}
        <A href="/blog/app-store-compliant-ota-updates">app-store-compliant OTA updates</A>.
      </p>

      <Callout>
        <p>
          As with iOS, the failure mode is <em>intent</em>: using updates to smuggle in behavior review
          would have rejected. Ship the honest version of your app faster &mdash; that&apos;s the whole
          point &mdash; and there&apos;s nothing to worry about.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/does-apple-allow-live-updates">the Apple answer</A> and{' '}
        <A href="/blog/bypass-app-store-review-capacitor">updating without repeat review</A> for the
        practical workflow on both platforms.
      </p>
    </BlogArticle>
  );
}
