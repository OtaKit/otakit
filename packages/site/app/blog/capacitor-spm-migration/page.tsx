import { BlogArticle, Callout, Code, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-spm-migration')!;

export const metadata = blogPostMetadata(post.slug);

export default function SpmMigrationPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Capacitor is steadily moving iOS dependency management from CocoaPods to Swift Package Manager
        (SPM). It&apos;s a welcome change &mdash; SPM is built into Xcode, faster, and doesn&apos;t need a
        separate <Code>pod install</Code> step &mdash; but migrating an existing project takes a few
        deliberate steps. This guide covers why the switch matters and how to move your Capacitor iOS
        project to SPM.
      </p>

      <h2>SPM vs CocoaPods</h2>
      <DataTable
        headers={['', 'CocoaPods', 'Swift Package Manager']}
        rows={[
          ['Tooling', 'External Ruby gem + pod install', 'Built into Xcode'],
          ['Speed', 'Slower resolution, extra step', 'Faster, integrated'],
          ['Workspace', 'Generates a .xcworkspace', 'Native Xcode project'],
          ['Direction', 'Legacy path', 'Where Capacitor is heading'],
        ]}
      />

      <Callout>
        <p>
          This is a <strong>native tooling</strong> migration &mdash; it changes how iOS builds resolve
          dependencies, not your web app. <A href="/">OtaKit</A> live updates are unaffected either way.
        </p>
      </Callout>

      <h2>Migration steps</h2>
      <ol>
        <li>
          Make sure your Capacitor core, CLI, and plugins are current &mdash; SPM support landed in recent
          versions, so align first. See{' '}
          <A href="/blog/fix-capacitor-version-mismatch">fixing version mismatch</A>.
        </li>
        <li>
          Use Capacitor&apos;s SPM tooling to generate the Swift Package structure for your iOS project,
          which declares your plugins as package dependencies instead of pods.
        </li>
        <li>
          Confirm each plugin you use ships an SPM-compatible package. Most official plugins do; check
          community ones individually.
        </li>
        <li>
          Remove the CocoaPods artifacts (<Code>Podfile</Code>, <Code>Pods/</Code>,{' '}
          <Code>.xcworkspace</Code>) once the SPM build is green, and open the native{' '}
          <Code>.xcodeproj</Code> directly.
        </li>
        <li>
          Build in Xcode and run <Code>npx cap sync</Code> to confirm the toolchain is consistent.
        </li>
      </ol>

      <h2>Watch for plugin gaps</h2>
      <p>
        The one thing that can stall the migration is a plugin without an SPM package. If a dependency
        you rely on is CocoaPods-only and unmaintained, you&apos;ll need to wait for support, contribute
        it, or replace the plugin &mdash; the same unmaintained-dependency risk that shows up in every
        native migration.
      </p>

      <Callout>
        <p>
          Migrate on a branch and keep the CocoaPods setup until the SPM build is fully green in CI. This
          is a change you want to be able to back out of cleanly if a plugin surprises you.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/upgrade-capacitor-7-to-8">upgrading Capacitor 7 to 8</A> since the SPM move
        often rides along with a major bump, and <A href="/docs/ci">CI automation</A> for keeping the iOS
        build reproducible.
      </p>
    </BlogArticle>
  );
}
