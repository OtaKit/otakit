import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('how-often-should-you-release-a-mobile-app')!;

export const metadata = blogPostMetadata(post.slug);

export default function ReleaseCadencePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Web teams deploy many times a day. Mobile teams usually release every one to four weeks.
        The gap is not about discipline; it is about friction. Every mobile release goes through
        store review, rolls out over days, and then waits for users to actually install it. So how
        often should you release?
      </p>
      <p>
        The short answer: release the native app on a steady, predictable schedule, and ship
        everything that does not need a new binary on a separate, faster track. This guide explains
        why, and how to set both up.
      </p>

      <h2>What limits mobile release speed</h2>
      <DataTable
        headers={['Step', 'Typical time', 'Can you speed it up?']}
        rows={[
          ['Build, sign and upload', 'Minutes to an hour', 'Yes, with CI'],
          [
            'App Store review',
            'Apple says most submissions are reviewed within 24 hours; rejections add days',
            'Only by avoiding rejections',
          ],
          ['Google Play review', 'Hours to several days, longer for new apps', 'Not really'],
          [
            'Phased rollout',
            'Apple’s phased release takes 7 days; Play staged rollouts are manual',
            'Yes, but rolling out fast is riskier',
          ],
          [
            'Users installing the update',
            'Days to weeks; some users never update',
            'Only with forced update prompts',
          ],
        ]}
      />
      <p>
        The last row is the one people forget. Even if review were instant, a release reaches most
        active users only after a week or more of automatic updates. A bug fix that ships on Monday
        is still on many phones the following Monday.
      </p>

      <h2>Common cadences and when they fit</h2>
      <ul>
        <li>
          <strong>Weekly.</strong> Used by large teams with release trains: whatever is merged by
          the cut-off ships. Great for momentum, but review and QA overhead is paid every week.
        </li>
        <li>
          <strong>Every two weeks.</strong> The most common choice. Enough time for meaningful
          changes and a proper QA pass, frequent enough that users see steady improvement.
        </li>
        <li>
          <strong>Monthly or slower.</strong> Fine for mature apps with little native change, or
          for regulated industries with heavy sign-off. Painful when something breaks.
        </li>
        <li>
          <strong>Whenever something is ready.</strong> Works for tiny teams, but unpredictable
          releases make QA, marketing and support harder to plan.
        </li>
      </ul>
      <p>
        Whatever you choose, <strong>consistency</strong> matters more than frequency. A predictable
        schedule lets everyone plan, and keeps each release small enough to test properly.
      </p>

      <h2>The two-track model</h2>
      <p>
        In a Capacitor app, a release is two different things: the native shell (Swift, Kotlin,
        plugins, permissions) and the web layer (your UI and business logic). They change at very
        different rates, so give them different tracks.
      </p>
      <DataTable
        headers={['', 'Native track', 'Web track (OTA)']}
        rows={[
          ['What ships', 'Plugins, permissions, Capacitor upgrades, SDK updates', 'Screens, copy, styles, logic, fixes'],
          ['Cadence', 'Every 2–4 weeks, or only when needed', 'Daily, or on every merge'],
          ['Goes through review', 'Yes', 'No, within store rules'],
          ['Reaches active users', 'Over days to weeks', 'On their next app launch'],
          ['Rollback', 'Submit another build', 'Re-release the previous bundle'],
        ]}
      />
      <p>
        Many teams find that most of their changes are on the web track. The native release then
        becomes a small, calm event: fewer changes, less risk, easier review.
      </p>
      <p>
        This is within the rules on both stores, as long as over-the-air updates change the web
        content rather than the purpose of the app. See{' '}
        <A href="/blog/ota-policies-for-app-store-and-google-play">
          OTA policies for the App Store and Google Play
        </A>
        .
      </p>

      <h2>Setting up the web track</h2>
      <p>
        With <A href="/">OtaKit</A>, the web track is one command after your normal build. A
        reasonable setup:
      </p>
      <Pre>{`# on every merge to main: release to internal testers
npm run build
npx @otakit/cli upload --release staging

# when staging looks good: promote the same bundle to everyone
npx @otakit/cli release <bundleId> --channel production`}</Pre>
      <p>
        Put both in CI and the web track runs itself. See{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">
          automating OTA releases with GitHub Actions
        </A>
        .
      </p>

      <h2>Hotfixes: the case for a fast track</h2>
      <p>
        The strongest argument for a separate web track is not speed on a normal day. It is the bad
        day. When a release breaks checkout, a store hotfix takes review time plus days of user
        adoption. An OTA fix reaches active users within hours, and with{' '}
        <Code>--force-immediate</Code> devices apply it on their next check instead of their next
        launch.
      </p>
      <Callout>
        <p>
          <strong>Keep the emergency path rare.</strong> Force-immediate reloads the app for users
          in the middle of what they are doing. Use it for broken payments and data loss, not for a
          typo. See <A href="/blog/deploy-hotfixes-capacitor-ota">deploying hotfixes over the air</A>
          .
        </p>
      </Callout>

      <h2>A cadence that works for most teams</h2>
      <ol>
        <li>
          <strong>Native release every two to four weeks</strong>, on a fixed day, only if native
          code changed. Use Apple&apos;s phased release and Play&apos;s staged rollout.
        </li>
        <li>
          <strong>Web releases continuously</strong>, to staging on every merge and to production
          once or several times a week.
        </li>
        <li>
          <strong>Staged rollouts for large web changes</strong>, so a problem reaches a few users
          before everyone. See{' '}
          <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>.
        </li>
        <li>
          <strong>A written hotfix procedure</strong>, so nobody improvises during an incident.
        </li>
      </ol>
      <p>
        You end up with the calm of a predictable native schedule and the speed of web deployment.
        OtaKit has a free tier, so you can add the web track to your next release and compare.
      </p>
    </BlogArticle>
  );
}
