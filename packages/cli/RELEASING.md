# Releasing @otakit/cli

1. Bump `version` in `packages/cli/package.json`, and the matching versions in `server.json`
   (`version` and `packages[0].version`), `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`
   `packages/mcp-core` (`package.json` and `src/version.ts`), `skills/otakit/SKILL.md`, and the
   expected version in `src/lib/version.test.ts`. `pnpm agents:validate` checks the metadata agrees.
2. Build and publish to npm: `pnpm --filter @otakit/cli build`, then `npm publish` from
   `packages/cli`.
3. Publish the MCP registry entry (after npm, because the registry verifies `mcpName` in the
   published package):

   ```bash
   mcp-publisher login github --token "$(gh auth token)"   # needs an owner of the OtaKit org
   mcp-publisher publish
   ```

   The name is case-sensitive: `io.github.OtaKit/otakit` must match the GitHub org name, and
   `mcpName` in `package.json` must be identical. A version can be published to the registry only
   once.
