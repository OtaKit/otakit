import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';

import { previewPageUrl } from '@/lib/preview-links';
import { getPublicPreview } from '@/lib/services/previews';

export const runtime = 'nodejs';

/** PNG QR code of an active preview page (for the page itself and PR comments). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const preview = await getPublicPreview(token);
  if (preview?.status !== 'active') {
    return NextResponse.json({ error: 'Preview not found' }, { status: 404 });
  }
  const png = await QRCode.toBuffer(previewPageUrl(token), {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex',
    },
  });
}
