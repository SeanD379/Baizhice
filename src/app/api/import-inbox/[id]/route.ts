import { requirePrivateAccess } from '@/lib/private-access';
import { NextResponse } from 'next/server';
import { readFile, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { db } from '@/lib/db';
import { checkOrigin, digest, errorResponse } from '@/lib/server';
import { storeMaterial } from '@/lib/material-import';

type Context = { params: Promise<{ id: string }> };
export const runtime = 'nodejs';
export async function PATCH(request: Request, { params }: Context) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const { courseId } = z.object({ courseId: z.string().min(1) }).parse(await request.json());
    if (!await db.course.findUnique({ where: { id: courseId } })) throw new Error('课程不存在。');
    const item = await db.inboxItem.update({ where: { id: (await params).id }, data: { courseId }, select: { id: true, name: true, mime: true, size: true, source: true, courseId: true, createdAt: true } });
    return NextResponse.json(item);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const item = await db.inboxItem.findUnique({ where: { id: (await params).id } });
    if (!item) throw new Error('收件箱中没有这份文件。');
    if (!item.courseId) throw new Error('请先选择所属课程。');
    const bytes = await readFile(item.filePath);
    if (bytes.length !== item.size || digest(bytes) !== item.hash) throw new Error('暂存文件不完整，请移除后重新上传。');
    const result = await storeMaterial(bytes, item.name, item.courseId);
    await db.inboxItem.delete({ where: { id: item.id } });
    await unlink(item.filePath).catch(() => {});
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const item = await db.inboxItem.delete({ where: { id: (await params).id } });
    await unlink(item.filePath).catch(() => {});
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
