'use client';

import { toast } from 'sonner';

/**
 * Renders a button that copies the support email to the clipboard instead of
 * navigating anywhere. Falls back to showing the address if the clipboard is
 * unavailable (non-secure context, old browser).
 */
export function CopyEmailLink({
  email,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { email: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
      toast.success(`${email} copied to clipboard`);
    } catch {
      toast.info(`Email us at ${email}`);
    }
  }

  return (
    <button type="button" className={className} onClick={copy} {...props}>
      {children}
    </button>
  );
}
