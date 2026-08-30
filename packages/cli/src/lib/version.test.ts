import { describe, expect, it } from 'vitest';

import { CLI_VERSION, getCliUserAgent, readCliVersion } from './version.js';

describe('CLI version metadata', () => {
  it('reads the publishable package version instead of using the fallback', () => {
    expect(readCliVersion()).toBe('1.5.0');
    expect(CLI_VERSION).toBe('1.5.0');
    expect(getCliUserAgent()).toBe('otakit-cli/1.5.0');
  });
});
