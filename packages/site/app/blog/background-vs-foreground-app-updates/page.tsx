import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('background-vs-foreground-app-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function BgVsFgUpdatesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        There are two good ways to apply an over-the-air update, and they feel completely different
        to users. A <strong>background</strong> update downloads silently and swaps in on the next
        launch &mdash; users never see it happen. A <strong>foreground</strong> update prompts the
        user to restart now to get the latest version. Neither is universally right; the choice
        depends on your app. This guide covers the tradeoffs and how to configure each in{' '}
        <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          Mental model: background updates optimize for invisibility; foreground updates optimize for
          immediacy. Pick per the update&apos;s urgency, not as a blanket setting.
        </p>
      </Callout>

      <h2>The tradeoff</h2>
      <DataTable
        headers={['', 'Background (silent)', 'Foreground (prompt)']}
        rows={[
          ['User sees anything?', 'No', 'Yes, a restart prompt'],
          ['Applies when', 'Next cold start', 'On user accept, immediately'],
          ['Best for', 'Routine fixes and features', 'Urgent or must-have updates'],
          ['Interruption', 'None', 'Interrupts the current session'],
          ['Risk', 'User on old version a bit longer', 'Prompt fatigue if overused'],
        ]}
      />

      <h2>Background updates (the sensible default)</h2>
      <p>
        OtaKit&apos;s default behavior downloads new bundles quietly in the background and activates
        them on the next cold start. Users just find themselves on the new version next time they
        open the app &mdash; no prompts, no friction. For the vast majority of releases (bug fixes,
        content, incremental features) this is exactly what you want.
      </p>
      <p>
        It&apos;s controlled by update policies (<Code>launchPolicy</Code>, <Code>resumePolicy</Code>
        ). The default combination stages in the background and applies on launch. See{' '}
        <A href="/docs/update-strategies">update strategies</A> for the full matrix.
      </p>

      <h2>Foreground updates (when it matters now)</h2>
      <p>
        When an update shouldn&apos;t wait for the user to happen to relaunch, prompt them. Listen for
        the staged-update event and offer a restart:
      </p>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";

OtaKit.addListener("updateStaged", () => {
  // show your own "Update ready — restart now?" UI, then:
  // await OtaKit.apply();  // reloads into the new bundle
});`}</Pre>
      <p>
        Keep the prompt honest: a &ldquo;restart to update&rdquo; banner the user can dismiss, not a
        wall they can&apos;t pass &mdash; unless the update is genuinely mandatory, in which case see{' '}
        <A href="/blog/forced-and-mandatory-capacitor-updates">forced and mandatory updates</A>.
      </p>

      <h2>A hybrid that works well</h2>
      <p>
        Many teams land on: background updates for everything by default, a gentle foreground prompt
        for updates flagged important, and <Code>--force-immediate</Code> reserved for true
        emergencies. That gives users a frictionless experience most of the time and a fast path when
        it counts.
      </p>

      <Callout>
        <p>
          Overusing prompts trains users to dismiss them. Default to silent, and spend the
          &ldquo;interrupt budget&rdquo; only on updates that truly warrant it.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See the <A href="/docs/events">events docs</A> for listener details, and{' '}
        <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> for where activation fits
        in the delivery flow.
      </p>
    </BlogArticle>
  );
}
