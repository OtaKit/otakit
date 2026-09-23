import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('best-ci-cd-platforms-for-capacitor-apps')!;

export const metadata = blogPostMetadata(post.slug);

export default function BestCiCdCapacitorPage() {
  return (
    <BlogArticle post={post}>
      <p>
        A Capacitor app needs two kinds of builds. The <strong>native build</strong> compiles the
        iOS and Android shells, signs them and uploads them to the stores. The{' '}
        <strong>web build</strong> is your framework&apos;s <Code>npm run build</Code>. Most CI
        guides treat them as one pipeline, which is why most Capacitor teams wait for a full native
        build and App Review to ship a one-line CSS fix.
      </p>
      <p>
        This comparison covers the five platforms Capacitor teams actually use in 2026, what each is
        good at, and how to add the missing step: shipping web-only changes straight to users.
      </p>

      <Callout>
        <p>
          <strong>If you are leaving Ionic Appflow:</strong> Appflow&apos;s native builds map onto
          any platform below. Its Live Updates need a separate replacement. See{' '}
          <A href="/blog/ionic-appflow-is-shutting-down">Ionic Appflow is shutting down</A>.
        </p>
      </Callout>

      <h2>The short answer</h2>
      <DataTable
        headers={['Platform', 'Best for', 'macOS builds', 'Setup effort']}
        rows={[
          [
            'GitHub Actions',
            'Teams already on GitHub who want full control',
            'Hosted Apple silicon runners',
            'Medium: you write the signing steps',
          ],
          [
            'Codemagic',
            'Mobile-first teams who want Capacitor presets and managed signing',
            'Hosted Apple silicon machines',
            'Low',
          ],
          [
            'Bitrise',
            'Larger teams wanting a visual workflow editor and many integrations',
            'Hosted Apple silicon machines',
            'Low to medium',
          ],
          [
            'GitLab CI',
            'Teams on GitLab, including self-managed runners',
            'Hosted macOS runners on paid tiers, or your own Mac',
            'Medium',
          ],
          [
            'Xcode Cloud',
            'iOS-only builds tightly tied to App Store Connect',
            'Apple-hosted, iOS only',
            'Low for iOS, no Android',
          ],
        ]}
      />
      <p>
        Pricing changes often, so check each provider&apos;s current page. The general shape: macOS
        minutes cost several times more than Linux minutes everywhere, so keep Android builds and
        web builds on Linux and send only the iOS job to a Mac.
      </p>

      <h2>GitHub Actions</h2>
      <p>
        The default choice for most teams. Your code is already there, the marketplace has actions
        for everything, and you can run Linux and macOS jobs in one workflow. The cost is that iOS
        signing is your job: importing certificates into a temporary keychain, installing
        provisioning profiles, or using an App Store Connect API key with automatic signing.
      </p>
      <p>
        We have step-by-step guides for{' '}
        <A href="/blog/github-actions-ios-build-signing">iOS builds and signing</A> and{' '}
        <A href="/blog/github-actions-android-build-capacitor">Android builds</A>.
      </p>

      <h2>Codemagic</h2>
      <p>
        Built for mobile, with explicit support for Ionic and Capacitor projects. Its main advantage
        is code signing: it can fetch or create certificates and profiles from App Store Connect for
        you, which removes the most error-prone part of iOS CI. Configuration is a{' '}
        <Code>codemagic.yaml</Code> in your repo or a UI workflow. A good fit for small teams who
        want iOS builds working this afternoon.
      </p>

      <h2>Bitrise</h2>
      <p>
        A mature mobile CI with a visual workflow editor and a large library of steps (testing,
        signing, store upload, notifications). It suits teams with several apps and people who are
        not CI specialists. For a single small Capacitor app, it can feel like more platform than
        you need.
      </p>

      <h2>GitLab CI</h2>
      <p>
        If your code lives on GitLab, stay there. Android and web jobs run on standard Linux
        runners. For iOS, use GitLab&apos;s hosted macOS runners on a tier that includes them, or
        register a Mac of your own as a runner. See{' '}
        <A href="/blog/gitlab-ci-capacitor-live-updates">GitLab CI for Capacitor live updates</A>.
      </p>

      <h2>Xcode Cloud</h2>
      <p>
        Apple&apos;s own CI, included with a number of compute hours in the Apple Developer
        Program. Signing and TestFlight distribution are handled for you. It only builds for Apple
        platforms, so you still need a second system for Android, and a Capacitor project needs a
        custom script to install Node and run the web build before Xcode builds.
      </p>

      <h2>The step most pipelines are missing</h2>
      <p>
        Whichever platform you choose, look at what actually changes in a typical week. In most
        Capacitor apps it is the web layer: screens, copy, styles, business logic. The native shell
        changes a few times a year, when you add a plugin or upgrade Capacitor.
      </p>
      <p>
        So split the pipeline. Run the native build on tags or when native files change. Run a web
        release on every merge to main:
      </p>
      <Pre>{`# .github/workflows/ota.yml
name: OTA release
on:
  push:
    branches: [main]
    paths-ignore: ['ios/**', 'android/**']

jobs:
  ota:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build
      - run: npx @otakit/cli upload --release staging --fail-on-incompatible
        env:
          OTAKIT_TOKEN: \${{ secrets.OTAKIT_TOKEN }}`}</Pre>
      <p>
        This job runs on a cheap Linux runner in about a minute and never touches a Mac. The{' '}
        <Code>--fail-on-incompatible</Code> flag stops the release if the web build needs native
        changes that are not in the store build yet, so a missing plugin cannot reach devices.
        Promote to production when staging looks good:
      </p>
      <Pre>{`npx @otakit/cli release <bundleId> --channel production`}</Pre>
      <p>
        See the <A href="/docs/ci">CI/CD docs</A> for token setup and the same flow on other
        platforms, and{' '}
        <A href="/blog/automate-channel-promotion-ota">automating channel promotion</A> for a
        gated staging-to-production pipeline.
      </p>

      <h2>How to choose</h2>
      <ul>
        <li>
          <strong>Code on GitHub, comfortable with YAML:</strong> GitHub Actions.
        </li>
        <li>
          <strong>Want iOS signing handled for you:</strong> Codemagic.
        </li>
        <li>
          <strong>Several apps, mixed-skill team:</strong> Bitrise.
        </li>
        <li>
          <strong>Code on GitLab:</strong> GitLab CI.
        </li>
        <li>
          <strong>iOS only, want Apple to manage it:</strong> Xcode Cloud, plus something else for
          Android.
        </li>
      </ul>
      <p>
        Then add the OTA job, whatever you picked. Faster native CI saves minutes. Not needing a
        native build for most releases saves days. <A href="/">OtaKit</A> has a free tier, so you
        can add it to an existing pipeline today and see the difference on your next release.
      </p>
    </BlogArticle>
  );
}
