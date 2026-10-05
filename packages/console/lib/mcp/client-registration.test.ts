import { describe, expect, it } from 'vitest';

import { withNativeApplicationTypeDefault } from './client-registration';

describe('dynamic client registration application_type default', () => {
  it('treats loopback and private-use redirect URIs as a native client', () => {
    for (const redirectUri of [
      'http://127.0.0.1:33418/callback',
      'http://localhost:6274/oauth/callback',
      'http://[::1]:8080/cb',
      'com.example.agent:/oauth/callback',
    ]) {
      expect(withNativeApplicationTypeDefault({ redirect_uris: [redirectUri] })).toEqual({
        redirect_uris: [redirectUri],
        application_type: 'native',
      });
    }
  });

  it('leaves web clients, explicit types and malformed bodies unchanged', () => {
    const cases: unknown[] = [
      { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
      { redirect_uris: ['http://127.0.0.1:33418/callback', 'https://example.com/cb'] },
      { redirect_uris: ['http://example.com/cb'] },
      { redirect_uris: ['http://127.0.0.1:33418/callback'], application_type: 'web' },
      { redirect_uris: [] },
      { redirect_uris: 'http://127.0.0.1/cb' },
      {},
      null,
    ];
    for (const body of cases) {
      expect(withNativeApplicationTypeDefault(body)).toBe(body);
    }
  });
});
