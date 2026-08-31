import { describe, expect, it } from 'vitest';

import { compareNative } from './native-deps.js';

describe('compareNative', () => {
  it('does not clear a release when the local scan found nothing at all', () => {
    // A pruned install, a workspace subdirectory, or a plugin declared only in
    // devDependencies all yield an empty local set. Treating every recorded
    // package as a safe removal would report "compatible" on no evidence.
    const result = compareNative([], [{ name: '@capacitor/camera', version: '7.0.1' }]);
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('no_local_native_packages');
  });

  it('still reports a genuine single removal as compatible', () => {
    const result = compareNative(
      [{ name: '@capacitor/app', version: '7.0.0' }],
      [
        { name: '@capacitor/app', version: '7.0.0' },
        { name: '@capacitor/camera', version: '7.0.1' },
      ],
    );
    expect(result.status).toBe('compatible');
    expect(result.findings.find((f) => f.name === '@capacitor/camera')?.kind).toBe('removed');
  });

  it('reports a missing baseline separately from a missing local scan', () => {
    expect(compareNative([], null).reason).toBe('no_remote_baseline');
    expect(compareNative([], []).status).toBe('compatible');
  });
});
