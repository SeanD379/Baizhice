import { requirePrivateAccess } from '@/lib/private-access';
import { NextResponse } from 'next/server';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { db, dataDir } from '@/lib/db';
import { checkOrigin, digest, errorResponse } from '@/lib/server';
import { identifyUpload, MAX_UPLOAD_BYTES } from '@/lib/upload-format';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    const items = await db.inboxItem.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, mime: true, size: true, source: true, courseId: true, createdAt: true } });
    return NextResponse.json(items);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    if (Number(request.headers.get('content-length')) > MAX_UPLOAD_BYTES + 1024 * 1024) throw new Error('单份文件不能超过 100 MB。');
    const form = await request.formData(), file = form.get('file'), courseId = form.get('courseId');
    if (!(file instanceof File)) throw new Error('请选择文件。');
    if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new Error('文件为空或超过 100 MB，请重新选择。');
    if (typeof courseId !== 'string' || !await db.course.findUnique({ where: { id: courseId } })) throw new Error('课程不存在。');
    const bytes = Buffer.from(await file.arrayBuffer());
    const { mime, extension } = identifyUpload(bytes, file.name);
    const directory = path.join(dataDir, 'import-inbox');
    await mkdir(directory, { recursive: true });
    const filePath = path.join(directory, randomUUID());
    await writeFile(filePath, bytes);
    try {
      const item = await db.inboxItem.create({ data: { name: file.name.replace(/[\x00-\x1f]/g, '').slice(0, 200), mime, size: bytes.length, hash: digest(bytes), extension, filePath, courseId } });
      return NextResponse.json({ id: item.id, name: item.name, mime: item.mime, size: item.size, source: item.source, courseId: item.courseId, createdAt: item.createdAt });
    } catch (error) { await unlink(filePath).catch(() => {}); throw error; }
  } catch (error) { return errorResponse(error); }
}
