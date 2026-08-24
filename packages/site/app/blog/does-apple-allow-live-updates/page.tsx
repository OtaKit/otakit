import { BlogArticle, Callout, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('does-apple-allow-live-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function DoesAppleAllowPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Short answer: <strong>yes</strong> &mdash; Apple explicitly allows over-the-air updates to a
        specific kind of code, and it has for years. The confusion comes from conflating &ldquo;live
        updates&rdquo; (fine) with &ldquo;downloading native executable code&rdquo; (not fine). This is
        the direct answer, quoted from Apple&apos;s own guidelines, and what it means for a Capacitor app.
      </p>

      <Callout>
        <p>
          The permission lives in App Store Review Guideline 2.5.2. It carves out an exception for code
          run by WebKit or JavaScriptCore &mdash; which is exactly where your Capacitor web layer runs.
        </p>
      </Callout>

      <h2>What guideline 2.5.2 actually says</h2>
      <p>
        The guideline prohibits apps from downloading, installing, or executing code that changes the
        app&apos;s features or functionality &mdash; <em>with an explicit exception</em>: code executed by
        Apple&apos;s built-in WebKit framework or JavaScriptCore, provided it doesn&apos;t change the
        app&apos;s primary purpose, add store-like features, or violate other guidelines. Your JavaScript,
        HTML, and CSS run in WebKit. That&apos;s the exception, and it&apos;s deliberate. We break down the
        exact wording in <A href="/blog/apple-guideline-2-5-2-explained">guideline 2.5.2 explained</A>.
      </p>

      <h2>Where the line is</h2>
      <ul>
        <li>
          <strong>Allowed:</strong> updating your web-layer code &mdash; bug fixes, UI changes, new
          screens built from your existing web stack.
        </li>
        <li>
          <strong>Not allowed:</strong> downloading native binaries, or using an update to change what the
          app fundamentally is (turning a notes app into a casino).
        </li>
      </ul>
      <p>
        Capacitor OTA updates ship the first category and none of the second, which is why they sit
        squarely inside the exception. See{' '}
        <A href="/blog/app-store-compliant-ota-updates">app-store-compliant OTA updates</A>.
      </p>

      <h2>How Apple enforces it</h2>
      <p>
        Enforcement is about <em>substance</em>, not the mere existence of updates. An app that quietly
        becomes a different product after approval is the target &mdash; not an app that fixes a bug over
        the air. Keep updates within your app&apos;s stated purpose and you&apos;re on the right side of it.
      </p>

      <Callout>
        <p>
          Don&apos;t use OTA to sneak past review something that would have been rejected. That&apos;s the
          one behavior the guideline exists to stop, and it&apos;s how apps get pulled. Ship the same app
          you&apos;d have submitted &mdash; just faster.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/does-google-allow-live-updates">the Android answer</A>, and{' '}
        <A href="/blog/bypass-app-store-review-capacitor">updating without repeat review</A> for the
        practical workflow.
      </p>
    </BlogArticle>
  );
}
