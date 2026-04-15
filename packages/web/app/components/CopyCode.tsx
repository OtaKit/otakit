'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="m-2 inline-flex items-center gap-1.5 rounded bg-amber-950/20 px-2 py-0.5 font-mono text-sm font-bold tracking-wider transition-colors hover:bg-amber-950/30"
    >
      {code}
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}
