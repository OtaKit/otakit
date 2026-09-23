import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('google-play-app-optimization-below-threshold-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function PlayOptimizationThresholdPage() {
  return (
    <BlogArticle post={post}>
      <p>
        If you uploaded a Capacitor app to Google Play recently, you may have seen this in the app
        bundle explorer: <strong>&ldquo;App optimization is below our threshold&rdquo;</strong>,
        often with an obfuscation score of 1% to 5%. It is a warning today. From{' '}
        <strong>February 2027</strong> it becomes one of Play&apos;s technical quality requirements,
        and Google says missing it can affect your app&apos;s visibility and publishing
        capabilities.
      </p>
      <p>
        The fix is a few lines of Gradle. The risk is shipping it without testing, because it
        changes how your native code is compiled. Here is the full process.
      </p>

      <h2>What Google requires</h2>
      <p>From Play Console&apos;s technical quality requirements:</p>
      <ul>
        <li>
          At least <strong>25% obfuscation, 25% optimization and 25% shrinking</strong>, each measured
          separately, for app uploads.
        </li>
        <li>
          It applies only when DEX code is non-negligible: over <strong>10 MB</strong> for apps and
          over 50 MB for games.
        </li>
        <li>You can use R8 or any other shrinker.</li>
        <li>
          Scores for each uploaded bundle are shown in the app bundle explorer. With Android Gradle
          Plugin 8.10 or later, R8 also writes a report Play reads, so you can check locally.
        </li>
      </ul>
      <p>
        DEX is your compiled Java and Kotlin: Capacitor, its plugins, Firebase and every other
        Android library. Your web bundle is not DEX; it lives in <Code>assets/</Code> and does not
        count. A small Capacitor app may be under 10 MB of DEX and out of scope. Add Firebase, a
        couple of SDKs for analytics and payments, and you are over.
      </p>

      <h2>Why Capacitor apps fail it</h2>
      <p>
        The Capacitor Android template ships release builds with <Code>minifyEnabled false</Code>.
        R8 never runs, so nothing is renamed, optimized or removed, and the scores sit near zero.
        Turning R8 on is the whole fix.
      </p>

      <h2>Step 1: enable R8 for release builds</h2>
      <p>
        In <Code>android/app/build.gradle</Code>:
      </p>
      <Pre>{`android {
    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'),
                'proguard-rules.pro'
        }
    }
}`}</Pre>
      <p>
        Use <Code>proguard-android-optimize.txt</Code>. The older{' '}
        <Code>proguard-android.txt</Code> contains <Code>-dontoptimize</Code>, which keeps your
        optimization score low.
      </p>

      <h2>Step 2: remove anything that switches R8 off</h2>
      <p>Search your project for flags someone added to silence a crash years ago:</p>
      <Pre>{`grep -rn "dontobfuscate\\|dontoptimize\\|dontshrink" android/
grep -rn "keep class \\*\\*" android/
grep -n "enableR8" android/gradle.properties`}</Pre>
      <p>
        Delete <Code>-dontobfuscate</Code>, <Code>-dontoptimize</Code>, <Code>-dontshrink</Code>,
        blanket rules like <Code>-keep class ** {'{ *; }'}</Code>, and{' '}
        <Code>android.enableR8.fullMode=false</Code>. Any one of them can hold a score under 25% on
        its own. Note that a library can also ship these flags in its own consumer rules; if a score
        stays low after your changes, check the merged configuration R8 prints with{' '}
        <Code>-printconfiguration</Code>.
      </p>

      <h2>Step 3: keep only what needs keeping</h2>
      <p>
        Capacitor and its official plugins ship their own consumer R8 rules, so the bridge and{' '}
        <Code>@CapacitorPlugin</Code> classes survive minification. You usually need rules only for:
      </p>
      <ul>
        <li>Local plugins you wrote inside the app, if they fail after minification.</li>
        <li>Classes loaded by reflection or JSON mapping (Gson models, for example).</li>
        <li>Third-party SDKs whose documentation asks for rules.</li>
      </ul>
      <Pre>{`# android/app/proguard-rules.pro

# A local plugin in your app module
-keep class com.acme.app.plugins.** { *; }

# Models serialized by name with Gson
-keep class com.acme.app.models.** { *; }`}</Pre>
      <p>
        Keep rules narrow. <Code>-keep class com.getcapacitor.** {'{ *; }'}</Code> feels safe but
        works against the scores you are trying to raise.
      </p>

      <h2>Step 4: build, then test the release build on a device</h2>
      <Pre>{`npm run build
npx cap sync android
cd android && ./gradlew bundleRelease`}</Pre>
      <p>
        R8 writes <Code>app/build/outputs/mapping/release/mapping.txt</Code>. If that file exists, R8
        ran. Now install a release build (not debug) on a real device and go through every screen
        that calls a native plugin: camera, push, file system, sign-in, purchases. R8 problems show
        up as crashes or silent failures in native calls, never in the web layer.
      </p>

      <h2>Step 5: upload the mapping file</h2>
      <p>
        With obfuscation on, native stack traces are unreadable without <Code>mapping.txt</Code>.
        Play Console picks it up from the bundle in most setups; confirm it under the bundle&apos;s
        assets in the app bundle explorer. If you use Crashlytics or Sentry, upload it there as part
        of CI too.
      </p>

      <h2>Step 6: roll out gradually</h2>
      <p>
        Upload to the internal testing track, check the three scores in the app bundle explorer,
        then release to production with a staged rollout starting at a small percentage. Watch
        Android vitals for new crashes before going wide.
      </p>

      <Callout>
        <p>
          <strong>Why the staged rollout matters here:</strong> an R8 mistake is a native bug, so it
          cannot be fixed with a web update. The only fix is another store build. A 5% rollout keeps
          the damage small while you wait for review.
        </p>
      </Callout>

      <h2>The other February 2027 requirements</h2>
      <p>Play announced more technical quality requirements alongside this one:</p>
      <DataTable
        headers={['Requirement', 'Date', 'Relevance for Capacitor apps']}
        rows={[
          [
            '25% obfuscation, optimization and shrinking (DEX over 10 MB)',
            'February 2027',
            'Fixed by enabling R8 as above',
          ],
          [
            'Memory: anonymous RSS + swap and bitmap memory thresholds at the 90th percentile',
            'February 2027',
            'WebView apps with large images or long-lived pages should check Android vitals',
          ],
          [
            'Restore Credentials API for sign-in apps when users move to a new device',
            'April 2027',
            'Block Store integrations completed on or before 30 September 2026 count as compliant',
          ],
        ]}
      />
      <p>
        The memory requirement is the one to watch for WebView apps. Much of that is web-side work
        (image sizes, unbounded lists, caches that never clear), and those fixes can ship over the
        air. See the <A href="/blog/capacitor-performance-checklist">Capacitor performance checklist</A>.
      </p>

      <h2>Keep native releases rare and safe</h2>
      <p>
        Turning on R8 is a one-time native change. Most of what you ship afterwards does not need
        to touch it. With <A href="/">OtaKit</A>, web changes go to users without a new store build,
        so the Android binary changes only when native code does, and each of those releases gets
        the careful rollout it deserves.
      </p>
      <p>
        When you do ship the R8 build, bump <Code>runtimeVersion</Code> if the native plugin set
        changed, so older OTA bundles are never applied to the new shell. See{' '}
        <A href="/docs/channels">channels and runtime version</A>.
      </p>
    </BlogArticle>
  );
}
