'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { ArrowLeft, BookOpen, LoaderCircle, Mail, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

type ContactPageClientProps = {
  supportEmail: string;
  initialEmail?: string;
};

export function ContactPageClient({ supportEmail, initialEmail = '' }: ContactPageClientProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [company, setCompany] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          subject,
          message,
          company,
        }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to send message');
      }

      setSent(true);
      setName('');
      setEmail('');
      setSubject('');
      setMessage('');
      setCompany('');
      toast.success('Message sent');
    } catch (cause) {
      const nextError = cause instanceof Error ? cause.message : 'Failed to send message';
      setError(nextError);
      toast.error(nextError);
    } finally {
      setSubmitting(false);
    }
  }

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = '/docs';
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto min-h-screen w-full max-w-screen-xl border-x border-border">
        <div className="relative min-h-screen">
          <div className="pointer-events-none absolute inset-0 hidden lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)_minmax(0,1fr)]">
            <div />
            <div className="border-x border-border" />
            <div />
          </div>

          <div className="relative flex min-h-screen flex-col justify-center">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)_minmax(0,1fr)]">
              <div className="hidden lg:block" />
              <div className="flex items-center gap-2.5 border-t border-border p-5">
                <Image
                  src="/logo.svg"
                  alt="OtaKit"
                  width={24}
                  height={24}
                  className="size-6 rounded-md"
                />
                <div>
                  <h1 className="text-2xl font-semibold">Contact support</h1>
                </div>
              </div>
              <div className="hidden lg:block" />
            </div>

            <div className="border-y border-border">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)_minmax(0,1fr)]">
                <div className="hidden lg:block" />
                <div className="p-5">
                  <div className="space-y-5">
                    {sent ? (
                      <div className="rounded-2xl border border-border p-5">
                        <p className="text-sm font-medium">Your message was sent.</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          We will reply from{' '}
                          <a
                            href={`mailto:${supportEmail}`}
                            className="underline underline-offset-4 hover:text-foreground"
                          >
                            {supportEmail}
                          </a>
                          .
                        </p>
                        <div className="mt-4">
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-full"
                            onClick={() => setSent(false)}
                          >
                            Send another message
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={submit} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="contact-name">Name</Label>
                          <Input
                            id="contact-name"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder="Your name"
                            autoComplete="name"
                            className="h-11"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="contact-email">Email</Label>
                          <Input
                            id="contact-email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="you@example.com"
                            autoComplete="email"
                            className="h-11"
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="contact-subject">Subject</Label>
                          <Input
                            id="contact-subject"
                            value={subject}
                            onChange={(event) => setSubject(event.target.value)}
                            placeholder="What do you need help with?"
                            className="h-11"
                            required
                          />
                        </div>

                        <div className="hidden">
                          <Label htmlFor="contact-company">Company</Label>
                          <Input
                            id="contact-company"
                            value={company}
                            onChange={(event) => setCompany(event.target.value)}
                            autoComplete="organization"
                            tabIndex={-1}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="contact-message">Message</Label>
                          <Textarea
                            id="contact-message"
                            value={message}
                            onChange={(event) => setMessage(event.target.value)}
                            placeholder="Describe your question, issue, or rollout situation."
                            className="min-h-32 resize-y"
                            required
                          />
                        </div>

                        {error ? <p className="text-sm text-destructive">{error}</p> : null}

                        <Button
                          type="submit"
                          className="h-11 w-full gap-2 rounded-full"
                          disabled={submitting}
                        >
                          {submitting ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Send className="size-4" />
                          )}
                          {submitting ? 'Sending...' : 'Send message'}
                        </Button>
                      </form>
                    )}

                    <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
                      <a
                        href={`mailto:${supportEmail}`}
                        className="group bg-background p-4 text-sm transition-colors hover:bg-muted/30"
                      >
                        <div className="flex items-center gap-2 text-foreground">
                          <Mail className="size-4 text-muted-foreground" />
                          <span className="font-medium">Email</span>
                        </div>
                        <div className="mt-2 text-muted-foreground underline-offset-4 group-hover:underline">
                          {supportEmail}
                        </div>
                      </a>
                      <Link
                        href="/docs"
                        className="group bg-background p-4 text-sm transition-colors hover:bg-muted/30"
                      >
                        <div className="flex items-center gap-2 text-foreground">
                          <BookOpen className="size-4 text-muted-foreground" />
                          <span className="font-medium">Docs</span>
                        </div>
                        <div className="mt-2 text-muted-foreground underline-offset-4 group-hover:underline">
                          Open documentation
                        </div>
                      </Link>
                    </div>
                  </div>
                </div>
                <div className="hidden lg:block" />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)_minmax(0,1fr)]">
              <div className="hidden lg:block" />
              <div className="flex items-center border-b border-border p-5">
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="size-4" />
                  Back
                </button>
              </div>
              <div className="hidden lg:block" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
