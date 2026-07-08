import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-barcode-scanner')!;

export const metadata = blogPostMetadata(post.slug);

export default function BarcodeScannerPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Barcode and QR scanning shows up everywhere &mdash; loyalty cards, ticketing, inventory,
        onboarding via QR. In a Capacitor app you want a native scanner (fast, uses the real camera
        pipeline), not a slow JavaScript decoder on a video stream. This guide covers adding native
        scanning, handling camera permissions cleanly, and iterating the scan flow over the air with{' '}
        <A href="/">OtaKit</A>.
      </p>

      <h2>1. Install a native scanner plugin</h2>
      <p>
        Use a maintained Capacitor barcode plugin backed by ML Kit (Android) and the native scanner
        (iOS). It decodes on-device, fast, across the common symbologies:
      </p>
      <Pre>{`npx cap sync`}</Pre>

      <h2>2. Declare camera permissions</h2>
      <ul>
        <li>iOS: add <Code>NSCameraUsageDescription</Code> with a clear, honest reason string.</li>
        <li>Android: the camera permission in the manifest.</li>
      </ul>
      <p>
        These are native and belong in the store build. The permission <em>copy</em>, though, matters for
        approval and trust &mdash; say what you scan and why.
      </p>

      <h2>3. Request permission, then scan</h2>
      <Pre>{`async function scan() {
  const granted = await BarcodeScanner.requestPermissions();
  if (granted.camera !== 'granted') return showPermissionRationale();

  const { barcodes } = await BarcodeScanner.scan();
  if (barcodes.length) handleResult(barcodes[0].rawValue);
}`}</Pre>

      <h2>4. Handle the result in your web layer</h2>
      <p>
        What happens after a successful scan &mdash; look up the code, validate a ticket, add to a cart,
        route to a screen &mdash; is all web-layer logic. That&apos;s exactly what you&apos;ll refine as
        requirements change, and it ships over the air:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>

      <Callout>
        <p>
          Handle the &ldquo;permission denied&rdquo; path deliberately. Show a rationale and a route to
          Settings rather than a dead scan button &mdash; and since that&apos;s UI, you can improve it
          over the air after you see how users actually hit it.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/setup">Setup</A> to add OtaKit alongside the scanner, and{' '}
        <A href="/blog/capacitor-offline-support">offline support</A> if scanning needs to work without a
        connection.
      </p>
    </BlogArticle>
  );
}
