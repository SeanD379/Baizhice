import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { dataDir } from '@/lib/db';
import { checkOrigin, errorResponse } from '@/lib/server';
import { requirePrivateAccess } from '@/lib/private-access';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const form = await request.formData(), file = form.get('file');
    if (!(file instanceof File) || file.size > 10 * 1024 * 1024 || !file.size) throw new Error('请选择 10 MB 以内的 PNG、JPG 或 WebP 图片。');
    const bytes = Buffer.from(await file.arrayBuffer());
    const extension = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg' : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
    if (!extension) throw new Error('图片格式无法识别，请使用 PNG、JPG 或 WebP。');
    const name = `${randomUUID()}.${extension}`, directory = path.join(dataDir, 'notebook-assets');
    await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, name), bytes);
    return NextResponse.json({ url: `/api/notebook-assets/${name}` });
  } catch (reason) { return errorResponse(reason); }
}
