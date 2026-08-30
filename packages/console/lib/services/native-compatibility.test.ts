import { describe, expect, it } from 'vitest';

import { compareBundleNativePackages } from './native-compatibility';

describe('server-side native compatibility', () => {
  it('detects changed native code and new plugins', () => {
    const result = compareBundleNativePackages(
      [
        { name: 'existing', version: '2.0.0', iosChecksum: 'new' },
        { name: 'added', version: '1.0.0', androidChecksum: 'added' },
      ],
      [{ name: 'existing', version: '1.0.0', iosChecksum: 'old' }],
    );

    expect(result.status).toBe('incompatible');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'existing', kind: 'native_code_changed' }),
        expect.objectContaining({ name: 'added', kind: 'new_plugin' }),
      ]),
    );
  });

  it('treats identical code and removals as compatible', () => {
    const result = compareBundleNativePackages(
      [{ name: 'kept', version: '2.0.0', iosChecksum: 'same' }],
      [
        { name: 'kept', version: '1.0.0', iosChecksum: 'same' },
        { name: 'removed', version: '1.0.0' },
      ],
    );

    expect(result.status).toBe('compatible');
    expect(result.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'removed', kind: 'removed' })]),
    );
  });

  it('reports missing evidence instead of claiming compatibility', () => {
    expect(compareBundleNativePackages(null, []).status).toBe('skipped');
    expect(compareBundleNativePackages([], null)).toMatchObject({
      status: 'skipped',
      reason: 'current_release_missing_metadata',
    });
  });
});
