import { requirePrivateAccess } from '@/lib/private-access';
import { checkOrigin, errorResponse } from '@/lib/server';
import { db } from '@/lib/db';
import { OfficePreviewError, readOfficePreview } from '@/lib/office-preview';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const { id } = await context.params;
    const material = await db.material.findUnique({ where: { id } });
    if (!material) return NextResponse.json({ error: '资料不存在。' }, { status: 404 });
    const bytes = await readOfficePreview(material);
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="preview.pdf"; filename*=UTF-8''${encodeURIComponent(material.name.replace(/\.pptx$/i, '.pdf'))}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if (error instanceof OfficePreviewError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    return errorResponse(error);
  }
}
