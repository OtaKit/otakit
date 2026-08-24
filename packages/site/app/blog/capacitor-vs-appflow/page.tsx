import { BlogArticle, Callout, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-vs-appflow')!;

export const metadata = blogPostMetadata(post.slug);

export default function CapacitorVsAppflowPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Ionic Appflow is the incumbent for Capacitor live updates &mdash; it&apos;s from the team
        behind Ionic and Capacitor, and it bundles live updates into a broader CI/CD and native-build
        platform. If all you need is over-the-air updates, that bundle can be more than you want to
        pay for. This is a focused comparison of Appflow Live Updates against <A href="/">OtaKit</A>{' '}
        on the things that matter for OTA specifically.
      </p>

      <Callout>
        <p>
          Both do the core job well: signed, rollback-safe live updates for Capacitor apps. The
          differences are pricing model, delivery, and how much platform you&apos;re buying.
        </p>
      </Callout>

      <h2>Side by side</h2>
      <DataTable
        headers={['', 'Ionic Appflow', 'OtaKit']}
        rows={[
          ['What it is', 'Full CI/CD + native build + live update platform', 'Focused live-update tool'],
          ['Pricing model', 'Platform subscription (tiered)', 'No MAU or bandwidth metering'],
          ['Delivery', 'Platform-managed', 'CDN-direct to devices'],
          ['Rollback', 'Yes', 'Automatic on failed boot + channel roll-forward'],
          ['Encryption', 'Available on higher tiers', 'End-to-end (AES-256-GCM), your key'],
          ['Open source / self-host', 'No', 'Yes, MIT stack'],
          ['Delta updates', 'Yes', 'Yes'],
        ]}
      />

      <h2>Where Appflow makes sense</h2>
      <p>
        If you want one vendor for native cloud builds, CI/CD pipelines, <em>and</em> live updates
        &mdash; and you&apos;re comfortable with platform pricing &mdash; Appflow&apos;s integrated
        story is convenient. Teams that don&apos;t want to run their own iOS/Android build
        infrastructure get real value from the native build service alone.
      </p>

      <h2>Where OtaKit makes sense</h2>
      <p>
        If what you actually need is live updates &mdash; and you already build in{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">GitHub Actions</A> or{' '}
        <A href="/blog/gitlab-ci-capacitor-live-updates">GitLab</A> &mdash; you&apos;re paying for a
        platform to get one feature. OtaKit does just the OTA part: no MAU or bandwidth metering (most
        apps pay $0&ndash;25/mo), CDN-direct delivery, end-to-end encryption with a key you hold, and
        an open-source, self-hostable stack with no lock-in.
      </p>

      <h2>The pricing difference in practice</h2>
      <p>
        Appflow&apos;s value scales with using the whole platform; if you only use live updates, the
        cost-per-feature is high. OtaKit doesn&apos;t bill by monthly active users or bandwidth, so
        your live-update cost doesn&apos;t climb as your install base grows &mdash; the opposite of
        metered models.
      </p>

      <Callout>
        <p>
          Rule of thumb: want a full managed build-and-release platform? Appflow. Want focused,
          unmetered live updates on your own CI? OtaKit &mdash; and see{' '}
          <A href="/blog/ionic-appflow-alternative">the Appflow alternative guide</A> for the
          migration angle.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See the full field in the{' '}
        <A href="/blog/best-ota-tools-for-capacitor-2026">2026 OTA tools roundup</A>, and{' '}
        <A href="/blog/ionic-live-updates-with-capacitor">live updates for Ionic apps</A> for setup.
      </p>
    </BlogArticle>
  );
}
