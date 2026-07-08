import { BlogArticle, Callout, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('schedule-capacitor-ota-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function SchedulePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Merging a change and releasing it to users are two different decisions. You might want a fix to
        go out at 2am local time, or hold a feature until a marketing date, or gate a promotion behind a
        human approval. This guide covers how to schedule Capacitor live updates with{' '}
        <A href="/">OtaKit</A> &mdash; decoupling &ldquo;built&rdquo; from &ldquo;live.&rdquo;
      </p>

      <Callout>
        <p>
          The core trick: separate <strong>uploading</strong> a bundle from <strong>promoting</strong>
          it to the channel your users watch. Upload whenever CI runs; promote on your schedule.
        </p>
      </Callout>

      <h2>Pattern 1: promote on a schedule</h2>
      <p>
        Release the validated bundle to a staging channel at merge time, then run a scheduled job that
        promotes the exact same bundle to production at the moment you want it live:
      </p>
      <Pre>{`# at merge time (CI)
otakit upload --release staging

# later, on a cron (e.g. 2am), promote the same bundle
otakit upload --release production`}</Pre>
      <p>
        Promoting the bundle you already validated &mdash; not rebuilding &mdash; is what makes this
        safe. See <A href="/blog/automate-channel-promotion-ota">channel promotion</A> for the pattern
        in depth.
      </p>

      <h2>Pattern 2: gate on a tag or approval</h2>
      <p>
        Instead of a clock, trigger the promotion on a git tag or a manual CI approval. This is ideal
        for regulated releases where a person signs off before anything reaches users. The promotion
        step is identical; only the trigger changes. Wire it in your pipeline &mdash; see{' '}
        <A href="/docs/ci">CI automation</A>.
      </p>

      <h2>Pattern 3: schedule with a cron in CI</h2>
      <p>
        Most CI systems can run a scheduled workflow. Point one at the promotion command and you have
        time-based releases without any extra infrastructure. Combine it with staged rollouts so the
        scheduled release still ramps gradually rather than hitting everyone at once &mdash; see{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>.
      </p>

      <Callout>
        <p>
          A word on device timing: users receive an update on their next launch/check after it&apos;s
          promoted, not at the exact second you promote. &ldquo;Scheduling&rdquo; controls when the
          bundle becomes available, not when every device applies it. For updates that must apply
          immediately on receipt, combine with{' '}
          <A href="/blog/forced-and-mandatory-capacitor-updates">force-immediate</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/channels">Channels &amp; runtime version</A> for the promotion model and the{' '}
        <A href="/docs/cli">CLI reference</A> for release flags.
      </p>
    </BlogArticle>
  );
}
