/**
 * The remote endpoint's advertised `serverInfo` version. It was hardcoded at
 * 0.1.0 while everything else shipped 1.5.0, which looks broken in a client
 * listing both. The local server reports CLI_VERSION instead, since there it
 * genuinely is the CLI; `agents:validate` keeps the two in step.
 */
export const OTAKIT_MCP_VERSION = '1.5.0';
