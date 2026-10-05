# OtaKit for Claude

[OtaKit](https://otakit.app) delivers over-the-air updates to Capacitor apps on iOS and Android. This plugin lets Claude manage those updates for you: look up apps, bundles, and releases, prepare and publish a release to an exact channel after you approve it, run staged rollouts, read rollout health, and revert.

## What the plugin contains

- **OtaKit MCP server (hosted).** `.mcp.json` connects Claude to `https://console.otakit.app/mcp` over Streamable HTTP. Nothing runs on your machine for it.
- **OtaKit skill.** `skills/otakit/` teaches Claude the release workflow: resolve the exact app, channel, and runtime version, show the change, and wait for your approval before every publish and revert.

There are no hooks, commands, agents, or scripts.

## Connecting

The first time Claude uses an OtaKit tool, your browser opens the OtaKit sign-in page. Sign in, choose the one organization the connection may use, and approve the permissions it asks for. You can revoke the connection at any time in the OtaKit console under **Settings → Agents**. An OtaKit account is required; a free plan is available.

## What it sends and fetches

- Tool calls go to OtaKit's API for your organization: app, bundle, release, and channel identifiers, rollout percentages, and similar release settings. OtaKit stores them as described in the [privacy policy](https://otakit.app/policy).
- Release health and event tools read events that your apps' devices reported to OtaKit. Event detail text comes from devices and is treated as untrusted data.
- Uploading a new web bundle needs your project files, so it is not part of the hosted server. For uploads the skill points to the [OtaKit CLI](https://otakit.app/docs/agents) (`npx @otakit/cli upload`), which runs in your project like any other command Claude suggests.

## Example prompts

- "Which OtaKit apps do I have, and what is released on production and staging?"
- "How is the current production rollout doing? Are rollbacks higher than usual?"
- "Publish bundle 1.3.0 to the staging channel. Show me the plan first."
- "Revert the release we published this morning on production."

## Links

- Documentation: https://otakit.app/docs/agents
- Privacy policy: https://otakit.app/policy
- Support: support@otakit.app
- Source: https://github.com/OtaKit/otakit (MIT)
