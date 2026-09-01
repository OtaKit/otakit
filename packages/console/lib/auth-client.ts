'use client';

import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';

export const authClient = createAuthClient({
  plugins: [emailOTPClient(), oauthProviderClient()],
});
