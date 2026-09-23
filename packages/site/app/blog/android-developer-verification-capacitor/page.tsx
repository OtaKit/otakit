import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('android-developer-verification-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function AndroidDeveloperVerificationPage() {
  return (
    <BlogArticle post={post}>
      <p>
        On <strong>30 September 2026</strong>, Google starts enforcing Android developer
        verification. Certified Android devices in <strong>Brazil, Indonesia, Singapore and
        Thailand</strong> will block the normal install of any app whose developer has not
        registered with Google. That includes apps from Google Play and from the big OEM stores:
        Samsung Galaxy Store, Xiaomi GetApps, OPPO, vivo, HONOR and Transsion&apos;s Palm Store.
      </p>
      <p>
        The rest of the world follows in 2027. If you have users in those four countries, or
        testers who install builds outside the Play Store, you have one week.
      </p>

      <Callout>
        <p>
          <strong>The common miss:</strong> teams verify their production app and forget the other
          package names: the staging build, the white-label variant, the QA APK sent to a tester in
          São Paulo. Each package name is an app, and each needs to be registered.
        </p>
      </Callout>

      <h2>What verification requires</h2>
      <p>According to Google&apos;s published requirements:</p>
      <ul>
        <li>
          <strong>Identity.</strong> A legal name, address and contact details, and in some cases an
          uploaded government ID.
        </li>
        <li>
          <strong>Proof that you own each app.</strong> You register each package name and prove
          ownership by submitting an APK signed with your private key.
        </li>
        <li>
          <strong>A fee for standard accounts.</strong> The standard account has a one-time $25 fee.
          A free limited-distribution account for students and hobbyists lets you share an app with
          up to 20 devices without a government ID.
        </li>
      </ul>
      <p>
        Unregistered apps can still be installed over ADB, or through an &ldquo;advanced
        flow&rdquo; that makes the user enable developer mode, restart, wait 24 hours and
        authenticate again. That is fine for you at your desk. It is not a way to distribute an app
        to customers.
      </p>

      <h2>Who is affected</h2>
      <DataTable
        headers={['Situation', 'Affected on 30 September?', 'What to do']}
        rows={[
          [
            'Production app on Google Play, users in BR/ID/SG/TH',
            'Yes',
            'Confirm your account and the package name are verified and registered',
          ],
          [
            'Separate staging or beta package (com.acme.app.staging)',
            'Yes, if installed on certified devices in those countries',
            'Register it too, or retire it (see below)',
          ],
          [
            'White-label builds with one package name per customer',
            'Yes, every package',
            'Register each package name, or ask customers to publish under their own verified account',
          ],
          [
            'APKs shared via Firebase App Distribution, email or a download link',
            'Yes',
            'Register the package; testers otherwise hit the advanced flow',
          ],
          [
            'Debug builds you install with Android Studio or ADB',
            'No',
            'Nothing',
          ],
          ['Users outside the four launch countries', 'Not yet (2027)', 'Do it now anyway'],
        ]}
      />

      <h2>A checklist for Capacitor teams</h2>
      <ol>
        <li>
          <strong>List every package name you have ever shipped.</strong> In a Capacitor app it lives
          in <Code>capacitor.config.ts</Code> as <Code>appId</Code> and in{' '}
          <Code>android/app/build.gradle</Code> as <Code>applicationId</Code>. Check for build
          flavors and <Code>applicationIdSuffix</Code>, which silently create extra packages:
        </li>
      </ol>
      <Pre>{`grep -rn "applicationId" android/app/build.gradle
grep -n "appId" capacitor.config.*`}</Pre>
      <ol start={2}>
        <li>
          <strong>Check verification status for your developer account</strong> in the Play Console
          or the Android Developer Console, and complete any open identity steps. Identity checks
          can take days, so start today.
        </li>
        <li>
          <strong>Register each package name</strong> and complete the ownership proof with an APK
          signed by the key that signs that app.
        </li>
        <li>
          <strong>Confirm who holds the keys.</strong> If a contractor or an old CI system signs your
          staging builds, find that keystore now. Losing it later means a new package name.
        </li>
        <li>
          <strong>Tell testers in the four countries</strong> what to expect if a build they rely on
          is not registered by the 30th.
        </li>
      </ol>

      <h2>Fewer packages, less to verify</h2>
      <p>
        Many Capacitor teams keep a second app ID for staging because it was the only way to have
        staging and production installed side by side. Verification makes every extra package name
        a small ongoing cost: another registration, another keystore, another thing to keep in
        order.
      </p>
      <p>
        For most staging needs, you do not need a second package at all. The native shell rarely
        changes between staging and production. What changes is the web layer, and that can be
        switched with an update channel inside the same verified app:
      </p>
      <Pre>{`// capacitor.config.ts in your internal build
plugins: {
  OtaKit: {
    appId: 'YOUR_OTAKIT_APP_ID',
    channel: 'staging',
  },
},`}</Pre>
      <p>
        Internal testers install the same app from an internal Play testing track, and receive
        staging bundles over the air. Production users on the base channel never see them. You can
        also switch channels at runtime with <Code>setChannel()</Code>, for example from a hidden
        developer menu. See{' '}
        <A href="/blog/staging-environments-capacitor-channels">
          staging environments with channels
        </A>{' '}
        for the full setup.
      </p>

      <h2>Does verification affect OTA updates?</h2>
      <p>
        No. Verification controls which apps can be <em>installed</em>. An over-the-air update with{' '}
        <A href="/">OtaKit</A> replaces the web assets inside an app that is already installed and
        registered; it does not install a new APK. Your OTA releases keep working the same way on 1
        October as on 29 September.
      </p>
      <p>
        It is still worth using the week to put both in order. A verified package, a single app ID
        per product, and channels for everything else is a setup that survives the global rollout
        in 2027 without another scramble.
      </p>
    </BlogArticle>
  );
}
