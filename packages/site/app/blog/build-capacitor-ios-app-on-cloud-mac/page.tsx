import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('build-capacitor-ios-app-on-cloud-mac')!;

export const metadata = blogPostMetadata(post.slug);

export default function CapacitorIosCloudMacPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Capacitor lets you write one web app and ship it to iOS and Android. The catch is iOS: the
        native shell has to be compiled with Xcode, and Xcode only runs on macOS. On Windows or Linux
        you can build the web app and the whole Android app, but not the iPhone binary.
      </p>
      <p>
        This guide uses a disposable cloud Mac from our friends at{' '}
        <A href="https://nomac.app/?utm_source=otakit&utm_medium=blog&utm_campaign=friend-post">
          NoMac
        </A>{' '}
        to do the Apple part. You (or your AI agent) start a Mac, build and test the iOS app, and
        delete the Mac. After that, most changes never need a Mac again, because{' '}
        <A href="/">OtaKit</A> ships web changes over the air.
      </p>

      <Callout>
        <p>
          <strong>The split that saves you Mac time:</strong> native changes (plugins, permissions,
          Capacitor upgrades) need a new iOS build. Web changes (HTML, CSS, JavaScript) can go out as
          an OTA update. Most day-to-day work is the second kind.
        </p>
      </Callout>

      <h2>1. Start a cloud Mac</h2>
      <p>
        NoMac sessions are fresh macOS VMs with Xcode, Node, CocoaPods and an iOS simulator runtime
        preinstalled, billed by the second. From your project directory on Windows (WSL), Linux or a
        Mac:
      </p>
      <Pre>{`npm install -g @nomac/cli
nomac login
nomac start --json
nomac sync .`}</Pre>
      <p>
        <Code>sync</Code> skips <Code>node_modules</Code>, <Code>dist</Code>, <Code>Pods</Code> and
        anything in <Code>.gitignore</Code>, so the upload is just your source.
      </p>

      <h2>2. Build the web app and sync iOS on the Mac</h2>
      <p>
        If you want over-the-air updates later, add the OtaKit plugin now, locally, before this
        build: <Code>npm install @otakit/capacitor-updater</Code>. It is native code, so it has to be
        inside the binary you ship. Then:
      </p>
      <Pre>{`nomac sync .
nomac ssh -- 'npm ci && npm run build && npx cap sync ios'`}</Pre>
      <p>
        <Code>cap sync</Code> copies your web build into the iOS project and installs native
        dependencies, whether your project uses Swift Package Manager or CocoaPods.
      </p>

      <h2>3. Compile and run it in the simulator</h2>
      <Pre>{`# Swift Package Manager projects (the Capacitor 8 default)
nomac ssh -- xcodebuild -project ios/App/App.xcodeproj -scheme App \\
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build build

# CocoaPods projects use the workspace instead
# -workspace ios/App/App.xcworkspace

nomac ssh -- xcrun simctl boot "iPhone 17 Pro"
nomac ssh -- xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/App.app
nomac ssh -- xcrun simctl launch booted com.example.app
nomac ssh -- 'mkdir -p shots && xcrun simctl io booted screenshot shots/home.png'
nomac pull ./shots --from shots`}</Pre>
      <p>
        A first simulator boot takes about 90 seconds. The screenshot shows whether your web view
        actually loaded, which catches the classic Capacitor mistakes: a wrong <Code>webDir</Code>, a
        missing build, or a blank screen from a JavaScript error.
      </p>

      <h2>4. Let your AI agent do it</h2>
      <p>
        NoMac also works as an MCP server, so Claude Code, Codex or Cursor can run the steps above
        themselves:
      </p>
      <Pre>{`claude mcp add nomac -- npx @nomac/cli mcp
claude mcp add otakit -- npx -y @otakit/cli@latest mcp`}</Pre>
      <p>
        With both connected, one agent can build the native shell on a Mac when it must, and ship
        web changes through OtaKit when it can. See{' '}
        <A href="/blog/ship-capacitor-updates-with-ai-agents">shipping Capacitor updates with AI agents</A>.
      </p>

      <h2>5. Archive for TestFlight, then stop</h2>
      <p>
        Signed builds need your Apple Developer account and signing set up on the session. Once the
        release is uploaded, stop the Mac; it is deleted along with everything on it:
      </p>
      <Pre>{`nomac stop --json`}</Pre>
      <p>
        If you prefer CI for signed releases, see{' '}
        <A href="/blog/github-actions-ios-build-signing">iOS signing in GitHub Actions</A>. The cloud
        Mac is then your workbench for debugging, and CI is the factory.
      </p>

      <h2>6. Ship everything else over the air</h2>
      <p>
        Once a build with the OtaKit plugin is in users&apos; hands, web-only fixes go straight to
        devices from your own machine, with no Mac, no Xcode and no App Review wait:
      </p>
      <Pre>{`npm run build
npx -y @otakit/cli@latest upload --release`}</Pre>
      <p>
        You only return to the Mac when something native changes. For a lot of apps, that is a few
        times a year.
      </p>
    </BlogArticle>
  );
}
