import { requirePrivateAccess } from '@/lib/private-access';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { checkOrigin, errorResponse } from '@/lib/server';

export const runtime = 'nodejs';

const name = z.string().trim().min(1).max(60);

export async function POST(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const input = z.object({ courseId: z.string(), name, parentId: z.string().min(1).nullable().default(null) }).parse(await request.json());
    if (!await db.course.findUnique({ where: { id: input.courseId } })) throw new Error('课程不存在。');
    if (input.parentId) {
      const parent = await db.folder.findUnique({ where: { id: input.parentId } });
      if (!parent || parent.courseId !== input.courseId) throw new Error('父文件夹不存在或不属于当前课程。');
    }
    if (await db.folder.findFirst({ where: { courseId: input.courseId, parentId: input.parentId, name: input.name } })) throw new Error('同一层级已有同名文件夹。');
    return NextResponse.json(await db.folder.create({ data: input }));
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const input = z.object({ id: z.string(), name }).parse(await request.json());
    const folder = await db.folder.findUnique({ where: { id: input.id } });
    if (!folder) throw new Error('文件夹不存在。');
    if (await db.folder.findFirst({ where: { courseId: folder.courseId, parentId: folder.parentId, name: input.name, id: { not: input.id } } })) throw new Error('同一层级已有同名文件夹。');
    return NextResponse.json(await db.folder.update({ where: { id: input.id }, data: { name: input.name } }));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const { id } = z.object({ id: z.string() }).parse(await request.json());
    if (!await db.folder.findUnique({ where: { id } })) throw new Error('文件夹不存在。');
    await db.folder.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
