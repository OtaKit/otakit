import { BlogArticle, Callout, Code, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('apple-guideline-2-5-2-explained')!;

export const metadata = blogPostMetadata(post.slug);

export default function Guideline252Page() {
  return (
    <BlogArticle post={post}>
      <p>
        Almost every &ldquo;can I do OTA updates on iOS?&rdquo; question comes down to one App Store
        Review Guideline: <strong>2.5.2</strong>. It&apos;s short, it&apos;s often misread, and once
        you understand what it actually restricts, the compliance picture for Capacitor apps gets
        very clear. This post walks through the guideline and what it means in practice.
      </p>

      <Callout>
        <p>
          Short version: 2.5.2 bans downloading code that changes your app into something App Review
          didn&apos;t see &mdash; with an explicit exception for JavaScript running in Apple&apos;s
          own web view. Capacitor&apos;s web layer lives in that exception.
        </p>
      </Callout>

      <h2>What the guideline says</h2>
      <p>
        Guideline 2.5.2 requires that apps be self-contained in their bundles and not read or write
        data outside their designated container, and that they not download, install, or execute code
        which introduces or changes features or functionality &mdash; creating an experience that
        differs from what App Review approved. Historically this connects to rule 3.3.1 in the
        developer agreement about interpreted code.
      </p>
      <p>
        The critical clause is the carve-out: code executed by Apple&apos;s built-in{' '}
        <strong>WebKit framework or JavaScriptCore</strong> is permitted, provided it doesn&apos;t
        provide native store, payment, or other capabilities that would circumvent review.
      </p>

      <h2>Why Capacitor apps fit the exception</h2>
      <p>
        A Capacitor app&apos;s entire web layer &mdash; your HTML, CSS, and JavaScript &mdash; runs
        inside the WebKit web view that 2.5.2 explicitly allows. Updating that web layer over the air
        is precisely the sanctioned case. This is why every major Capacitor OTA tool (OtaKit, Capgo,
        Capawesome) and Ionic&apos;s own Appflow all operate the same way. It&apos;s not a loophole;
        it&apos;s the documented behavior.
      </p>

      <h2>What 2.5.2 still forbids</h2>
      <p>
        The guideline draws a real line, and OTA has to respect it:
      </p>
      <ul>
        <li>
          <strong>No native code over the air.</strong> Downloading and executing native binaries or
          plugins to change functionality is exactly what 2.5.2 targets.
        </li>
        <li>
          <strong>No materially different app.</strong> You can improve and fix what was reviewed;
          you can&apos;t use OTA to turn the app into something else.
        </li>
        <li>
          <strong>No circumventing review-gated capabilities.</strong> Payments, in particular, must
          stay within Apple&apos;s rules &mdash; you can&apos;t OTA your way around In-App Purchase.
        </li>
      </ul>

      <h2>How to stay clearly on the right side</h2>
      <p>
        The practical test is simple: if a change would require you to modify native code &mdash; and
        therefore bump <Code>runtimeVersion</Code> and submit a store build &mdash; it&apos;s not an
        OTA update. Keep OTA to the web layer, and you&apos;re operating squarely inside the WebKit
        exception. OtaKit reinforces this by checking your bundle&apos;s dependencies at upload and
        warning on native mismatches.
      </p>

      <Callout>
        <p>
          One rule covers most of it: web-layer changes ship over the air; anything native ships
          through review. That&apos;s the shape of 2.5.2 in day-to-day terms.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        For the broader store picture including Google Play, see{' '}
        <A href="/blog/app-store-compliant-ota-updates">the complete App Store-compliant OTA guide</A>{' '}
        and the primary-source breakdown in{' '}
        <A href="/blog/ota-policies-for-app-store-and-google-play">
          are OTA updates allowed? App Store and Google Play rules explained
        </A>
        .
      </p>
    </BlogArticle>
  );
}
