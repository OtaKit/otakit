import Link from 'next/link';

import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'Preview Links',
  description:
    'Open an uploaded bundle in the installed app on a phone with a link or QR code, without releasing it.',
};

export default function PreviewsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Preview Links</h1>
      <P>
        A preview link opens an uploaded bundle in the real app on one phone, without releasing it.
        Scan the QR code, tap <strong>Open in the app</strong>, and the app downloads that bundle
        and reloads into it. Use it to check a change on a device, get a client&apos;s sign-off, or
        let an agent share &ldquo;here is my change&rdquo;.
      </P>
      <P>
        Previews need <Code>@otakit/capacitor-updater</Code> 3.2 or later. Only web code can be
        previewed; native changes still need a store build.
      </P>

      <Separator className="my-10" />

      <H2>Set up the app once</H2>
      <P>
        Turn preview links on in the builds that should accept them, for example internal or staging
        builds:
      </P>
      <Pre>{`// capacitor.config.ts
plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    previewLinks: true
  }
}`}</Pre>
      <P>
        The app also needs a custom URL scheme, such as <Code>myapp</Code>. Many apps already have
        one. On iOS add it to <Code>Info.plist</Code>:
      </P>
      <Pre>{`<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>myapp</string></array>
  </dict>
</array>`}</Pre>
      <P>
        On Android add an intent filter to the main activity in <Code>AndroidManifest.xml</Code>:
      </P>
      <Pre>{`<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="myapp" />
</intent-filter>`}</Pre>
      <P>
        The plugin handles <Code>myapp://otakit-preview?…</Code> links itself; no app code is
        needed, and other links keep reaching your app. On iOS it receives links through
        Capacitor&apos;s <Code>ApplicationDelegateProxy</Code>, which the default{' '}
        <Code>AppDelegate</Code> already forwards to.
      </P>

      <Separator className="my-10" />

      <H2>Create a preview link</H2>
      <P>
        From the dashboard: the QR button on a bundle row. The first link asks for the app&apos;s
        URL scheme and remembers it. From the CLI:
      </P>
      <Pre>{`# Upload and create a link in one step
otakit upload --preview

# Or preview a bundle you already uploaded
otakit preview <bundle-id> --expires 24h --scheme myapp

otakit preview --list
otakit preview --revoke <preview-id>`}</Pre>
      <P>
        The CLI prints the link and a QR code. Links last 7 days by default (1h, 24h, 7d or 30d),
        and an app can have 20 active links.
      </P>

      <Separator className="my-10" />

      <H2>What the tester sees</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          The link opens a page with the bundle version, expiry, a QR code on desktop, and the
          buttons <strong>Open in the app</strong> and <strong>Exit preview</strong>.
        </li>
        <li>
          Opening it downloads the bundle like any update, with signature checks, and reloads the
          app. The app still calls <Code>notifyAppReady()</Code>; a bundle that fails to start rolls
          back and ends the preview.
        </li>
        <li>
          The app returns to its normal release when the tester taps <strong>Exit preview</strong>,
          when your code calls <Code>OtaKit.stopPreview()</Code>, or when the link expires or is
          revoked. The app notices that on its next update check (launch, resume, or{' '}
          <Code>OtaKit.update()</Code>). If the channel has no release, it returns to the bundle
          built into the app.
        </li>
        <li>
          Nobody else is affected: a preview is not a release, does not appear as a channel, and
          does not count towards release health or auto-revert. Its downloads count as downloads.
        </li>
      </ul>
      <Pre>{`const { preview } = await OtaKit.getState(); // { startedAt, version } or null
if (preview) showBanner(\`Preview \${preview.version}\`, () => OtaKit.stopPreview());

OtaKit.addListener('previewFailed', ({ reason }) => {
  // 'unavailable': expired, revoked, or built for another runtime version
});`}</Pre>

      <Separator className="my-10" />

      <H2>Security</H2>
      <P>
        Each link carries a random 130-bit token and works only for the bundle it was created for.
        Anyone with the link and a build that accepts previews can open it, so keep{' '}
        <Code>previewLinks</Code> off in builds that should never show unreleased work, and revoke
        links you no longer need.
      </P>

      <Separator className="my-10" />

      <H2>API and agents</H2>
      <P>
        See the{' '}
        <Link href="/docs/api" className="font-medium text-foreground underline underline-offset-4">
          REST API
        </Link>{' '}
        for the preview endpoints. Agents use <Code>create_preview</Code> and{' '}
        <Code>revoke_preview</Code>; see{' '}
        <Link
          href="/docs/agents"
          className="font-medium text-foreground underline underline-offset-4"
        >
          MCP &amp; Agent Skills
        </Link>
        .
      </P>
    </>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold tracking-tight">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}
