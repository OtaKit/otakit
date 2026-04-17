import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const checkDb = url.searchParams.get('db') === 'true';

  if (!checkDb) {
    return NextResponse.json({ status: 'ok' });
  }

  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json(
      { status: 'error', message: 'database unreachable' },
      { status: 503 },
    );
  }
}
