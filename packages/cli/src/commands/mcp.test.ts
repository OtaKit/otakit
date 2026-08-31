import { describe, expect, it } from 'vitest';

import { localMcpContextPath } from './mcp.js';

describe('local MCP connection context', () => {
  it('anchors startup to the configured project app', () => {
    expect(localMcpContextPath('app/project & team')).toBe(
      '/api/v1/context?appId=app%2Fproject+%26+team',
    );
  });

  it('leaves app-less startup available for sole memberships and explicit selection', () => {
    expect(localMcpContextPath(null)).toBe('/api/v1/context');
    expect(localMcpContextPath('   ')).toBe('/api/v1/context');
  });
});
