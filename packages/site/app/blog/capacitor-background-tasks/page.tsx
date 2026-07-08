import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-background-tasks')!;

export const metadata = blogPostMetadata(post.slug);

export default function BackgroundTasksPage() {
  return (
    <BlogArticle post={post}>
      <p>
        &ldquo;Can my Capacitor app do work in the background?&rdquo; has a nuanced answer: yes, but far
        less freely than you&apos;d hope, because iOS and Android both aggressively limit background
        execution to protect battery. This guide explains what&apos;s actually possible, how to run
        background fetch and short tasks within the OS rules, and how to check for an <A href="/">OTA
        update</A> at the right moments.
      </p>

      <Callout>
        <p>
          Reset your expectations first: mobile background execution is not a server. You get brief,
          OS-scheduled windows &mdash; not a long-running loop. Design for &ldquo;do a little, quickly,
          when the OS lets me,&rdquo; not &ldquo;run continuously.&rdquo;
        </p>
      </Callout>

      <h2>What the platforms allow</h2>
      <ul>
        <li>
          <strong>Background fetch</strong> &mdash; periodic, OS-scheduled wake-ups to refresh data.
          Frequency is the OS&apos;s call, not yours.
        </li>
        <li>
          <strong>Finish-on-suspend tasks</strong> &mdash; a short window to complete work when the app
          goes to the background (an upload, a save).
        </li>
        <li>
          <strong>Push-triggered work</strong> &mdash; a silent push can wake the app to do a small task.
        </li>
      </ul>
      <p>
        Anything resembling a persistent background service will be throttled or killed. Build around the
        windows the OS gives you.
      </p>

      <h2>Running a background task</h2>
      <p>
        Use a Capacitor background-task/runner plugin to register work and signal completion so the OS
        knows you&apos;re done and can suspend you cleanly:
      </p>
      <Pre>{`// on app pause, finish critical work in the granted window
App.addListener('pause', async () => {
  const taskId = await BackgroundTask.beforeExit(async () => {
    await flushPendingUploads();
    BackgroundTask.finish({ taskId });
  });
});`}</Pre>

      <h2>Check for updates on resume</h2>
      <p>
        A natural place to check for an OTA update is when the app returns to the foreground &mdash; the
        user is about to interact anyway. Trigger a check on resume so an available bundle is ready by the
        time they need it:
      </p>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-plugin';

App.addListener('resume', () => {
  OtaKit.check();
});`}</Pre>
      <p>
        See <A href="/docs/events">Events</A> and{' '}
        <A href="/blog/background-vs-foreground-app-updates">background vs foreground updates</A> for how
        this ties into your update UX.
      </p>

      <Callout>
        <p>
          Test background behavior on real devices with battery optimization enabled &mdash; the emulator
          is far more permissive than a real phone in low-power mode, so &ldquo;works in the
          emulator&rdquo; means little here.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/plugin">Plugin API</A> for <Code>check()</Code> and the update lifecycle, and{' '}
        <A href="/blog/capacitor-offline-support">offline support</A> for handling the no-network case.
      </p>
    </BlogArticle>
  );
}
