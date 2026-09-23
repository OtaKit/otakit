import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('ios-27-sdk-requirement-april-2027')!;

export const metadata = blogPostMetadata(post.slug);

export default function Ios27SdkRequirementPage() {
  return (
    <BlogArticle post={post}>
      <p>
        On 9 September, when App Store submissions opened for iOS 27, Apple also set the next
        deadline: <strong>starting April 2027</strong>, iOS and iPadOS apps uploaded to App Store
        Connect must be built with the <strong>iOS 27 SDK or later</strong>. In the same notice,
        Apple confirmed that macOS 27 is Apple silicon only.
      </p>
      <p>
        For a Capacitor app, those two lines add up to three pieces of work: Xcode 27, an Apple
        silicon Mac to run it, and the UIScene migration that the iOS 27 SDK requires. None is hard.
        All three are easier in October than in March.
      </p>

      <h2>What the requirement means</h2>
      <p>
        The rule is about how the app is built, not which iOS versions it supports. You can keep
        your deployment target where it is and still support older iPhones. What changes is that
        after April 2027, you cannot upload a new build made with Xcode 26.
      </p>
      <p>
        Apps already on the App Store are not removed. The deadline hits the next time you need to
        ship a native update, which is often at the worst moment: a store-mandated fix, a plugin
        security patch, a payment SDK update.
      </p>

      <h2>Three things you need</h2>
      <DataTable
        headers={['Requirement', 'Why', 'What to do']}
        rows={[
          [
            'Xcode 27',
            'The iOS 27 SDK ships with Xcode 27',
            'Install Xcode 27 alongside Xcode 26 and build a branch with it',
          ],
          [
            'An Apple silicon Mac',
            'Current Xcode releases run only on Apple silicon; macOS 27 drops Intel entirely',
            'Replace Intel build machines, or use Apple silicon CI runners or a cloud Mac',
          ],
          [
            'UIScene lifecycle',
            'Apps built against the iOS 27 SDK must adopt scenes',
            'Upgrade to Capacitor 8.5 and run npx cap migrate',
          ],
        ]}
      />

      <h2>The UIScene migration</h2>
      <p>
        This is the only code change, and for most apps it is small. Capacitor 8.5 moves the iOS
        template to the scene-based lifecycle:
      </p>
      <Pre>{`npm install @capacitor/core@^8.5 @capacitor/cli@^8.5 @capacitor/ios@^8.5
npx cap migrate
npx cap sync ios`}</Pre>
      <p>
        Where it goes wrong is custom code in <Code>AppDelegate.swift</Code> that expects app-level
        callbacks for URLs, window setup or state restoration, and older plugins that assume a
        single <Code>UIWindow</Code>. We covered the details in{' '}
        <A href="/blog/ios-27-uiscene-capacitor">iOS 27, UIScene and Capacitor</A>.
      </p>

      <h2>If your build machine is an Intel Mac</h2>
      <p>
        This is where teams get caught. An Intel Mac that builds your app fine today cannot run the
        Xcode that the April deadline needs. Options, roughly by effort:
      </p>
      <ul>
        <li>
          <strong>CI with Apple silicon runners.</strong> GitHub Actions, Codemagic, Bitrise and
          Xcode Cloud all offer them. See{' '}
          <A href="/blog/best-ci-cd-platforms-for-capacitor-apps">
            the best CI/CD platforms for Capacitor
          </A>
          .
        </li>
        <li>
          <strong>A cloud Mac by the hour</strong> for the occasional native build and debugging
          session. See{' '}
          <A href="/blog/build-capacitor-ios-app-on-cloud-mac">
            building a Capacitor iOS app on a cloud Mac
          </A>
          .
        </li>
        <li>
          <strong>A new Mac.</strong> Worth it if you do native work every week.
        </li>
      </ul>

      <h2>A timeline that avoids the rush</h2>
      <DataTable
        headers={['When', 'Step']}
        rows={[
          ['October 2026', 'Upgrade to Capacitor 8.5, build with Xcode 27 on a branch, fix plugin issues'],
          ['November 2026', 'Ship the Xcode 27 build to TestFlight and then to the App Store'],
          ['Late November 2026', 'Capacitor 9 is expected; plan it as a separate release'],
          ['Early 2027', 'Retire Intel build machines and Xcode 26 from CI'],
          ['April 2027', 'Deadline: nothing to do if the steps above are done'],
        ]}
      />

      <Callout>
        <p>
          <strong>Ship the migration early for one practical reason:</strong> after the new native
          shell is live, you can keep shipping everything else as web updates, without touching Xcode
          again until the next native change.
        </p>
      </Callout>

      <h2>Keep OTA bundles matched to the new shell</h2>
      <p>
        A native release that changes Capacitor&apos;s version or your plugin set is a new runtime.
        Old web bundles built for the previous shell should not be applied to it, and new bundles
        that rely on the new shell should not reach users still on the old one.
      </p>
      <p>
        With <A href="/">OtaKit</A>, bump <Code>runtimeVersion</Code> in the plugin config in the
        same commit as the Capacitor 8.5 upgrade:
      </p>
      <Pre>{`plugins: {
  OtaKit: {
    appId: 'YOUR_OTAKIT_APP_ID',
    runtimeVersion: '2026.10',
  },
},`}</Pre>
      <p>
        Users on the old store build keep receiving bundles for the old runtime. Users who update
        from the App Store move to the new lane on first launch. The CLI also checks native plugin
        compatibility on upload, so a bundle that needs a newer shell does not reach one that cannot
        run it. See <A href="/docs/channels">channels and runtime version</A>.
      </p>
    </BlogArticle>
  );
}
