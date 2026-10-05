import { describe, expect, it } from 'vitest';

import { withMcpRegistrationDefaults } from './client-registration';

describe('dynamic client registration defaults', () => {
  it('makes loopback and private-use clients native public clients with refresh', () => {
    for (const redirectUri of [
      'http://127.0.0.1:33418/callback',
      'http://localhost:6274/oauth/callback',
      'http://[::1]:8080/cb',
      'com.example.agent:/oauth/callback',
    ]) {
      expect(withMcpRegistrationDefaults({ redirect_uris: [redirectUri] })).toEqual({
        redirect_uris: [redirectUri],
        application_type: 'native',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
      });
    }
  });

  it('keeps web clients on the RFC 7591 auth method default but allows refresh', () => {
    expect(
      withMcpRegistrationDefaults({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }),
    ).toEqual({
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token'],
    });
    // A mixed set stays web, so Better Auth rejects the loopback URI as before.
    expect(
      withMcpRegistrationDefaults({
        redirect_uris: ['http://127.0.0.1:33418/callback', 'https://example.com/cb'],
      }),
    ).toEqual({
      redirect_uris: ['http://127.0.0.1:33418/callback', 'https://example.com/cb'],
      grant_types: ['authorization_code', 'refresh_token'],
    });
  });

  it('never overrides a value the client sent', () => {
    const explicit = {
      redirect_uris: ['http://127.0.0.1:33418/callback'],
      application_type: 'native',
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code'],
    };
    expect(withMcpRegistrationDefaults(explicit)).toBe(explicit);

    expect(
      withMcpRegistrationDefaults({
        redirect_uris: ['http://127.0.0.1:33418/callback'],
        application_type: 'web',
        grant_types: ['authorization_code'],
      }),
    ).toEqual({
      redirect_uris: ['http://127.0.0.1:33418/callback'],
      application_type: 'web',
      grant_types: ['authorization_code'],
    });
  });

  it('leaves malformed bodies for Better Auth to reject', () => {
    for (const body of [
      null,
      'x',
      [],
      { redirect_uris: [], grant_types: ['authorization_code'] },
    ]) {
      expect(withMcpRegistrationDefaults(body)).toBe(body);
    }
  });
});
