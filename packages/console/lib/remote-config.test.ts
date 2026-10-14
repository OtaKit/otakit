import { describe, expect, it } from 'vitest';

import {
  configKeyChanges,
  configSecretWarnings,
  MAX_CONFIG_BYTES,
  validateConfigValues,
} from './remote-config';

describe('validateConfigValues', () => {
  it('serializes an object once, exactly as devices receive it', () => {
    expect(validateConfigValues({ b: 1, a: [true, null, 'ü'], nested: { x: 1.5 } })).toEqual({
      ok: true,
      values: { b: 1, a: [true, null, 'ü'], nested: { x: 1.5 } },
      valuesJson: '{"b":1,"a":[true,null,"ü"],"nested":{"x":1.5}}',
      warnings: [],
    });
    expect(validateConfigValues({})).toMatchObject({ ok: true, valuesJson: '{}' });
  });

  it('refuses anything that is not a plain JSON object', () => {
    for (const input of [null, [], 'text', 1, true]) {
      expect(validateConfigValues(input)).toMatchObject({ ok: false });
    }
    expect(validateConfigValues({ n: Number.NaN })).toEqual({
      ok: false,
      error: 'n must be a finite number',
    });
    expect(validateConfigValues({ deep: { list: [1, Infinity] } })).toEqual({
      ok: false,
      error: 'deep.list[1] must be a finite number',
    });
    expect(validateConfigValues({ fn: () => 1 })).toMatchObject({ ok: false });
    expect(validateConfigValues({ u: undefined })).toMatchObject({ ok: false });
  });

  it('checks keys, reserved names, key count and size in bytes', () => {
    expect(validateConfigValues({ 'has space': 1 })).toMatchObject({ ok: false });
    expect(validateConfigValues({ ['k'.repeat(65)]: 1 })).toMatchObject({ ok: false });
    expect(validateConfigValues({ constructor: 1 })).toEqual({
      ok: false,
      error: '"constructor" cannot be a config key',
    });
    expect(
      validateConfigValues(Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, i]))),
    ).toMatchObject({ ok: false, error: 'Config can have at most 200 top-level keys' });
    // Multi-byte characters count as bytes, not characters.
    const almost = 'ü'.repeat((MAX_CONFIG_BYTES - 10) / 2);
    expect(validateConfigValues({ a: almost })).toMatchObject({ ok: true });
    expect(validateConfigValues({ a: `${almost}üü` })).toMatchObject({ ok: false });
  });
});

describe('configSecretWarnings', () => {
  it('flags secret-like names and key-like values, not ordinary config', () => {
    expect(
      configSecretWarnings({
        apiKey: 'x',
        private_key: 'x',
        authToken: 'x',
        githubToken: 'ghp_abcdefghijklmnopqrstuvwxyz',
        session:
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        aws: 'AKIAIOSFODNN7EXAMPLE',
        digest: 'a'.repeat(64),
        helpUrl: 'https://example.com/a-very-long-path/that-is-not-a-secret/at-all',
        banner: 'Back at 14:00 — thanks for your patience while we upgrade our servers',
        tokensPerMonth: 'x',
        API_KEY: 'x',
        keyboardLayout: 'qwerty',
      }).map((warning) => warning.key),
    ).toEqual([
      'apiKey',
      'private_key',
      'authToken',
      'githubToken',
      'session',
      'aws',
      'digest',
      'API_KEY',
    ]);
  });
});

describe('configKeyChanges', () => {
  it('lists added, changed and removed keys, ignoring inherited names', () => {
    expect(configKeyChanges({ a: 1, b: { x: 1 }, c: 3 }, { a: 1, b: { x: 2 }, d: 4 })).toEqual({
      added: ['d'],
      changed: ['b'],
      removed: ['c'],
    });
    expect(configKeyChanges(null, { toString: 1 })).toEqual({
      added: ['toString'],
      changed: [],
      removed: [],
    });
  });
});
