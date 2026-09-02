import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-9-what-changes')!;

export const metadata = blogPostMetadata(post.slug);

export default function Capacitor9Page() {
  return (
    <BlogArticle post={post}>
      <p>
        Capacitor 9 has been in alpha since May 2026, and Ionic&apos;s{' '}
        <A href="https://ionic.io/blog/the-road-to-capacitor-9">road map post of 28 August</A>{' '}
        forecasts general availability for the <strong>end of November 2026</strong>. That is close
        enough to plan around, and the preparation worth doing is mostly work you should be doing
        anyway.
      </p>
      <p>This is the short version of what changes, what breaks, and the order to do it in.</p>

      <h2>What changes</h2>

      <h3>Cordova becomes optional</h3>
      <p>
        The Cordova compatibility layer is no longer pulled into every build; it is included only
        when you need it. For an app with no Cordova plugins left, that is dead weight removed from
        the binary and one less source of build noise. For an app still leaning on Cordova plugins,
        nothing is taken away &mdash; but this is a good moment to count how many you have. See{' '}
        <A href="/blog/migrate-cordova-to-capacitor">migrating from Cordova to Capacitor</A>.
      </p>

      <h3>The iOS runtime is now Swift</h3>
      <p>
        The remaining Objective-C in Capacitor&apos;s iOS implementation has been converted to
        Swift. Most apps will never notice. Plugin authors will: if you have a plugin that reaches
        into Capacitor&apos;s internals from Objective-C, that assumption is gone.
      </p>

      <h3>No more XCFramework distribution</h3>
      <p>
        Capacitor will no longer be distributed as an XCFramework, and plugin authors need to run
        Ionic&apos;s migration tooling so that Capacitor is pulled in correctly. If you maintain a
        public plugin, this is the item to schedule before GA &mdash; the apps depending on you
        cannot upgrade until you have.
      </p>

      <h3>Foldables and windowed apps</h3>
      <p>
        Multi-instance and windowed support is on the list, which matters more than it used to:
        Android 16 leaned hard into large-screen and desktop-style windowing, and an app that
        assumes exactly one resizable-by-accident window looks broken on the hardware shipping now.
      </p>

      <h2>The deadline hiding inside this: CocoaPods</h2>
      <p>
        The single most time-sensitive item is not in Capacitor 9 at all. CocoaPods Trunk goes{' '}
        <strong>permanently read-only on 2 December 2026</strong>, with a dry run from{' '}
        <strong>1&ndash;7 November</strong>. After that date no new pod versions can be published
        and the specs repository is archived.
      </p>
      <p>
        To be precise about the blast radius, because the internet has been overstating it: existing
        builds keep resolving. The specs repo and CDN stay up. Nothing you have already shipped
        stops working. What ends is <em>publication</em> &mdash; which means every dependency you
        rely on stops receiving updates through that channel, and the ecosystem drifts to Swift
        Package Manager whether or not you move with it.
      </p>

      <Callout>
        <p>
          Capacitor 8 already defaults new iOS projects to SPM, and Ionic&apos;s advice is blunt: if
          you have not migrated, now is the time. Our{' '}
          <A href="/blog/capacitor-spm-migration">SPM migration guide</A> walks the actual steps.
          Doing it before the Capacitor 9 upgrade means debugging one change at a time instead of
          two.
        </p>
      </Callout>

      <h2>Trying the alpha</h2>
      <p>
        Alphas install from the <Code>next</Code> tag. Peer ranges will not be satisfied yet, hence
        the flag:
      </p>
      <Pre>{`npm install @capacitor/core@next @capacitor/ios@next @capacitor/android@next --legacy-peer-deps
npm install --save-dev @capacitor/cli@next --legacy-peer-deps`}</Pre>
      <p>
        Do this on a branch, in a copy of a real app rather than a fresh template &mdash; the value
        of an alpha report is the plugin combination nobody on the core team has. Ionic is asking
        for three configurations in particular: Capacitor-only, mixed Capacitor and Cordova, and
        Cordova-only.
      </p>

      <h2>The order to do this in</h2>
      <DataTable
        headers={['When', 'Do this', 'Why this order']}
        rows={[
          [
            'Now',
            'Upgrade to Capacitor 8.5+ and migrate to UIScene',
            'Required to build with the iOS 27 SDK at all; unrelated to Capacitor 9, and urgent on its own',
          ],
          [
            'Now',
            'Move iOS dependencies from CocoaPods to SPM',
            'Trunk is read-only from 2 December 2026, and Capacitor 9 assumes SPM',
          ],
          [
            'October',
            'Audit Cordova plugins and native plugin versions',
            'Decides whether the Cordova layer can be dropped, and which plugins block the upgrade',
          ],
          [
            'Before GA',
            'Run the alpha against a real app on a branch',
            'Finding a plugin incompatibility in November is cheaper than in December',
          ],
          [
            'After GA',
            'Upgrade, ship to a staging channel, then production',
            'A major native upgrade deserves a staged rollout, not a straight release',
          ],
        ]}
      />

      <h2>What over-the-air updates do and do not cover</h2>
      <p>
        A Capacitor major is a native upgrade: new binary, store review, staged release. No
        live-update tool changes that, and any that claims to should be read carefully.
      </p>
      <Callout>
        <p>
          Where <A href="/">OtaKit</A> helps is the fallout. After a native upgrade, the bugs that
          surface in the first 48 hours are overwhelmingly web-layer &mdash; a plugin API that
          returns a slightly different shape, a race that only appears on a faster startup path.
          Those ship over the air in minutes. Pin the update to the new native version with{' '}
          <A href="/docs/channels">runtime version and channels</A> so devices on the old binary
          never receive a bundle that assumes the new one, and keep{' '}
          <A href="/blog/capacitor-ota-rollback-strategies">automatic rollback</A> armed while the
          rollout is young.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        <A href="/blog/upgrade-capacitor-7-to-8">Upgrading Capacitor 7 to 8</A> is the closest map
        to what a major upgrade actually costs, and{' '}
        <A href="/blog/ios-27-uiscene-capacitor">the iOS 27 UIScene migration</A> is the piece to
        clear first.
      </p>
    </BlogArticle>
  );
}
