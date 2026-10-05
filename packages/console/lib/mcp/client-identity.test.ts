import { describe, expect, it } from 'vitest';

import { oauthClientOrigin } from './client-identity';

describe('oauthClientOrigin', () => {
  it('shows the proven origin of a metadata-document client, not its homepage', () => {
    expect(
      oauthClientOrigin(
        'https://connect.smithery.ai/.well-known/oauth-client',
        'https://smithery.ai',
      ),
    ).toBe('https://connect.smithery.ai');
    // A lookalike cannot borrow another site's homepage as its identity.
    expect(oauthClientOrigin('https://evil.example/client.json', 'https://claude.ai')).toBe(
      'https://evil.example',
    );
  });

  it('keeps the registered client_uri for dynamically registered clients', () => {
    expect(oauthClientOrigin('kXq2p9VZ3mWb7rTn', 'https://glama.ai')).toBe('https://glama.ai');
    expect(oauthClientOrigin('kXq2p9VZ3mWb7rTn', null)).toBeNull();
  });

  it('does not treat a non-https client ID as proven', () => {
    expect(oauthClientOrigin('http://client.example/client.json', 'https://claude.ai')).toBe(
      'https://claude.ai',
    );
  });
});
