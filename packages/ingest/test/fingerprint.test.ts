import { describe, expect, it } from 'vitest';

import { groupError, normalizeFile, normalizeMessage, parseStack } from '../src/fingerprint';

// Real-shaped stacks from production builds of the same code, built twice
// (different chunk hashes), on both WebView engines.
const V8_BUILD_A = `TypeError: Cannot read properties of undefined (reading 'total')
    at computeTotal (https://localhost/assets/index-4f3a9c2b.js:12:3401)
    at onCheckout (https://localhost/assets/index-4f3a9c2b.js:18:220)
    at HTMLButtonElement.<anonymous> (https://localhost/assets/index-4f3a9c2b.js:2:9912)
    at invokeGuardedCallback (https://localhost/assets/vendor-react-9a8b7c6d.js:1:1200)`;
const V8_BUILD_B = V8_BUILD_A.replaceAll('index-4f3a9c2b', 'index-77d1e0aa')
  .replaceAll(':12:3401', ':12:3519')
  .replaceAll('vendor-react-9a8b7c6d', 'vendor-react-1b2c3d4e');
const JSC_BUILD_A = `computeTotal@capacitor://localhost/assets/index-4f3a9c2b.js:12:3401
onCheckout@capacitor://localhost/assets/index-4f3a9c2b.js:18:220
@capacitor://localhost/assets/index-4f3a9c2b.js:2:9912
invokeGuardedCallback@capacitor://localhost/assets/vendor-react-9a8b7c6d.js:1:1200`;
const JSC_BUILD_B = JSC_BUILD_A.replaceAll('index-4f3a9c2b', 'index.0c1d2e3f').replaceAll(
  'vendor-react-9a8b7c6d',
  'vendor-react-ffeeddcc',
);

describe('parseStack', () => {
  it('reads V8 frames with and without function names', () => {
    expect(parseStack(V8_BUILD_A)).toEqual([
      { fn: 'computeTotal', file: 'assets/index.js', line: 12, column: 3401, inApp: true },
      { fn: 'onCheckout', file: 'assets/index.js', line: 18, column: 220, inApp: true },
      {
        fn: 'HTMLButtonElement.<anonymous>',
        file: 'assets/index.js',
        line: 2,
        column: 9912,
        inApp: true,
      },
      {
        fn: 'invokeGuardedCallback',
        file: 'assets/vendor-react.js',
        line: 1,
        column: 1200,
        inApp: false,
      },
    ]);
    expect(parseStack('Error: x\n    at https://localhost/main.js:1:2')).toEqual([
      { fn: '', file: 'main.js', line: 1, column: 2, inApp: true },
    ]);
  });

  it('reads JavaScriptCore frames, including anonymous and global code', () => {
    const frames = parseStack(
      `${JSC_BUILD_A}\nglobal code@capacitor://localhost/index.html:5:10\n[native code]`,
    );
    expect(frames.map((frame) => [frame.fn, frame.file, frame.inApp])).toEqual([
      ['computeTotal', 'assets/index.js', true],
      ['onCheckout', 'assets/index.js', true],
      ['', 'assets/index.js', true],
      ['invokeGuardedCallback', 'assets/vendor-react.js', false],
      ['', 'index.html', true],
    ]);
  });

  it('ignores lines that are not frames', () => {
    expect(parseStack('Error: boom\nsome text\n')).toEqual([]);
    expect(parseStack(null)).toEqual([]);
  });
});

describe('normalizeFile', () => {
  it('strips origins, queries and build hashes, and keeps real names', () => {
    expect(normalizeFile('capacitor://localhost/assets/index-4f3a9c2b.js')).toBe('assets/index.js');
    expect(normalizeFile('http://10.0.2.2:8100/main.1a2b3c4d.js?v=3#x')).toBe('main.js');
    expect(normalizeFile('https://localhost/static/js/chunk-ABCDEF12.mjs')).toBe(
      'static/js/chunk.mjs',
    );
    expect(normalizeFile('https://localhost/assets/vendor-helpers.js')).toBe(
      'assets/vendor-helpers.js',
    );
    expect(normalizeFile('https://localhost/polyfills.js')).toBe('polyfills.js');
  });

  it('strips Vite, Rollup, esbuild and webpack hashes without a digit', () => {
    expect(normalizeFile('https://localhost/assets/index-BkMqTaYz.js')).toBe('assets/index.js');
    expect(normalizeFile('https://localhost/assets/index-Bk-qT5Y2.js')).toBe('assets/index.js');
    expect(normalizeFile('https://localhost/assets/use-feedback-Dq_xMbwA.js')).toBe(
      'assets/use-feedback.js',
    );
    expect(normalizeFile('https://localhost/chunk-ABCDEFGH.js')).toBe('chunk.js');
    expect(normalizeFile('https://localhost/main-QWERTYUI.js')).toBe('main.js');
    expect(normalizeFile('https://localhost/static/js/787.e5f6a7b8.chunk.js')).toBe(
      'static/js/787.chunk.js',
    );
    // Lowercase words stay.
    expect(normalizeFile('https://localhost/assets/use-feedback.js')).toBe(
      'assets/use-feedback.js',
    );
    expect(normalizeFile('https://localhost/assets/page-settings.js')).toBe(
      'assets/page-settings.js',
    );
  });
});

describe('normalizeMessage', () => {
  it('replaces numbers, IDs and quoted values', () => {
    expect(normalizeMessage("Cannot read properties of undefined (reading 'total')")).toBe(
      'Cannot read properties of undefined (reading <str>)',
    );
    expect(normalizeMessage('Order 12345 failed after 2.5s')).toBe('Order <n> failed after <n>s');
    expect(normalizeMessage('User 3fa85f64-5717-4562-b3fc-2c963f66afa6 not found')).toBe(
      'User <id> not found',
    );
    expect(normalizeMessage('Request deadbeef0123 timed out')).toBe('Request <id> timed out');
  });

  it('keeps only the normalized path of URLs', () => {
    expect(
      normalizeMessage(
        'Failed to fetch dynamically imported module: https://localhost/assets/Page-BkMqT5Y2.js',
      ),
    ).toBe('Failed to fetch dynamically imported module: assets/Page.js');
    expect(normalizeMessage('Session expired, sign in again at https://evil.example')).toBe(
      'Session expired, sign in again at <url>',
    );
    expect(normalizeMessage('GET https://api.example.com/v1/users/123?token=abc failed')).toBe(
      'GET v<n>/users/<n> failed',
    );
  });
});

describe('groupError', () => {
  const error = (
    stack: string,
    message = "Cannot read properties of undefined (reading 'total')",
  ) => groupError({ name: 'TypeError', message, stack });

  it('gives the same error the same fingerprint across builds', async () => {
    const [a, b] = await Promise.all([error(V8_BUILD_A), error(V8_BUILD_B)]);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(a.fingerprint).toBe(b.fingerprint);
    const [c, d] = await Promise.all([error(JSC_BUILD_A), error(JSC_BUILD_B)]);
    expect(c.fingerprint).toBe(d.fingerprint);
    expect(a.topFrame).toBe('computeTotal (assets/index.js)');
  });

  it('separates errors from different code or with different messages', async () => {
    const base = await error(V8_BUILD_A);
    const otherCode = await error(V8_BUILD_A.replace('computeTotal', 'computeTax'));
    const otherMessage = await error(V8_BUILD_A, 'Network request failed');
    expect(new Set([base.fingerprint, otherCode.fingerprint, otherMessage.fingerprint]).size).toBe(
      3,
    );
  });

  it('keeps quoted values apart when there is no stack to tell errors apart', async () => {
    const timeout = await groupError({
      name: 'UnhandledRejection',
      message: '{"code":"E_TIMEOUT","attempt":2}',
      stack: null,
    });
    const auth = await groupError({
      name: 'UnhandledRejection',
      message: '{"code":"E_AUTH","attempt":2}',
      stack: null,
    });
    expect(timeout.normalizedMessage).toBe('{"code":"E_TIMEOUT","attempt":<n>}');
    expect(timeout.fingerprint).not.toBe(auth.fingerprint);
  });

  it('groups by name and message when there is no stack', async () => {
    const a = await groupError({ name: 'Error', message: 'Timeout after 30000ms', stack: null });
    const b = await groupError({ name: 'Error', message: 'Timeout after 15000ms', stack: '' });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.topFrame).toBeNull();
  });
});
