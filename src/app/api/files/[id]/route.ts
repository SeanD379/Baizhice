import { requirePrivateAccess } from '@/lib/private-access';
import { readFile } from 'node:fs/promises';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePrivateAccess(_request); if (denied) return denied;
  const material = await db.material.findUnique({ where: { id: (await params).id } });
  if (!material) return new Response('文件不存在', { status: 404 });
  try {
    const bytes = await readFile(material.filePath);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': material.mime, 'Content-Length': String(bytes.length), 'Content-Disposition': `inline; filename="document"; filename*=UTF-8''${encodeURIComponent(material.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response('原文件不可访问，请重新上传。', { status: 404 }); }
}
