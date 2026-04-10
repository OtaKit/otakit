import { NextRequest, NextResponse } from 'next/server';

import { sendSupportContactEmail } from '@/lib/email';

export const runtime = 'nodejs';

type ContactBody = {
  name?: unknown;
  email?: unknown;
  subject?: unknown;
  message?: unknown;
  company?: unknown;
};

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: NextRequest) {
  let body: ContactBody;
  try {
    body = (await request.json()) as ContactBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const honeypot = asTrimmedString(body.company);
  if (honeypot) {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  const name = asTrimmedString(body.name);
  const email = asTrimmedString(body.email).toLowerCase();
  const subject = asTrimmedString(body.subject);
  const message = asTrimmedString(body.message);

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  if (name.length > 120) {
    return NextResponse.json({ error: 'Name is too long' }, { status: 400 });
  }

  if (subject.length < 3 || subject.length > 160) {
    return NextResponse.json(
      { error: 'Subject must be between 3 and 160 characters' },
      { status: 400 },
    );
  }

  if (message.length < 10 || message.length > 5000) {
    return NextResponse.json(
      { error: 'Message must be between 10 and 5000 characters' },
      { status: 400 },
    );
  }

  try {
    await sendSupportContactEmail({
      name: name || undefined,
      email,
      subject,
      message,
    });

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send message';
    const status = message.includes('RESEND_API_KEY is not set') ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
