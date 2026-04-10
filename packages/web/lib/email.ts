import { Resend } from 'resend';
import { SUPPORT_EMAIL } from './support';

let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    resend = new Resend(key);
  }
  return resend;
}

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'OtaKit <noreply@otakit.app>';
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

async function sendEmail({ to, subject, html, text, replyTo }: SendEmailArgs): Promise<void> {
  const hasResendKey = Boolean(process.env.RESEND_API_KEY?.trim());

  // Dev fallback for local environments without a configured Resend key.
  if (!hasResendKey && process.env.NODE_ENV === 'development') {
    console.log(`[Email:dev:fallback]\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return;
  }

  if (!hasResendKey) {
    throw new Error('RESEND_API_KEY is not set');
  }

  const response = await getResendClient().emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
    text,
    replyTo: replyTo ? [replyTo] : undefined,
  });

  if (response.error) {
    throw new Error(`Resend failed: ${response.error.message}`);
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[Email:dev] Sent via Resend to ${to} (${subject})`);
  }
}

export async function sendOtpEmail(email: string, otp: string): Promise<void> {
  const safeOtp = escapeHtml(otp);

  const html = `
<p>Sign in to OtaKit</p>
<p>Your code:</p>
<p style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 32px; letter-spacing: 0.24em; font-weight: 700;">${safeOtp}</p>
<p>This code expires in 5 minutes.</p>
<p>If this was not you, ignore this email.</p>
  `.trim();

  const text = `Sign in to OtaKit

Your code: ${otp}
This code expires in 5 minutes.

If this was not you, ignore this email.`;

  await sendEmail({
    to: email,
    subject: 'Your OtaKit sign-in code',
    html,
    text,
  });
}

export async function sendInviteEmail(
  email: string,
  organizationName: string,
  role: string,
  invitedByEmail?: string,
): Promise<void> {
  const safeOrganizationName = escapeHtml(organizationName);
  const safeRole = escapeHtml(role);
  const safeInvitedBy = invitedByEmail ? escapeHtml(invitedByEmail) : '';
  const loginUrl = `${APP_URL}/login`;

  const invitedByHtml = safeInvitedBy ? `<p>Invited by: ${safeInvitedBy}</p>` : '';
  const invitedByText = invitedByEmail ? `\nInvited by: ${invitedByEmail}` : '';

  const html = `
<p>You're invited to <strong>${safeOrganizationName}</strong> on OtaKit.</p>
<p>Role: <strong>${safeRole}</strong></p>
${invitedByHtml}
<p><a href="${escapeHtml(loginUrl)}">Sign in to accept invite</a></p>
  `.trim();

  const text = `You're invited to ${organizationName} on OtaKit.
Role: ${role}${invitedByText}
Sign in to accept invite: ${loginUrl}`;

  await sendEmail({
    to: email,
    subject: `You're invited to ${organizationName} on OtaKit`,
    html,
    text,
  });
}

export async function sendTeamAccessGrantedEmail(
  email: string,
  organizationName: string,
  role: string,
  addedByEmail?: string,
): Promise<void> {
  const safeOrganizationName = escapeHtml(organizationName);
  const safeRole = escapeHtml(role);
  const safeAddedBy = addedByEmail ? escapeHtml(addedByEmail) : '';
  const dashboardUrl = `${APP_URL}/dashboard`;

  const addedByHtml = safeAddedBy ? `<p>Added by: ${safeAddedBy}</p>` : '';
  const addedByText = addedByEmail ? `\nAdded by: ${addedByEmail}` : '';

  const html = `
<p>You were added to <strong>${safeOrganizationName}</strong> on OtaKit.</p>
<p>Role: <strong>${safeRole}</strong></p>
${addedByHtml}
<p><a href="${escapeHtml(dashboardUrl)}">Open dashboard</a></p>
  `.trim();

  const text = `You were added to ${organizationName} on OtaKit.
Role: ${role}${addedByText}
Open dashboard: ${dashboardUrl}`;

  await sendEmail({
    to: email,
    subject: `You were added to ${organizationName} on OtaKit`,
    html,
    text,
  });
}

export async function sendUsageWarningEmail({
  to,
  organizationName,
  threshold,
  downloadsCount,
  limit,
  periodStart,
}: {
  to: string;
  organizationName: string;
  threshold: 90 | 100;
  downloadsCount: number;
  limit: number;
  periodStart: Date;
}): Promise<void> {
  const safeOrganizationName = escapeHtml(organizationName);
  const dashboardUrl = `${APP_URL}/dashboard/settings`;
  const subject =
    threshold === 100
      ? `Usage reached 100% for ${organizationName}`
      : `Usage reached 90% for ${organizationName}`;

  const period = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(periodStart);

  const html = `
<p>Usage alert for <strong>${safeOrganizationName}</strong>.</p>
<p>${threshold}% threshold reached for ${escapeHtml(period)}.</p>
<p>Downloads: <strong>${downloadsCount.toLocaleString()}</strong> / <strong>${limit.toLocaleString()}</strong></p>
<p><a href="${escapeHtml(dashboardUrl)}">Open settings</a></p>
  `.trim();

  const text = `Usage alert for ${organizationName}.
${threshold}% threshold reached for ${period}.
Downloads: ${downloadsCount.toLocaleString()} / ${limit.toLocaleString()}
Open settings: ${dashboardUrl}`;

  await sendEmail({
    to,
    subject,
    html,
    text,
  });
}

export async function sendSupportContactEmail({
  name,
  email,
  subject,
  message,
}: {
  name?: string;
  email: string;
  subject: string;
  message: string;
}): Promise<void> {
  const safeName = name ? escapeHtml(name) : '';
  const safeEmail = escapeHtml(email);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replaceAll('\n', '<br />');
  const senderLabel = safeName ? `${safeName} &lt;${safeEmail}&gt;` : safeEmail;

  const html = `
<p>New contact message from the OtaKit website.</p>
<p><strong>From:</strong> ${senderLabel}</p>
<p><strong>Subject:</strong> ${safeSubject}</p>
<p><strong>Message:</strong></p>
<p>${safeMessage}</p>
  `.trim();

  const text = `New contact message from the OtaKit website.

From: ${name ? `${name} <${email}>` : email}
Subject: ${subject}

${message}`;

  await sendEmail({
    to: SUPPORT_EMAIL,
    subject: `[Contact] ${subject}`,
    html,
    text,
    replyTo: email,
  });
}
