/**
 * Error grouping. Computed here, at ingest, so the rules can improve without
 * an app update. The same error must get the same fingerprint across builds:
 * bundlers put content hashes in chunk names (index-4f3a9c2b.js), so file
 * names are normalized and line/column numbers are ignored.
 */

export type StackFrame = {
  /** Function name, or "" when the engine reports none. */
  fn: string;
  /** Normalized file: path without origin, query or build hash, e.g. "assets/index.js". */
  file: string;
  line: number | null;
  column: number | null;
  /** Code of the app itself, not a dependency or the browser. */
  inApp: boolean;
};

// V8 (Android WebView, Chrome): "    at fn (url:line:col)" or "    at url:line:col"
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
// JavaScriptCore (WKWebView, Safari): "fn@url:line:col", "@url:line:col", "global code@url:line:col"
const JSC_FRAME = /^\s*(?:([^@]*)@)?(.+?):(\d+):(\d+)\s*$/;
// Vite/Rollup (`[name]-[hash]`, 8 URL-safe base64 characters, so "-" and "_" can occur) and
// esbuild/Angular (`chunk-[hash]`, 8 uppercase base32 characters): index-Bk-qT5Y2.js, chunk-ABCDEFGH.js
const SHORT_HASH = /-([A-Za-z0-9_-]{8})(?=\.m?[jt]sx?$)/;
// webpack, Angular CLI and others: main.4f3a9c2b.js, index-4f3a9c2b.js, 123.e5f6a7b8c9d0.chunk.js
const BUILD_HASH = /[-.]([A-Za-z0-9_]{6,})(?=(?:\.chunk)?\.m?[jt]sx?$)/;
const VENDOR = /(^|\/)(node_modules|vendor|vendors|polyfills?)([/.-]|$)|(^|\/)vendor[-.~]/i;
const NATIVE_FILE = /^(native|\[native code\]|<anonymous>|eval)$/;

export function normalizeFile(raw: string): string {
  let file = raw.trim();
  // capacitor://localhost/…, https://localhost/…, http://10.0.2.2:8100/…, file:///…
  file = file.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  file = file.replace(/[?#].*$/, '');
  file = file.replace(/^\/+/, '');
  const slash = file.lastIndexOf('/');
  const directory = slash >= 0 ? file.slice(0, slash + 1) : '';
  let name = slash >= 0 ? file.slice(slash + 1) : file;
  // Only strip a segment that looks like a hash, so names like
  // "use-feedback.js" and "vendor-helpers.js" keep their words.
  const short = SHORT_HASH.exec(name);
  const long = BUILD_HASH.exec(name);
  if (short && isShortHash(short[1])) {
    name = name.slice(0, short.index) + name.slice(short.index + short[0].length);
  } else if (long && (/\d/.test(long[1]) || /^[A-F0-9]+$/i.test(long[1]))) {
    name = name.slice(0, long.index) + name.slice(long.index + long[0].length);
  }
  return directory + name;
}

/** An 8-character segment is a hash unless it is a lowercase word. */
function isShortHash(segment: string): boolean {
  return (
    /[\d_-]/.test(segment) ||
    (/[a-z]/.test(segment) && /[A-Z]/.test(segment)) ||
    /^[A-Z]+$/.test(segment)
  );
}

function frameFromMatch(
  fn: string | undefined,
  rawFile: string,
  line: string,
  column: string,
): StackFrame {
  const file = normalizeFile(rawFile);
  const name = (fn ?? '')
    .trim()
    .replace(/^async /, '')
    .replace(/^new /, '');
  return {
    fn: name === 'global code' || name === '<anonymous>' ? '' : name,
    file,
    line: Number(line),
    column: Number(column),
    inApp: file.length > 0 && !NATIVE_FILE.test(file) && !VENDOR.test(file),
  };
}

/** Frames of a V8 or JavaScriptCore stack, top first. Unparseable lines are skipped. */
export function parseStack(stack: string | null | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n').slice(0, 200)) {
    const v8 = V8_FRAME.exec(line);
    if (v8 && /^\s*at /.test(line)) {
      frames.push(frameFromMatch(v8[1], v8[2], v8[3], v8[4]));
      continue;
    }
    const jsc = JSC_FRAME.exec(line);
    // A JavaScriptCore frame has no spaces before "@"; V8 message lines do.
    if (jsc && !/^\s*at /.test(line) && !/\s/.test(jsc[2])) {
      frames.push(frameFromMatch(jsc[1], jsc[2], jsc[3], jsc[4]));
    }
  }
  return frames;
}

// A URL in a message, e.g. "Failed to fetch dynamically imported module: https://localhost/assets/Page-BkMqT5Y2.js".
const URL_IN_MESSAGE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>()]+/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX = /\b(?:0x)?[0-9a-f]{8,}\b/gi;
const QUOTED = /(["'`])(?:\\.|(?!\1).)*\1/g;
// Digits glued to units count too: "2.5s", "30000ms".
const NUMBER = /\d+(?:\.\d+)?/g;

/**
 * The message with its variable parts replaced, so "id 123 not found" and "id 456 not found" group.
 * URLs keep only their normalized path: build hashes and hosts vary, and alerts quote this text.
 * Quoted values are kept when the error has no stack (`quoted: false`): the message is then all
 * there is to tell rejections like `{"code":"E_TIMEOUT"}` and `{"code":"E_AUTH"}` apart.
 */
export function normalizeMessage(message: string, options: { quoted?: boolean } = {}): string {
  const replaceQuoted = options.quoted ?? true;
  return message
    .replace(URL_IN_MESSAGE, (url) => normalizeFile(url) || '<url>')
    .replace(UUID, '<id>')
    .replace(QUOTED, (quoted) => (replaceQuoted ? '<str>' : quoted))
    .replace(HEX, (value) => (/\d/.test(value) ? '<id>' : value))
    .replace(NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function frameKey(frame: StackFrame): string {
  return `${frame.fn || '?'}@${frame.file}`;
}

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type ErrorGrouping = {
  fingerprint: string;
  normalizedMessage: string;
  /** "fn (file)" of the first in-app frame, or of the first frame. */
  topFrame: string | null;
};

/**
 * sha1(name, normalized message, first three in-app frames), 16 hex characters.
 * Without in-app frames: name and message only.
 */
export async function groupError(input: {
  name: string;
  message: string;
  stack: string | null;
}): Promise<ErrorGrouping> {
  const frames = parseStack(input.stack);
  const inApp = frames.filter((frame) => frame.inApp);
  const normalizedMessage = normalizeMessage(input.message, { quoted: frames.length > 0 });
  const key = [input.name, normalizedMessage, ...inApp.slice(0, 3).map(frameKey)].join('\n');
  const top = inApp[0] ?? frames[0];
  return {
    fingerprint: (await sha1Hex(key)).slice(0, 16),
    normalizedMessage,
    topFrame: top ? `${top.fn || '<anonymous>'} (${top.file})` : null,
  };
}
