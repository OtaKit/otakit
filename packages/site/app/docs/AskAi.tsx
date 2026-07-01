'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles, X, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { site } from '@/lib/site';

/* Floating "Ask AI" launcher for the docs. Opens ChatGPT (or Claude) in a new
   tab with a prompt that points the model at our llms.txt plus the page the
   reader is currently on, so they can start asking questions right away.

   Note on submit behaviour: since April 2025 ChatGPT will NOT auto-submit a
   `?q=` prompt that arrives via a cross-site link (anti prompt-injection, keyed
   off sec-fetch-site), so the prompt is only prefilled — the reader hits Enter.
   We also copy the prompt to the clipboard on click, because when the user is
   logged out ChatGPT's login redirect drops the query param entirely; the
   clipboard copy means it's still one paste away. */
function buildPrompt(pageUrl: string): string {
  return (
    `I'm reading the OtaKit docs and have a question. ` +
    `Please read this page: ${pageUrl} ` +
    `(and ${site.url}/docs/llms.txt for the full docs map) and help me. ` +
    `OtaKit is open-source over-the-air live updates for Capacitor apps.`
  );
}

const targets = [
  {
    label: 'Ask ChatGPT',
    href: (prompt: string) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
  },
  {
    label: 'Ask Claude',
    href: (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  },
] as const;

export function AskAi() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pageUrl = `${site.url}${pathname}`;
  const prompt = buildPrompt(pageUrl);

  return (
    <div ref={rootRef} className="fixed bottom-5 right-5 z-50 print:hidden">
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-48 origin-bottom-right overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg duration-150 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2">
          {targets.map((t) => (
            <a
              key={t.label}
              href={t.href(prompt)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                // Best-effort fallback: if the AI app drops the query param
                // (e.g. logged-out login redirect), the prompt is still on the
                // clipboard ready to paste.
                navigator.clipboard?.writeText(prompt).catch(() => {});
                setOpen(false);
              }}
              className="block px-4 py-2.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t.label}
            </a>
          ))}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard
                ?.writeText(prompt)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => {});
              setOpen(false);
            }}
            className="block w-full border-t border-border px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Copy starter prompt
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close ask AI menu' : 'Ask AI about these docs'}
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-full border border-border bg-background/80 px-3.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur transition-[colors,transform] hover:bg-background hover:text-foreground active:scale-95"
      >
        <span className="grid size-4 place-items-center">
          {open ? (
            <X className="size-4" strokeWidth={2} aria-hidden="true" />
          ) : copied ? (
            <Check className={cn('size-4 text-emerald-500')} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Sparkles className="size-4 text-primary" strokeWidth={2} aria-hidden="true" />
          )}
        </span>
        <span className="hidden sm:inline">Ask AI</span>
      </button>
    </div>
  );
}
