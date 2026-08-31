/**
 * Advertised in `serverInfo` by both the local stdio server and the remote
 * endpoint. A client that lists one OtaKit server at 1.5.0 and another at
 * 0.1.0 looks broken, so both read this and `agents:validate` checks it
 * against the CLI, plugin, Skill, and registry versions.
 */
export const OTAKIT_MCP_VERSION = '1.5.0';
