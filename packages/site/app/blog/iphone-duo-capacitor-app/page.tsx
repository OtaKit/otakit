import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('iphone-duo-capacitor-app')!;

export const metadata = blogPostMetadata(post.slug);

export default function IphoneDuoCapacitorPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Apple&apos;s first foldable, iPhone Duo, opens for pre-order on <strong>16 October</strong>{' '}
        and ships on <strong>23 October 2026</strong>. Xcode 27.1 beta, released on 18 September,
        adds the SDK and a simulator you can fold, unfold and rotate. That leaves app teams about a
        month.
      </p>
      <p>
        For a Capacitor app, this is mostly good news. Your UI is a web page, and web pages have
        handled resizing for thirty years. The work is finding the places where your app quietly
        assumed one phone-sized screen, fixing them in CSS and JavaScript, and making sure you can
        keep fixing them after launch day.
      </p>

      <Callout>
        <p>
          <strong>Short version:</strong> ship one store build made with Xcode 27.1 (and Capacitor
          8.5 for UIScene) before 23 October. Treat every layout issue found after that as a web
          change you can ship over the air the same day.
        </p>
      </Callout>

      <h2>What actually changes for a Capacitor app</h2>
      <p>
        iPhone Duo runs apps on a compact outer display and a much larger inner display, and the
        user can move between them while your app is open. Apple&apos;s guidance is to design for a
        continuous range of sizes rather than a fixed layout per pose. Apps that are not updated
        still run, but Apple says they may not properly fill the display.
      </p>
      <p>In a Capacitor app, the native side of this is small:</p>
      <ul>
        <li>
          The WKWebView resizes with the window. Your page receives a normal <Code>resize</Code>{' '}
          event and new viewport dimensions.
        </li>
        <li>
          Scene handling is native. Building with the iOS 27 SDK already requires the UIScene
          lifecycle, which <A href="/blog/ios-27-uiscene-capacitor">Capacitor 8.5 adds</A>. If you
          have not done that migration, it comes first.
        </li>
        <li>
          True multi-window support (two instances of your app side by side) is on the roadmap for{' '}
          <A href="/blog/capacitor-9-what-changes">Capacitor 9</A>, not Capacitor 8.
        </li>
      </ul>
      <p>
        Everything else lives in your web code. That is where the bugs will be.
      </p>

      <h2>The web code that breaks on a foldable</h2>
      <p>
        These patterns work on every phone until the screen changes size underneath a running app:
      </p>
      <DataTable
        headers={['Pattern', 'What goes wrong', 'Fix']}
        rows={[
          [
            'Reading window.innerWidth once at startup',
            'Layout decisions freeze at the size the app launched with',
            'Use CSS media or container queries, or listen for resize',
          ],
          [
            'Branching on orientation (portrait vs landscape)',
            'A large unfolded screen can be portrait and still have room for two columns',
            'Branch on available width, not orientation',
          ],
          [
            'Fixed pixel widths for sheets, modals and cards',
            'Content is stranded in a narrow column on the inner display',
            'Use max-width with fluid percentages or clamp()',
          ],
          [
            'Canvas, charts or maps sized once',
            'Blurry or cropped rendering after unfolding',
            'Observe the container with ResizeObserver and re-render',
          ],
          [
            'Hard-coded safe-area padding',
            'Controls under the camera area or rounded corners in some poses',
            'Use env(safe-area-inset-*) everywhere',
          ],
          [
            'Virtual lists with a fixed item count per screen',
            'Blank gaps or overdraw after the viewport grows',
            'Recalculate on resize or use a library that measures',
          ],
        ]}
      />

      <h2>Make the layout fluid</h2>
      <p>
        Start with the viewport. Capacitor&apos;s default <Code>index.html</Code> is usually fine,
        but confirm <Code>viewport-fit=cover</Code> is present so safe-area insets work:
      </p>
      <Pre>{`<meta
  name="viewport"
  content="width=device-width, initial-scale=1, viewport-fit=cover"
/>`}</Pre>
      <p>
        Then let width decide the layout. Container queries are supported in the WebKit that ships
        with current iOS, and they are the best fit for a screen that changes size: each component
        adapts to the space it has, not to the device.
      </p>
      <Pre>{`.inbox {
  container-type: inline-size;
}

.inbox__layout {
  display: grid;
  grid-template-columns: 1fr;
}

/* Two panes once there is room, whatever the device or pose */
@container (min-width: 700px) {
  .inbox__layout {
    grid-template-columns: minmax(280px, 360px) 1fr;
  }
}

.app-shell {
  padding:
    env(safe-area-inset-top)
    env(safe-area-inset-right)
    env(safe-area-inset-bottom)
    env(safe-area-inset-left);
}`}</Pre>
      <p>
        For anything drawn in JavaScript, react to size changes instead of reading them once:
      </p>
      <Pre>{`const chart = document.querySelector('#chart');

const observer = new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect;
  renderChart(chart, { width, height });
});

observer.observe(chart);`}</Pre>
      <p>
        One more: keep state across size changes. A fold or unfold should not reset a form, close a
        modal or scroll the list back to the top. If your router or framework remounts views on
        resize, fix that before worrying about pixels.
      </p>

      <h2>Test it in Xcode 27.1</h2>
      <p>
        Xcode 27.1 beta needs an Apple silicon Mac on macOS 26.6 or later. It includes an iPhone Duo
        simulator runtime that can fold, unfold and rotate. The first simulator boot can take several
        minutes, and most app extensions do not run in it yet.
      </p>
      <ol>
        <li>
          Build and run your app on the iPhone Duo simulator with{' '}
          <Code>npx cap run ios</Code> or from Xcode.
        </li>
        <li>Open each main screen, then fold and unfold with the screen open.</li>
        <li>
          Attach Safari&apos;s Web Inspector (Develop menu, then the simulator) and watch for layout
          shifts, console errors and resize handlers that fire too often.
        </li>
        <li>Rotate on both displays. Check the keyboard with a text field focused in each pose.</li>
        <li>Check modals, bottom sheets and anything positioned with fixed coordinates.</li>
      </ol>
      <p>
        No Apple silicon Mac? You can run the same steps on a{' '}
        <A href="/blog/build-capacitor-ios-app-on-cloud-mac">cloud Mac</A> and pull screenshots back.
      </p>

      <h2>After 23 October: fix layout bugs the same day</h2>
      <p>
        The simulator will not find everything. Real users will unfold the device in the middle of
        checkout, in split view, with accessibility text sizes you did not test. The bug reports
        will arrive in the first week, and they will almost all be CSS.
      </p>
      <p>
        Waiting for App Review for each of those fixes means a week of a broken first impression on
        a device whose owners are exactly the early adopters who leave reviews. With a live update
        system, a layout fix is a web build and one command:
      </p>
      <Pre>{`npm run build
npx @otakit/cli upload --release`}</Pre>
      <p>
        <A href="/">OtaKit</A> downloads the new bundle in the background and applies it on the next
        launch by default. If you want to test the fix on your own devices first, release it to a{' '}
        <A href="/blog/staging-environments-capacitor-channels">staging channel</A> and promote it
        once it looks right. This is well within Apple&apos;s rules: you are changing HTML, CSS and
        JavaScript, not the app&apos;s native code or purpose. See{' '}
        <A href="/blog/does-apple-allow-live-updates">does Apple allow live updates</A>.
      </p>

      <h2>A plan for the next four weeks</h2>
      <ol>
        <li>
          <strong>Now:</strong> migrate to Capacitor 8.5 if you have not, and build with Xcode 27.1
          beta.
        </li>
        <li>
          <strong>This week:</strong> run the table above against your codebase. Search for{' '}
          <Code>innerWidth</Code>, <Code>orientation</Code>, <Code>screen.width</Code> and fixed{' '}
          <Code>px</Code> widths on containers.
        </li>
        <li>
          <strong>Before the Xcode 27.1 release candidate:</strong> make sure the OtaKit plugin is in
          your next store build. The plugin is native, so it must ship in the binary.
        </li>
        <li>
          <strong>When Xcode 27.1 is final:</strong> submit that build so it is live before 23
          October.
        </li>
        <li>
          <strong>Launch week:</strong> fix what users report and ship it over the air, with a{' '}
          <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollout</A> if the change
          is large.
        </li>
      </ol>
      <p>
        Foldables will not be the last new screen shape. A layout that follows available space, plus
        a way to ship fixes in hours, covers the next one too.
      </p>
    </BlogArticle>
  );
}
