import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET as glama } from './glama.json/route';
import { GET as openai } from './openai-apps-challenge/route';

describe('directory domain verification', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('serves nothing until the tokens are configured', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', '');
    vi.stubEnv('GLAMA_CONNECTOR_CLAIM', '');
    expect(openai().status).toBe(404);
    expect(glama().status).toBe(404);
  });

  it('serves the configured tokens in the formats the directories read', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', ' openai-token ');
    vi.stubEnv('GLAMA_CONNECTOR_CLAIM', 'glama_claim_abc');
    const challenge = openai();
    expect(challenge.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await challenge.text()).toBe('openai-token');
    expect(await glama().json()).toEqual({
      $schema: 'https://glama.ai/mcp/schemas/connector.json',
      claim: 'glama_claim_abc',
    });
  });
});
