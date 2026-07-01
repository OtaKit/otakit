'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function Pre({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard
      ?.writeText(children)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <div className="group relative mt-3">
      <pre className="overflow-x-auto rounded-lg border bg-muted px-4 py-3 font-mono text-xs leading-6 text-muted-foreground">
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-500" strokeWidth={2} aria-hidden />
        ) : (
          <Copy className="size-3.5" strokeWidth={2} aria-hidden />
        )}
      </button>
    </div>
  );
}
