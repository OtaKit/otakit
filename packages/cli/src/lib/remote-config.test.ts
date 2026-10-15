import { describe, expect, it } from 'vitest';

import type { RemoteConfigState } from './api.js';
import {
  describeKeyChanges,
  describeValue,
  formatRemoteConfig,
  formatRemoteConfigHistory,
  parseConfigValue,
} from './remote-config.js';

const live: RemoteConfigState = {
  appId: 'app',
  channel: 'production',
  version: 12,
  status: 'live',
  values: { checkoutEnabled: false },
  message: 'Partner outage',
  updatedBy: 'dev@acme.com',
  updatedAt: '2026-10-14T09:00:00.000Z',
  usesBaseConfig: false,
  publicationStatus: 'published',
  fileUrl: 'https://cdn.otakit.app/config/app/production/config.json',
};

describe('parseConfigValue', () => {
  it('reads JSON when it parses and text otherwise', () => {
    expect(parseConfigValue('false')).toBe(false);
    expect(parseConfigValue('5')).toBe(5);
    expect(parseConfigValue('{"a":[1,2]}')).toEqual({ a: [1, 2] });
    expect(parseConfigValue('"5"')).toBe('5');
    expect(parseConfigValue('null')).toBeNull();
    expect(parseConfigValue('https://example.com/help')).toBe('https://example.com/help');
    expect(parseConfigValue('Back at 14:00')).toBe('Back at 14:00');
    expect(parseConfigValue('5', true)).toBe('5');
    expect(parseConfigValue('false', true)).toBe('false');
  });

  it('keeps numbers that would not read back as typed as text', () => {
    expect(parseConfigValue('1.10')).toBe('1.10');
    expect(parseConfigValue('2.0')).toBe('2.0');
    expect(parseConfigValue('1e3')).toBe('1e3');
    expect(parseConfigValue('12345678901234567890')).toBe('12345678901234567890');
    expect(parseConfigValue('-3.5')).toBe(-3.5);
    expect(describeValue('1.10')).toBe('"1.10" (text)');
    expect(describeValue(false)).toBe('false (boolean)');
    expect(describeValue([1])).toBe('[1] (list)');
  });
});

describe('formatRemoteConfig', () => {
  it('shows the version, author, message and values', () => {
    expect(formatRemoteConfig(live)).toBe(
      [
        'channel "production": version 12, by dev@acme.com (2026-10-14T09:00:00.000Z)',
        '“Partner outage”',
        '',
        '{\n  "checkoutEnabled": false\n}',
      ].join('\n'),
    );
  });

  it('explains channels without config and deleted config', () => {
    expect(
      formatRemoteConfig({
        ...live,
        status: 'none',
        version: 0,
        values: null,
        usesBaseConfig: true,
      }),
    ).toBe(
      'channel "production" has no config of its own. Its devices use the base channel\'s config.',
    );
    expect(
      formatRemoteConfig({ ...live, channel: null, status: 'none', version: 0, values: null }),
    ).toBe('The base channel has no remote config. Apps use their code defaults.');
    expect(formatRemoteConfig({ ...live, status: 'deleted', version: 13, values: null })).toBe(
      'channel "production": config deleted in version 13 by dev@acme.com.\nIts devices use the base channel\'s config.',
    );
  });
});

describe('describeKeyChanges and history', () => {
  it('summarizes what a replace does', () => {
    expect(describeKeyChanges({ a: 1, b: 2, c: 3 }, { a: 1, b: 3, d: 4 })).toBe(
      'add d; change b; remove c',
    );
    expect(describeKeyChanges(null, {})).toBe('no changes');
    expect(describeKeyChanges(null, { toString: 1 })).toBe('add toString');
  });

  it('lists versions newest first', () => {
    expect(
      formatRemoteConfigHistory([
        {
          version: 2,
          deleted: true,
          values: null,
          message: null,
          createdBy: 'ci',
          createdAt: '2026-10-14T10:00:00.000Z',
        },
        {
          version: 1,
          deleted: false,
          values: { a: 1 },
          message: 'First',
          createdBy: 'dev@acme.com',
          createdAt: '2026-10-14T09:00:00.000Z',
        },
      ]),
    ).toBe(
      'v2  2026-10-14T10:00:00.000Z  ci  deleted\nv1  2026-10-14T09:00:00.000Z  dev@acme.com  1 key  “First”',
    );
  });
});
