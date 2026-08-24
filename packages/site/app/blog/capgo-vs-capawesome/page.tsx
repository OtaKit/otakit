import { BlogArticle, Callout, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capgo-vs-capawesome')!;

export const metadata = blogPostMetadata(post.slug);

export default function CapgoVsCapawesomePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Capgo and Capawesome are the two best-known live-update tools for Capacitor, and they&apos;re
        often shortlisted together. They&apos;re genuinely similar: both ship signed, rollback-safe
        over-the-air updates, and both meter by monthly active users. This is an honest head-to-head
        &mdash; and, since we make one, a fair look at where <A href="/">OtaKit</A> sits as a
        no-metering third option.
      </p>

      <Callout>
        <p>
          Capgo and Capawesome are more alike than different. The bigger fork in the road is metered
          (both of them) vs unmetered pricing &mdash; which is where OtaKit differs from both.
        </p>
      </Callout>

      <h2>Side by side</h2>
      <DataTable
        headers={['', 'Capgo', 'Capawesome', 'OtaKit']}
        rows={[
          ['Pricing model', 'Meters MAU', 'Meters MAU', 'No MAU/bandwidth metering'],
          ['Delivery', 'CDN', 'CDN', 'CDN-direct'],
          ['Rollback', 'Yes', 'Yes', 'Auto on failed boot + roll-forward'],
          ['Delta updates', 'Yes', 'Yes', 'Yes'],
          ['Encryption', 'Yes', 'Yes', 'End-to-end, your key'],
          ['Open source', 'Partly', 'Plugin open', 'Full MIT stack, self-host'],
        ]}
      />

      <h2>Capgo</h2>
      <p>
        Capgo is mature and widely used, with a full-featured dashboard and a large content/community
        footprint. It meters by monthly active users, with tiered plans as your audience grows. If
        you want the most established metered option and don&apos;t mind MAU-based pricing, it&apos;s
        a solid pick.
      </p>

      <h2>Capawesome</h2>
      <p>
        Capawesome comes from a well-regarded Capacitor plugin maintainer, with a clean plugin and a
        focus on the Capacitor ecosystem. Its Live Update service also meters monthly active users on
        tiered plans. Teams that already use Capawesome&apos;s other plugins often find it a natural
        fit.
      </p>

      <h2>Where OtaKit differs from both</h2>
      <p>
        The common thread with Capgo and Capawesome is MAU metering &mdash; your bill scales with your
        active user count. OtaKit&apos;s model is different: no monthly-active-user or bandwidth
        metering, so most apps pay $0&ndash;25/mo regardless of how many users open the app. Add
        CDN-direct delivery, end-to-end encryption with a key you hold, and a fully MIT-licensed,
        self-hostable stack, and it&apos;s the option for teams that don&apos;t want their
        live-update cost to grow with their success.
      </p>

      <Callout>
        <p>
          Model your bill at 10x today&apos;s users before deciding. Under MAU metering that number
          can get large; under an unmetered model it doesn&apos;t move.
        </p>
      </Callout>

      <h2>How to choose</h2>
      <ul>
        <li>
          <strong>Want the most established metered tool?</strong> Capgo.
        </li>
        <li>
          <strong>Already in the Capawesome plugin ecosystem?</strong> Capawesome.
        </li>
        <li>
          <strong>Don&apos;t want MAU metering, or want to self-host?</strong> OtaKit &mdash; see the{' '}
          <A href="/blog/capgo-alternative">Capgo</A> and{' '}
          <A href="/blog/capawesome-alternative">Capawesome</A> alternative breakdowns.
        </li>
      </ul>

      <h2>Where to go next</h2>
      <p>
        See the full field in the{' '}
        <A href="/blog/best-ota-tools-for-capacitor-2026">2026 OTA tools roundup</A> and the detailed{' '}
        <A href="/blog/best-live-update-frameworks-for-capacitor-apps">three-way comparison</A>.
      </p>
    </BlogArticle>
  );
}
