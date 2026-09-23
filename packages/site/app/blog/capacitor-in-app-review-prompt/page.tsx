import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-in-app-review-prompt')!;

export const metadata = blogPostMetadata(post.slug);

export default function CapacitorInAppReviewPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Ratings decide more than people think. They affect where your app ranks in search, whether a
        visitor installs it, and how much your paid acquisition costs. Most happy users never rate an
        app on their own. Unhappy ones do. The native in-app review prompt is the simplest way to
        fix that imbalance, and in a Capacitor app it takes one plugin and one function call.
      </p>
      <p>
        The hard part is not the code. It is asking at the right moment, within the limits Apple and
        Google enforce.
      </p>

      <h2>1. Install the plugin</h2>
      <p>
        The community plugin wraps <Code>SKStoreReviewController</Code> on iOS and the Play In-App
        Review API on Android:
      </p>
      <Pre>{`npm install @capacitor-community/in-app-review
npx cap sync`}</Pre>
      <p>
        This is native code, so it has to be in a store build before you can call it. Add it in your
        next release even if you plan to turn the prompt on later.
      </p>

      <h2>2. Request a review</h2>
      <Pre>{`import { InAppReview } from '@capacitor-community/in-app-review';

export async function askForReview() {
  try {
    await InAppReview.requestReview();
  } catch {
    // The prompt is best-effort. Never block the user on it.
  }
}`}</Pre>
      <p>
        That is the whole API. You ask; the operating system decides whether to show anything.
      </p>

      <h2>The rules you cannot change</h2>
      <DataTable
        headers={['', 'iOS (App Store)', 'Android (Google Play)']}
        rows={[
          [
            'How often it can show',
            'At most 3 times per user in 365 days',
            'A time-bound quota Google does not publish',
          ],
          [
            'Do you know if it showed?',
            'No',
            'No',
          ],
          [
            'Do you know what the user rated?',
            'No',
            'No',
          ],
          [
            'Custom rating prompts',
            'Apple requires the system API for ratings prompts in the app',
            'Allowed, but you cannot incentivize or filter ratings',
          ],
        ]}
      />
      <p>
        Two consequences. First, every request is precious; spending one on launch number three is a
        waste. Second, you cannot build a &ldquo;how would you rate us?&rdquo; screen that sends
        five-star users to the store and everyone else to a feedback form. Both stores prohibit
        steering or incentivizing reviews.
      </p>

      <h2>When to ask</h2>
      <p>
        Ask right after the user gets value, never in the middle of a task, and never on first
        launch. Good moments are specific to your app:
      </p>
      <ul>
        <li>A workout is logged, an order is delivered, a document is exported.</li>
        <li>The user completes a streak or a milestone.</li>
        <li>A support conversation is marked as resolved.</li>
        <li>The third or fifth successful session in a week.</li>
      </ul>
      <p>And never:</p>
      <ul>
        <li>Right after an error, a crash or a failed payment.</li>
        <li>While a form is half filled in or a video is playing.</li>
        <li>Straight after an update that changed something users complained about.</li>
      </ul>
      <p>A small gate keeps the prompt honest:</p>
      <Pre>{`import { Preferences } from '@capacitor/preferences';

const MIN_SUCCESS_EVENTS = 3;
const MIN_DAYS_BETWEEN_ASKS = 90;

export async function maybeAskForReview() {
  const { value } = await Preferences.get({ key: 'review' });
  const state = value ? JSON.parse(value) : { successes: 0, lastAsked: 0 };

  state.successes += 1;
  const daysSince = (Date.now() - state.lastAsked) / 86_400_000;

  if (state.successes >= MIN_SUCCESS_EVENTS && daysSince >= MIN_DAYS_BETWEEN_ASKS) {
    state.lastAsked = Date.now();
    state.successes = 0;
    await askForReview();
  }

  await Preferences.set({ key: 'review', value: JSON.stringify(state) });
}`}</Pre>
      <p>
        Call <Code>maybeAskForReview()</Code> from your success moments, not from app startup.
      </p>

      <h2>Testing it</h2>
      <ul>
        <li>
          <strong>iOS:</strong> in development builds the prompt always appears, but submitting does
          nothing. In TestFlight it never appears. Test the trigger logic in development and trust
          the system in production.
        </li>
        <li>
          <strong>Android:</strong> the review flow only works for apps installed from Google Play.
          Use an internal testing track or internal app sharing. The quota also applies while
          testing, so a prompt that showed once may not show again.
        </li>
      </ul>

      <h2>Tune the timing without a store release</h2>
      <p>
        The plugin is native. The decision of <em>when</em> to ask is not; it is plain TypeScript in
        your web bundle. That is exactly the part you will want to change once you see how ratings
        move: a different success event, a longer delay, a new exclusion after a bad release.
      </p>
      <p>
        With <A href="/">OtaKit</A>, those changes ship over the air. Adjust the thresholds, build,
        and release; users get the new logic on their next launch. You can even pause the prompt
        entirely within minutes after a rough release, which protects your rating when it is most
        exposed.
      </p>

      <Callout>
        <p>
          <strong>Ratings and release quality go together.</strong> The fastest way to lose stars is
          a bug that sits in production for a week while a fix waits in review. See{' '}
          <A href="/blog/deploy-hotfixes-capacitor-ota">deploying hotfixes over the air</A> and{' '}
          <A href="/blog/capacitor-ota-rollback-strategies">rollback strategies</A>.
        </p>
      </Callout>
    </BlogArticle>
  );
}
