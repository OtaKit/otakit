import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('automate-capacitor-ota-releases-github-actions')!;

export const metadata = blogPostMetadata(post.slug);

export default function GithubActionsOtaPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Manual releases are where OTA loses its speed advantage. If shipping an update means
        someone remembering to build, run the CLI, and pick the right channel, releases get
        batched, delayed, and occasionally done wrong. The fix is to make a merge to your main
        branch <em>be</em> the release. This guide sets that up with GitHub Actions and{' '}
        <A href="/">OtaKit</A> — copy-paste and adapt.
      </p>

      <Callout>
        <p>
          Goal: push to main, CI builds the web app, uploads the bundle, and releases it to a
          channel. No laptop, no manual steps, fully auditable.
        </p>
      </Callout>

      <h2>1. Create a release token</h2>
      <p>
        CI authenticates with a token instead of an interactive <Code>otakit login</Code>. Create
        one for your app, then add it to your repository as an encrypted secret under{' '}
        <Code>Settings → Secrets and variables → Actions</Code> — for example{' '}
        <Code>OTAKIT_TOKEN</Code>. Scope it to just this app; never paste it into the workflow file
        directly.
      </p>

      <h2>2. Add the workflow</h2>
      <p>
        This workflow builds the web app and releases the bundle on every push to{' '}
        <Code>main</Code>. Adjust the build command and web directory to your framework
        (<Code>out</Code> for Next.js static export, <Code>dist</Code> for Vite):
      </p>
      <Pre>{`# .github/workflows/release.yml
name: Live update

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run build

      - name: Release OTA bundle
        run: |
          npm install -g @otakit/cli
          otakit upload --release production
        env:
          OTAKIT_TOKEN: \${{ secrets.OTAKIT_TOKEN }}`}</Pre>
      <p>
        The CLI reads <Code>OTAKIT_TOKEN</Code> from the environment, so there&apos;s no interactive
        login step. That&apos;s the whole pipeline for a straight-to-production flow.
      </p>

      <h2>3. Stage before production (recommended)</h2>
      <p>
        Straight-to-production is fine for internal tools. For anything user-facing, release to a
        pre-production channel automatically and promote by hand once it looks healthy. Point the
        automated release at <Code>beta</Code>:
      </p>
      <Pre>{`      - name: Release to beta
        run: |
          npm install -g @otakit/cli
          otakit upload --release beta
        env:
          OTAKIT_TOKEN: \${{ secrets.OTAKIT_TOKEN }}`}</Pre>
      <p>
        Then promote the exact bundle you validated — no rebuild — when you&apos;re ready. See{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A> for the full
        pattern:
      </p>
      <Pre>{`otakit release <bundle-id> --channel production`}</Pre>

      <h2>4. Promote on a tag instead</h2>
      <p>
        Prefer promotion to be an explicit, human action? Trigger the production release on a
        version tag rather than every merge:
      </p>
      <Pre>{`on:
  push:
    tags: ["v*"]`}</Pre>
      <p>
        Now day-to-day merges flow to <Code>beta</Code>, and cutting a <Code>v1.4.2</Code> tag ships
        production. Your release history lines up with your git tags.
      </p>

      <h2>Keep it secure and correct</h2>
      <ul>
        <li>
          <strong>Mask the token.</strong> Passing it via <Code>secrets</Code> keeps it out of logs.
          Never <Code>echo</Code> it.
        </li>
        <li>
          <strong>Pin native compatibility.</strong> When a PR changes native code, bump{' '}
          <Code>runtimeVersion</Code> in the same change so old shells don&apos;t receive an
          incompatible bundle. See <A href="/blog/capacitor-ota-update-security">OTA security</A>.
        </li>
        <li>
          <strong>Fail loudly.</strong> Let the job fail if the build fails — a broken build should
          never reach a release step.
        </li>
      </ul>

      <Callout>
        <p>
          OtaKit doesn&apos;t bill by monthly active users or bandwidth, so wiring this into CI
          won&apos;t surprise you with a metered bill as your rollout widens.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        The <A href="/docs/ci">CI automation docs</A> cover tokens and flags in detail. Pair this
        with <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A> and the{' '}
        <A href="/blog/common-capacitor-ota-mistakes">common mistakes checklist</A> for a release
        process you can trust.
      </p>
    </BlogArticle>
  );
}
