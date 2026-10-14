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
// A content hash in a file name: index-4f3a9c2b.js, main.4f3a9c2b.js, chunk-ABCD1234.mjs
const BUILD_HASH = /[-.]([A-Za-z0-9_]{6,})(?=\.m?[jt]sx?$)/;
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
  // Only strip a segment that looks like a hash: it has a digit, or is all
  // upper/lowercase hex, so names like "vendor-helpers.js" keep their words.
  const match = BUILD_HASH.exec(name);
  if (match && (/\d/.test(match[1]) || /^[A-F0-9]+$/i.test(match[1]))) {
    name = name.slice(0, match.index) + name.slice(match.index + match[0].length);
  }
  return directory + name;
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

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX = /\b(?:0x)?[0-9a-f]{8,}\b/gi;
const QUOTED = /(["'`])(?:\\.|(?!\1).)*\1/g;
// Digits glued to units count too: "2.5s", "30000ms".
const NUMBER = /\d+(?:\.\d+)?/g;

/** The message with its variable parts replaced, so "id 123 not found" and "id 456 not found" group. */
export function normalizeMessage(message: string): string {
  return message
    .replace(UUID, '<id>')
    .replace(QUOTED, '<str>')
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
  const normalizedMessage = normalizeMessage(input.message);
  const key = [input.name, normalizedMessage, ...inApp.slice(0, 3).map(frameKey)].join('\n');
  const top = inApp[0] ?? frames[0];
  return {
    fingerprint: (await sha1Hex(key)).slice(0, 16),
    normalizedMessage,
    topFrame: top ? `${top.fn || '<anonymous>'} (${top.file})` : null,
  };
}
