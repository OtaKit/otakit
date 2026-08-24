import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-edge-to-edge-display')!;

export const metadata = blogPostMetadata(post.slug);

export default function EdgeToEdgePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Android 15 makes edge-to-edge display the default: apps draw behind the status and navigation
        bars, and it&apos;s on you to keep content out from under them. Handled wrong, your header hides
        behind the clock and your buttons sit under the gesture bar. The good news is you can get this
        right in a Capacitor app with native config and CSS &mdash; no extra plugin &mdash; and tune it
        over the air with <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          The whole problem is <strong>insets</strong>: the safe regions the system UI occupies. Native
          config enables edge-to-edge; CSS <Code>env()</Code> safe-area variables tell your layout where
          the edges actually are.
        </p>
      </Callout>

      <h2>1. Let the WebView go full-bleed</h2>
      <p>
        Configure the app to draw behind the system bars (edge-to-edge) and make the status bar
        transparent. On Android 15 this is increasingly the default; you mainly ensure your theme
        doesn&apos;t fight it.
      </p>

      <h2>2. Respect safe areas in CSS</h2>
      <p>
        Add the viewport-fit meta tag, then pad your layout with the safe-area insets so content clears
        the notch, status bar, and gesture bar:
      </p>
      <Pre>{`<meta name="viewport" content="viewport-fit=cover, width=device-width, initial-scale=1" />`}</Pre>
      <Pre>{`.app-header {
  padding-top: env(safe-area-inset-top);
}
.app-footer {
  padding-bottom: env(safe-area-inset-bottom);
}`}</Pre>

      <h2>3. Test on real hardware</h2>
      <p>
        Insets vary wildly &mdash; notches, punch-holes, gesture vs button navigation. Test on a couple of
        real devices, not just the simulator, because that&apos;s where the ugly overlaps show up.
      </p>

      <h2>4. Iterate the layout over the air</h2>
      <p>
        Safe-area handling is pure CSS, which means it&apos;s exactly the kind of thing you&apos;ll tweak a
        few times after launch as bug reports come in from devices you didn&apos;t test. Ship each
        adjustment over the air:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>

      <Callout>
        <p>
          The <Code>env(safe-area-inset-*)</Code> values are zero unless <Code>viewport-fit=cover</Code>
          is set. If your padding &ldquo;does nothing,&rdquo; that meta tag is almost always the missing
          piece.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/capacitor-splash-screen-guide">splash screens</A> for the rest of the launch
        polish and <A href="/docs/setup">Setup</A> for the base config.
      </p>
    </BlogArticle>
  );
}
