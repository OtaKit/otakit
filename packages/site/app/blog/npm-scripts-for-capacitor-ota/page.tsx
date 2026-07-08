import { BlogArticle, Callout, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('npm-scripts-for-capacitor-ota')!;

export const metadata = blogPostMetadata(post.slug);

export default function NpmScriptsPage() {
  return (
    <BlogArticle post={post}>
      <p>
        The fastest way to make a release process reliable is to make it boring: one command everyone on
        the team runs the same way. Wrapping the build-and-release flow in <code>package.json</code>
        scripts turns &ldquo;how do I ship an update again?&rdquo; into <code>npm run release</code>.
        Here are copy-paste npm scripts for Capacitor OTA releases with the{' '}
        <A href="/">OtaKit</A> CLI.
      </p>

      <h2>The core scripts</h2>
      <Pre>{`{
  "scripts": {
    "build": "vite build",
    "release:staging": "npm run build && otakit upload --release staging",
    "release:prod": "npm run build && otakit upload --release production",
    "release:hotfix": "npm run build && otakit upload --release production --force-immediate"
  }
}`}</Pre>
      <p>
        Now shipping to staging is <code>npm run release:staging</code>, and an emergency fix is{' '}
        <code>npm run release:hotfix</code>. Swap <code>vite build</code> for whatever your framework
        uses (<code>next build &amp;&amp; next export</code>, <code>ng build</code>, etc.).
      </p>

      <Callout>
        <p>
          Chaining <code>npm run build</code> into the release scripts guarantees you never upload a
          stale <code>dist/</code>. It&apos;s a small thing that prevents a very common mistake: shipping
          yesterday&apos;s build because you forgot to rebuild.
        </p>
      </Callout>

      <h2>Add a promote step</h2>
      <p>
        If you validate on staging and then promote the same bundle, you don&apos;t rebuild &mdash; you
        re-release the validated artifact to production. Keep that as its own script so the intent is
        explicit:
      </p>
      <Pre>{`{
  "scripts": {
    "promote": "otakit upload --release production"
  }
}`}</Pre>
      <p>
        See <A href="/blog/automate-channel-promotion-ota">channel promotion</A> for the
        validate-then-promote discipline this encodes.
      </p>

      <h2>Wire it into CI</h2>
      <p>
        The same scripts run in CI unchanged &mdash; your workflow just calls{' '}
        <code>npm run release:prod</code> after tests pass. That keeps local and CI releases identical,
        which is exactly what you want when debugging &ldquo;works locally, fails in CI.&rdquo; See{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">automate releases with GitHub
        Actions</A> and <A href="/docs/ci">CI automation</A>.
      </p>

      <Callout>
        <p>
          Keep secrets out of scripts. The CLI reads its token from the environment, so CI injects it
          and your local shell has it from <code>otakit login</code> &mdash; never hardcode it in{' '}
          <code>package.json</code>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See the <A href="/docs/cli">CLI reference</A> for every flag, and{' '}
        <A href="/blog/staging-environments-capacitor-channels">staging environments with channels</A>
        {' '}for how the staging/prod split works.
      </p>
    </BlogArticle>
  );
}
