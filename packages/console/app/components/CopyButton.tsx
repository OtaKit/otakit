'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function CopyButton({
  value,
  label,
  className,
  children,
}: {
  value: string;
  label: string;
  className?: string;
  /** Rendered beside the icon when the button needs a visible label. */
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(children ? 'h-7 gap-1.5 px-2' : 'size-7 shrink-0 p-0', className)}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={() => {
        // Unavailable on a self-hosted console served over plain HTTP, so
        // confirm from the write rather than assuming it succeeded.
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => toast.error('Could not copy. Select the text and copy it manually.'));
      }}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      {children}
    </Button>
  );
}
