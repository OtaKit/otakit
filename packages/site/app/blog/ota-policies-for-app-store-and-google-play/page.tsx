import { BlogArticle, Callout, Code, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('ota-policies-for-app-store-and-google-play')!;

export const metadata = blogPostMetadata(post.slug);

export default function OtaPoliciesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Short answer: yes, over-the-air updates are allowed — for the web layer of your app, under
        conditions both Apple and Google spell out explicitly. Teams don&apos;t get rejected for
        &ldquo;using OTA.&rdquo; They get rejected for using it to change what the reviewed app
        fundamentally is, or to download code the platforms classify as executable.
      </p>
      <p>
        This post quotes the actual policy text from the primary sources, then translates it into a
        practical checklist. It&apos;s not legal advice, but every claim below links to the
        document it comes from.
      </p>

      <h2>What Apple says</h2>
      <p>
        Two documents matter: the{' '}
        <A href="https://developer.apple.com/app-store/review/guidelines/">
          App Review Guidelines
        </A>{' '}
        and the{' '}
        <A href="https://developer.apple.com/support/terms/apple-developer-program-license-agreement/">
          Apple Developer Program License Agreement
        </A>{' '}
        (DPLA).
      </p>
      <p>
        Guideline <strong>2.5.2</strong> sets the baseline: apps &ldquo;should be self-contained in
        their bundles&hellip; nor may they download, install, or execute code which introduces or
        changes features or functionality of the app.&rdquo;
      </p>
      <p>
        Read alone, that sounds like a blanket ban — but the DPLA carves out interpreted code
        explicitly. The clause historically known as <strong>§3.3.2</strong> (moved to{' '}
        <strong>§3.3.1(B), Executable Code</strong> in the 2025 reorganization of the agreement)
        permits downloaded interpreted code — JavaScript included — as long as it is run by
        Apple&apos;s built-in WebKit framework or JavaScriptCore, and provided it:
      </p>
      <ul>
        <li>does not change the primary purpose of the app,</li>
        <li>does not create a store or storefront for other code or apps, and</li>
        <li>does not bypass the operating system&apos;s signing, sandbox, or other security features.</li>
      </ul>
      <p>
        A Capacitor app runs its entire web layer inside Apple&apos;s own WKWebView — WebKit,
        exactly the engine the clause names. Updating that web layer over the air sits squarely
        inside the carve-out, which is why live-update tooling has operated in the open for a
        decade, from Microsoft&apos;s CodePush and Ionic Appflow to today&apos;s Capacitor
        ecosystem.
      </p>
      <p>
        The guidelines Apple actually enforces against OTA misuse are elsewhere: guideline{' '}
        <strong>2.3.1</strong> bans &ldquo;hidden, dormant, or undocumented features&rdquo; and
        requires that &ldquo;your app&apos;s functionality should be clear to end users and App
        Review.&rdquo; Using OTA to flip on functionality reviewers never saw is what gets
        developer accounts in trouble — not shipping a bug fix to your JavaScript.
      </p>

      <h2>What Google says</h2>
      <p>
        Google Play&apos;s{' '}
        <A href="https://support.google.com/googleplay/android-developer/answer/16559646">
          Device and Network Abuse policy
        </A>{' '}
        is the primary source, and it&apos;s unusually direct. Three sentences do all the work:
      </p>
      <ul>
        <li>
          &ldquo;An app distributed via Google Play may not modify, replace, or update itself using
          any method other than Google Play&apos;s update mechanism.&rdquo;
        </li>
        <li>
          &ldquo;An app may not download executable code (such as dex, JAR, .so files) from a
          source other than Google Play.&rdquo;
        </li>
        <li>
          &ldquo;This restriction does not apply to code that runs in a virtual machine or an
          interpreter where either provides indirect access to Android APIs (such as JavaScript in
          a webview or browser).&rdquo;
        </li>
      </ul>
      <p>
        That third sentence is the OTA exception, verbatim: JavaScript running in a WebView — which
        is precisely what a Capacitor app is — is explicitly excluded from the ban. Google adds one
        condition: interpreted code loaded at runtime &ldquo;must not allow potential violations of
        Google Play policies.&rdquo; The exception permits the mechanism, not misuse of it.
      </p>

      <h2>The practical line</h2>
      <p>Putting both platforms together, the compliant zone is wide and clearly marked.</p>
      <p>
        <strong>Safely in bounds:</strong>
      </p>
      <ul>
        <li>Bug fixes in your JavaScript, CSS, and HTML.</li>
        <li>UI polish, copy changes, new screens built on existing native capabilities.</li>
        <li>Feature iteration that stays inside the app&apos;s reviewed purpose.</li>
        <li>Staged rollouts, instant rollbacks, and channel-based testing of the web layer.</li>
      </ul>
      <p>
        <strong>Rejection territory:</strong>
      </p>
      <ul>
        <li>
          Downloading native or otherwise executable binaries (<Code>dex</Code>, <Code>JAR</Code>,{' '}
          <Code>.so</Code>, dylibs) outside the stores.
        </li>
        <li>Using OTA to activate features that were hidden from review (Apple 2.3.1).</li>
        <li>
          Materially changing the app&apos;s primary purpose after review — the classic example is
          an app reviewed as one thing that turns into a casino a week later.
        </li>
        <li>Behaving differently for reviewers than for real users.</li>
      </ul>

      <Callout>
        <p>
          Rule of thumb: ship HTML, CSS, and JavaScript over the air. Ship native capability
          changes through the store. Never ship anything a reviewer would be surprised to find.
        </p>
      </Callout>

      <h2>How OtaKit keeps you on the right side</h2>
      <p>
        OtaKit is deliberately scoped to the compliant slice: it delivers web bundles only, and the
        toolchain reinforces the boundary. The CLI inspects your dependencies at upload time and
        warns when a bundle depends on native code the installed app doesn&apos;t have — the most
        common accidental way teams drift out of bounds. Signed manifests and SHA-256 verification
        mean the only code that can reach devices is code you published. And when a native change
        is genuinely needed, <Code>runtimeVersion</Code> lanes make &ldquo;this goes through the
        store&rdquo; an explicit, first-class part of the release model rather than an
        afterthought.
      </p>

      <h2>A five-point checklist for your team</h2>
      <ol>
        <li>Keep OTA payloads strictly to built web output — no native artifacts, ever.</li>
        <li>
          Describe new features honestly in store metadata and review notes when you submit native
          builds.
        </li>
        <li>Don&apos;t gate unreviewed functionality behind remote flags aimed at review.</li>
        <li>
          Bump <Code>runtimeVersion</Code> with every store build that changes native capabilities.
        </li>
        <li>Re-read both policy pages once or twice a year — they do evolve.</li>
      </ol>

      <p>
        Want to see the compliant workflow in practice? Start with{' '}
        <A href="/docs/setup">the setup guide</A>, or read{' '}
        <A href="/blog/how-ota-works-for-capacitor-apps">how OTA updates actually work</A> under
        the hood.
      </p>
    </BlogArticle>
  );
}
