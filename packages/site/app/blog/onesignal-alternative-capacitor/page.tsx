import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('onesignal-alternative-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function OneSignalAlternativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        OneSignal is the default answer when someone asks how to add push notifications to a
        Capacitor app, and for good reason: it is mature, it has a visual composer, and it does far
        more than push. But plenty of teams only need to send a notification to the right users and
        open the right screen, and for them the trade-offs look different: a monthly bill that grows
        with active users once you pass the free tier, and a native SDK with extra iOS setup.
      </p>
      <p>
        This is an honest comparison of OneSignal and <A href="/push">OtaKit Push</A> for Capacitor
        apps, including when OneSignal is the better choice.
      </p>

      <h2>The short answer</h2>
      <ul>
        <li>
          <strong>Choose OneSignal</strong> if marketing runs your notifications: journeys,
          automated sequences, in-app messages, email and SMS in one tool, detailed analytics.
        </li>
        <li>
          <strong>Choose OtaKit Push</strong> if developers send them: transactional and product
          notifications, targeted by your own user IDs or topics, sent from your backend, CI or the
          dashboard, free up to 100,000 notifications a month.
        </li>
      </ul>

      <h2>Pricing</h2>
      <DataTable
        headers={['', 'OneSignal', 'OtaKit Push']}
        rows={[
          [
            'Free',
            'Unlimited mobile push for up to 1,000 monthly active users',
            '10,000 devices, 100,000 notifications a month',
          ],
          [
            'First paid step',
            'Growth: from $19/month, plus $0.012 per monthly active user',
            'Included in OtaKit Starter and Pro, with higher limits',
          ],
          [
            'What drives the bill',
            'Monthly active users',
            'Nothing extra: push is part of the OtaKit plan',
          ],
        ]}
      />
      <p className="text-sm text-muted-foreground">
        OneSignal prices from onesignal.com/pricing, checked September 2026. Check the page for
        current numbers.
      </p>
      <p>
        Apple and Google charge nothing to deliver push. What you pay any push provider for is the
        software around it, so it is worth asking how much of that software you actually use.
      </p>

      <h2>Setup in a Capacitor app</h2>
      <DataTable
        headers={['', 'OneSignal', 'OtaKit Push']}
        rows={[
          [
            'Device plugin',
            '@onesignal/capacitor-plugin (native SDK)',
            'Official @capacitor/push-notifications + a small JS helper',
          ],
          [
            'iOS native work',
            'Push and Background Modes capabilities, Notification Service Extension, App Groups',
            'Push capability and two AppDelegate methods',
          ],
          ['Android', 'Firebase credentials', 'Firebase service account + google-services.json'],
          ['Capacitor config', 'handleApplicationNotifications: false', 'No changes'],
        ]}
      />
      <p>
        OneSignal&apos;s extra iOS pieces are there for features like rich media and confirmed
        delivery, which is a fair trade if you use them. If you don&apos;t, the official Capacitor
        plugin is simpler to keep up to date across Capacitor and iOS releases.
      </p>

      <h2>Sending</h2>
      <p>
        OneSignal is built around its dashboard and segments. OtaKit Push is built around the ways
        developers already work:
      </p>
      <Pre>{`# CLI or CI
otakit push send --title "Build 2.4 is live" --body "See what's new" --url /changelog --topic news

# Your backend: target your own user IDs, safe to retry
curl -X POST https://console.otakit.app/api/v1/apps/$APP_ID/push/campaigns \\
  -H "Authorization: Bearer $OTAKIT_TOKEN" \\
  -H "Idempotency-Key: order-42-shipped" \\
  -H "Content-Type: application/json" \\
  -d '{"payload":{"title":"Your order shipped","body":"Track it in the app","url":"/orders/42"},
       "audience":{"userIds":["user_42"]}}'`}</Pre>
      <p>
        There is also a dashboard composer with a live audience count, and AI agents can send
        through the OtaKit CLI after you confirm the message.
      </p>

      <h2>What OneSignal does that OtaKit Push does not</h2>
      <ul>
        <li>Visual journeys and automated message sequences</li>
        <li>In-app messages, email, SMS and web push in the same product</li>
        <li>Scheduled and time-zone-aware sending, A/B tests of message copy</li>
        <li>Rich notifications with images through its iOS extension</li>
        <li>Deeper engagement analytics</li>
      </ul>
      <p>If you need several of these, OneSignal is likely worth its price.</p>

      <h2>What OtaKit Push adds for Capacitor teams</h2>
      <ul>
        <li>
          <strong>Your own keys.</strong> Delivery runs through your APNs key and your Firebase
          project. They stay yours and work with any other sender.
        </li>
        <li>
          <strong>OTA channel targeting.</strong> If you ship web updates with{' '}
          <A href="/">OtaKit live updates</A>, devices report their channel, so you can message just
          the beta testers who received a new build.
        </li>
        <li>
          <strong>Developer safety.</strong> Audience preview before every send, idempotency keys,
          automatic removal of dead tokens, and an audit log of who sent what.
        </li>
        <li>
          <strong>One tool.</strong> Live updates, rollbacks and push in the same dashboard, CLI and
          API.
        </li>
      </ul>

      <h2>Switching from OneSignal</h2>
      <p>
        Device tokens belong to Apple and Google, not to the push provider, but OneSignal&apos;s SDK
        manages them for you, so the practical path is a new app release:
      </p>
      <ol>
        <li>Upload your APNs key and Firebase service account to OtaKit.</li>
        <li>
          Replace the OneSignal plugin with <Code>@capacitor/push-notifications</Code> and{' '}
          <Code>@otakit/push</Code>, and remove the Notification Service Extension if you added it
          only for OneSignal.
        </li>
        <li>
          Call <Code>OtaKitPush.setUser()</Code> where you used OneSignal&apos;s external user ID,
          and <Code>subscribe()</Code> where you used tags for topics.
        </li>
        <li>
          Ship the store build. Devices register with OtaKit as users update; keep OneSignal for the
          remaining users until most have moved.
        </li>
      </ol>

      <Callout>
        <p>
          <strong>Try it on one app first.</strong> Push is free on every OtaKit plan. Turn it on in
          Settings → Add-ons, follow the <A href="/docs/push">push docs</A>, and send yourself a
          test notification before you decide.
        </p>
      </Callout>
    </BlogArticle>
  );
}
