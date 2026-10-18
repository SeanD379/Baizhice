import { readFile } from 'node:fs/promises';
import { requirePrivateAccess } from '@/lib/private-access';
import { checkOrigin, errorResponse } from '@/lib/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request); const { id } = await context.params;
    const asset = new URL(request.url).searchParams.get('path') ?? '';
    const match = asset.match(/^(?:word|ppt)\/media\/[A-Za-z0-9._-]+\.(png|jpe?g|gif|webp|bmp)$/i);
    if (!match) throw new Error('图片路径无效，复杂图形请对照原文件。');
    const material = await db.material.findUnique({ where: { id } });
    if (!material || !/\.(docx|pptx)$/i.test(material.name)) throw new Error('原文件不存在。');
    const { officeMediaFile } = await import('../../../../../../scripts/office-zip.mjs');
    const bytes = officeMediaFile(await readFile(material.filePath), asset);
    if (!bytes) throw new Error('原文件中没有这张图片。');
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': `image/${/^jpe?g$/i.test(match[1]) ? 'jpeg' : match[1].toLowerCase()}`, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return errorResponse(error); }
}
