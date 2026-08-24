import { BlogArticle, Callout, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-changelog-and-release-notes')!;

export const metadata = blogPostMetadata(post.slug);

export default function ChangelogPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Store release notes only cover store releases. When you ship a dozen over-the-air updates between
        binaries, none of them show up in the App Store &ldquo;What&apos;s New,&rdquo; and your users have
        no idea what changed. This guide covers managing changelogs for Capacitor OTA releases and
        surfacing them in-app with <A href="/">OtaKit</A> &mdash; so silent updates don&apos;t mean silent
        communication.
      </p>

      <Callout>
        <p>
          Two audiences, two changelogs: an <strong>internal</strong> one (every release, for your team)
          and a <strong>user-facing</strong> one (curated highlights, shown in-app). Don&apos;t conflate
          them &mdash; users don&apos;t want your commit log.
        </p>
      </Callout>

      <h2>Keep an internal changelog per release</h2>
      <p>
        Every OTA release should be traceable: what bundle, what changed, who shipped it. Tie your release
        to a git tag or commit and keep a running log. Conventional commits make this close to automatic
        &mdash; the release notes fall out of the commit history.
      </p>

      <h2>Surface a &ldquo;What&apos;s new&rdquo; in-app</h2>
      <p>
        Since the store notes can&apos;t cover OTA updates, show your own. Ship a small &ldquo;What&apos;s
        new&rdquo; payload with the bundle and display it after an update applies. Listen for the applied
        event and check whether this bundle has notes the user hasn&apos;t seen:
      </p>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-plugin';

OtaKit.addListener('updateApplied', async () => {
  const notes = await loadBundledReleaseNotes();
  if (notes && !seen(notes.version)) showWhatsNew(notes);
});`}</Pre>
      <p>
        Because the notes ship inside the bundle, they&apos;re always in sync with the code &mdash; no
        separate system to keep aligned. See <A href="/docs/events">Events</A> for the applied event.
      </p>

      <h2>Match the changelog to the update UX</h2>
      <p>
        A silent background update pairs with a subtle &ldquo;What&apos;s new&rdquo; on next open; a
        mandatory update can show its notes on the update screen itself. Match the prominence to how the
        update was delivered &mdash; see{' '}
        <A href="/blog/background-vs-foreground-app-updates">background vs foreground updates</A>.
      </p>

      <Callout>
        <p>
          Keep user-facing notes human. &ldquo;Fixed the crash when adding a photo&rdquo; beats
          &ldquo;patch bump; see commits.&rdquo; The changelog is a small, frequent touchpoint with your
          users &mdash; use it to build trust, not to dump diffs.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/mobile-app-update-strategy-checklist">the update strategy checklist</A> for
        where communication fits, and <A href="/docs/channels">Channels &amp; runtime version</A> for
        tracking what shipped where.
      </p>
    </BlogArticle>
  );
}
