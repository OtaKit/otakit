import { NextRequest, NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/session';
import { db } from '@/lib/db';
import { sendInviteEmail, sendTeamAccessGrantedEmail } from '@/lib/email';

export const runtime = 'nodejs';

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const invites = await db.organizationInvite.findMany({
    where: { organizationId: ctx.organizationId, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawEmail = body.email;
  if (typeof rawEmail !== 'string') {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();
  if (email.length < 3 || !email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  const rawRole = body.role;
  if (rawRole === 'owner' && ctx.role !== 'owner') {
    return NextResponse.json({ error: 'Only owners can assign owner role' }, { status: 403 });
  }

  const role =
    rawRole === 'admin'
      ? ('admin' as const)
      : rawRole === 'owner'
        ? ('owner' as const)
        : ('member' as const);

  // Check if already a member
  const existingUser = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    const existingMember = await db.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: ctx.organizationId, userId: existingUser.id },
      },
    });
    if (existingMember) {
      return NextResponse.json({ error: 'User is already a member' }, { status: 409 });
    }
  }

  // Check for duplicate pending invite (same email + organization)
  if (!existingUser) {
    const existingInvite = await db.organizationInvite.findFirst({
      where: { organizationId: ctx.organizationId, email, acceptedAt: null },
    });
    if (existingInvite) {
      return NextResponse.json({ error: 'Invite already pending for this email' }, { status: 409 });
    }
  }

  const invite = await db.organizationInvite.create({
    data: {
      organizationId: ctx.organizationId,
      email,
      role,
      createdByUserId: ctx.userId,
    },
  });
  console.log(
    JSON.stringify({
      audit: 'invite_created',
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      inviteEmail: email,
      role,
      timestamp: new Date().toISOString(),
    }),
  );

  const organization = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { name: true },
  });
  const organizationName = organization?.name ?? 'your organization';
  const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'}/login`;
  const shouldSendEmails = process.env.NODE_ENV !== 'development' || !!process.env.RESEND_API_KEY;

  // If the user already exists, immediately attach them as a member
  if (existingUser) {
    await db.organizationMember.create({
      data: { organizationId: ctx.organizationId, userId: existingUser.id, role },
    });
    await db.organizationInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    if (shouldSendEmails) {
      try {
        await sendTeamAccessGrantedEmail(email, organizationName, role, ctx.email);
      } catch (error) {
        console.error('[Email] Failed to send membership email', error);
      }
    } else {
      console.log(
        `[Email:dev] Added member ${email} to ${organizationName} as ${role}. Dashboard: ${loginUrl}`,
      );
    }
  } else {
    if (shouldSendEmails) {
      try {
        await sendInviteEmail(email, organizationName, role, ctx.email);
      } catch (error) {
        await db.organizationInvite.delete({ where: { id: invite.id } }).catch(() => {});
        console.error('[Email] Failed to send invite email', error);
        return NextResponse.json(
          { error: 'Failed to send invite email. Please retry.' },
          { status: 502 },
        );
      }
    } else {
      console.log(
        `[Email:dev] Invite to: ${email}, Org: ${organizationName}, Role: ${role}\n` +
          `  Link: ${loginUrl}`,
      );
    }
  }

  return NextResponse.json(
    {
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        accepted: !!existingUser,
      },
    },
    { status: 201 },
  );
}
