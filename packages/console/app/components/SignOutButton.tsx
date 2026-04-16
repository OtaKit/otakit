'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await authClient.signOut();
          router.push('/login');
        } finally {
          setLoading(false);
        }
      }}
    >
      <LogOut />
      {loading ? 'Signing out...' : 'Sign out'}
    </Button>
  );
}
