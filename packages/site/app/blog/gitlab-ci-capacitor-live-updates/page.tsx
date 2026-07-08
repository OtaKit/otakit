import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('gitlab-ci-capacitor-live-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function GitlabCiPage() {
  return (
    <BlogArticle post={post}>
      <p>
        If your team lives in GitLab, you don&apos;t need GitHub Actions to automate Capacitor live
        updates. A short <Code>.gitlab-ci.yml</Code> can build your web app and release an
        over-the-air bundle with the <A href="/">OtaKit</A> CLI on every pipeline. This guide is the
        GitLab equivalent of the{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">GitHub Actions OTA flow</A>.
      </p>

      <Callout>
        <p>
          Goal: a push to your main branch runs a pipeline that builds the web app and releases the
          bundle to a channel &mdash; no manual steps.
        </p>
      </Callout>

      <h2>1. Add a masked CI/CD variable</h2>
      <p>
        Create a release token for your app and add it under{' '}
        <Code>Settings &rarr; CI/CD &rarr; Variables</Code> as <Code>OTAKIT_TOKEN</Code>. Mark it{' '}
        <strong>Masked</strong> (and <strong>Protected</strong> if you only release from protected
        branches) so it never appears in job logs.
      </p>

      <h2>2. Add the pipeline</h2>
      <p>
        This builds the web app and releases to production on the default branch. Adjust the build
        command and web directory to your framework:
      </p>
      <Pre>{`# .gitlab-ci.yml
image: node:20

stages: [release]

release:
  stage: release
  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
  cache:
    paths: [node_modules/]
  script:
    - npm ci
    - npm run build
    - npm install -g @otakit/cli
    - otakit upload --release production
  # OTAKIT_TOKEN is injected from CI/CD variables`}</Pre>
      <p>
        The OtaKit CLI reads <Code>OTAKIT_TOKEN</Code> from the environment, so there&apos;s no
        interactive login. That&apos;s the whole pipeline for straight-to-production.
      </p>

      <h2>3. Stage before production</h2>
      <p>
        For user-facing apps, release to a pre-production channel automatically and promote by hand.
        Point the automated job at <Code>beta</Code>:
      </p>
      <Pre>{`  script:
    - npm ci
    - npm run build
    - npm install -g @otakit/cli
    - otakit upload --release beta`}</Pre>
      <p>
        Then promote the exact bundle you validated &mdash; no rebuild &mdash; when it looks healthy.
        See <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>:
      </p>
      <Pre>{`otakit release <bundle-id> --channel production`}</Pre>

      <h2>4. Promote on a tag</h2>
      <p>
        Prefer explicit promotions? Gate the production release on a tag pipeline instead of the
        default branch:
      </p>
      <Pre>{`  rules:
    - if: '$CI_COMMIT_TAG =~ /^v/'`}</Pre>
      <p>
        Now merges flow to beta and tagging <Code>v1.4.2</Code> ships production &mdash; your release
        history matches your tags.
      </p>

      <Callout>
        <p>
          Same rules as any OTA pipeline: mask the token, bump <Code>runtimeVersion</Code> on native
          changes, and fail the job if the build fails. See{' '}
          <A href="/blog/capacitor-ota-update-security">OTA security</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See the <A href="/docs/ci">CI automation docs</A> for tokens and flags, and{' '}
        <A href="/blog/automate-channel-promotion-ota">automating channel promotion</A> to make
        beta-to-production hands-off too.
      </p>
    </BlogArticle>
  );
}
