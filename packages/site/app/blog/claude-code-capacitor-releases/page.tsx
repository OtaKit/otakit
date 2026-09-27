import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('claude-code-capacitor-releases')!;

export const metadata = blogPostMetadata(post.slug);

export default function ClaudeCodeCapacitorPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Claude Code already writes most of the fix. The part people still do by hand is the release:
        build, pick the right app and channel, check that the web bundle still matches the native
        app in the store, upload, publish, and then watch whether anything breaks. That is careful,
        repetitive work, and it is exactly where a tired human makes mistakes.
      </p>
      <p>
        This guide connects Claude Code to <A href="/">OtaKit</A> so it can do that work for a
        Capacitor app, while you keep the one decision that matters: approving the release.
      </p>

      <Callout>
        <p>
          <strong>What the agent can and cannot change.</strong> OtaKit ships the web layer of a
          Capacitor app (HTML, CSS, JavaScript, assets) over the air. Native code still goes through
          the App Store and Google Play. The agent checks this for you before every release.
        </p>
      </Callout>

      <h2>1. Install (two commands)</h2>
      <p>
        The OtaKit plugin for Claude Code ships the MCP server and the OtaKit Agent Skill together:
      </p>
      <Pre>{`npx -y @otakit/cli@latest login

claude plugin marketplace add OtaKit/otakit
claude plugin install otakit@otakit`}</Pre>
      <p>
        Run <Code>/mcp</Code> in Claude Code and you should see <Code>otakit</Code> connected. If
        your app does not use OtaKit yet, add the plugin to the Capacitor app first and ship one
        store build; see <A href="/docs/setup">setup</A>.
      </p>

      <h2>2. Start read-only</h2>
      <p>A good first prompt changes nothing:</p>
      <Callout>
        <p>
          Check whether this project is ready to ship an OtaKit update. Don&apos;t upload anything.
        </p>
      </Callout>
      <p>
        Claude Code calls <Code>inspect_project</Code>. On our demo app the real result looks like
        this (trimmed):
      </p>
      <Pre>{`Inspected the local Capacitor project.
  capacitorConfig   appId 65bb56c1-…  runtimeVersion demo-shell-v3
  buildOutput       out/ (exists)
  notifyAppReady    found in app/page.tsx
  authenticated     true
  findings          none`}</Pre>
      <p>
        It found the OtaKit config, the build folder and the <Code>notifyAppReady()</Code> call that
        makes automatic rollback work. If any of those were missing, it would say so here.
      </p>

      <h2>3. Ask it to ship</h2>
      <Callout>
        <p>Build the app and ship it to the demo-agent channel with auto-revert on.</p>
      </Callout>
      <p>These are the steps it takes, with the real tool responses from that session:</p>
      <DataTable
        headers={['Step', 'Tool', 'What came back']}
        rows={[
          [
            'Check native compatibility',
            'check_compatibility',
            'skipped, with a warning: no earlier release on this lane to compare against',
          ],
          [
            'Upload the bundle',
            'upload_bundle',
            'Uploaded bundle 1.0.0-agent.1 without publishing it (261 KB)',
          ],
          [
            'Prepare the release',
            'prepare_release',
            'Prepared the exact release state without changing it; next: review, then publish',
          ],
          ['Publish after your approval', 'publish_release', 'Published release 4e02b307-…'],
          [
            'Read health',
            'get_release_health',
            '0 events so far; auto-revert on (20% over at least 50 activations); analytics available',
          ],
        ]}
      />
      <p>
        Two details matter here. Uploading and publishing are separate, so an upload can never reach
        a device by itself. And the compatibility check is honest: on a brand-new lane there is
        nothing to compare against, so it reports <em>skipped</em> instead of pretending everything
        is fine.
      </p>

      <h2>4. The approval step</h2>
      <p>
        Before publishing, Claude Code shows the prepared release and waits. The OtaKit Skill
        instructs it to ask for approval, and <Code>publish_release</Code> is flagged as a
        destructive tool, so Claude Code asks for permission before running it. On a lane that
        already has a release, the block reads like this:
      </p>
      <Pre>{`Publish  com.acme.shop
  lane       production · runtime 2026.04
  from       1.4.0  ->  1.5.0
  native     compatible (12 packages unchanged)
  immediate  no        auto-revert  on · 10% · min 100
Approve? This goes live for every device on that lane.`}</Pre>
      <p>Read it line by line:</p>
      <ul>
        <li>
          <strong>lane</strong>: the channel and native runtime this goes to. A wrong channel is the
          most common release mistake.
        </li>
        <li>
          <strong>from → to</strong>: what users have now and what they will get.
        </li>
        <li>
          <strong>native</strong>: whether the web bundle still matches the native app. If you added
          a native plugin, this says so and the release stops.
        </li>
        <li>
          <strong>immediate</strong>: whether devices reload right away (for emergencies) or on the
          next launch.
        </li>
        <li>
          <strong>auto-revert</strong>: the rollback share and minimum sample that will pull the
          release automatically.
        </li>
      </ul>
      <p>
        The publish carries the state you reviewed. If a teammate releases in between, yours is
        rejected instead of overwriting theirs.
      </p>

      <h2>5. Watch and roll back</h2>
      <p>After the release, ask in plain language:</p>
      <ul>
        <li>&ldquo;How is the demo-agent release doing?&rdquo;</li>
        <li>&ldquo;Are people on 1.0.0-agent.1 seeing rollbacks?&rdquo;</li>
        <li>&ldquo;Roll production back to the previous release.&rdquo;</li>
      </ul>
      <p>
        Health numbers are events reported by devices, not users, and the tool tells Claude Code so.
        A revert goes through the same prepare-and-approve flow as a publish.
      </p>

      <h2>Where this fits</h2>
      <p>
        Native releases still go through the stores on your schedule. Everything in between, the
        copy fix, the broken button, the checkout bug, becomes a sentence to your agent and one
        approval. Setup for other agents (Codex, VS Code) is on the{' '}
        <A href="/ai-agents">AI agents page</A>, and every tool is documented in{' '}
        <A href="/docs/agents">MCP &amp; Agent Skills</A>. For Codex specifically, see{' '}
        <A href="/blog/codex-capacitor-ota-updates">shipping Capacitor fixes from Codex</A>.
      </p>
    </BlogArticle>
  );
}
