import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('automate-channel-promotion-ota')!;

export const metadata = blogPostMetadata(post.slug);

export default function ChannelPromotionPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Staged rollouts are safe, but they add a manual step: someone has to promote the validated
        bundle from beta to production. Automating that promotion &mdash; on a schedule, a tag, or an
        approval click &mdash; keeps the safety of staging without the babysitting. This guide covers
        the promotion patterns for <A href="/">OtaKit</A> channels.
      </p>

      <Callout>
        <p>
          Mental model: releasing to beta is automatic. Promotion is the gate. Automating the gate
          means promoting the <em>same</em> bundle you validated &mdash; never a rebuild.
        </p>
      </Callout>

      <h2>The core command</h2>
      <p>
        Promotion is pointing a channel at a bundle id you already released and validated. The bundle
        doesn&apos;t change; only its audience does:
      </p>
      <Pre>{`otakit release <bundle-id> --channel production`}</Pre>
      <p>
        Everything below is just different ways to decide <em>when</em> to run that command.
      </p>

      <h2>Pattern 1: soak-then-promote on a schedule</h2>
      <p>
        Release to beta on every merge, then a scheduled job promotes the latest healthy beta bundle
        after a soak window. In GitHub Actions, a scheduled workflow can look up the current beta
        bundle and promote it if your health checks pass:
      </p>
      <Pre>{`on:
  schedule:
    - cron: "0 15 * * 1-5"   # weekday afternoons, after a morning soak`}</Pre>
      <p>
        Gate the promotion step on your own health signal &mdash; crash-free rate, error budget
        &mdash; so a bad beta never auto-promotes. See{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A> for what to
        watch.
      </p>

      <h2>Pattern 2: promote on a tag</h2>
      <p>
        Make promotion an explicit human action tied to your release process. Merges go to beta;
        cutting a version tag promotes to production:
      </p>
      <Pre>{`on:
  push:
    tags: ["v*"]

# job step:
#   otakit release "$BETA_BUNDLE_ID" --channel production`}</Pre>

      <h2>Pattern 3: manual approval gate</h2>
      <p>
        Keep automation for the mechanics but require a human to press go. GitHub Actions
        environments and GitLab manual jobs both support an approval step before a protected job
        runs &mdash; the promotion command runs only after someone approves the deployment.
      </p>
      <Pre>{`# GitLab: a manual promotion job
promote:
  stage: promote
  when: manual
  script:
    - otakit release "$BETA_BUNDLE_ID" --channel production`}</Pre>

      <h2>Tracking the bundle id</h2>
      <p>
        Every pattern needs the beta bundle&apos;s id. Capture it from the upload step&apos;s output
        and pass it to the promotion step (an artifact, a job output, or a small state file). That&apos;s
        what guarantees you promote the exact artifact you tested, not a fresh build.
      </p>

      <Callout>
        <p>
          Automating promotion doesn&apos;t mean removing the gate &mdash; it means making the gate
          consistent. Health-check it, and a bad bundle stays on beta.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Combine with the <A href="/blog/automate-capacitor-ota-releases-github-actions">GitHub
        Actions</A> or <A href="/blog/gitlab-ci-capacitor-live-updates">GitLab</A> release flows, and
        see the <A href="/docs/channels">channels docs</A> for the full API.
      </p>
    </BlogArticle>
  );
}
