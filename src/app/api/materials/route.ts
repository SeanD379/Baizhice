import { requirePrivateAccess } from '@/lib/private-access';
import { NextResponse } from 'next/server';
import { checkOrigin, errorResponse, publicMaterial } from '@/lib/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { storeMaterial } from '@/lib/material-import';
import { MAX_UPLOAD_BYTES } from '@/lib/upload-format';

export const runtime = 'nodejs';
export async function PATCH(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const input = z.object({ courseId: z.string().min(1), materialIds: z.array(z.string().min(1)).min(1), folderId: z.string().min(1).nullable() }).parse(await request.json());
    const ids = [...new Set(input.materialIds)];
    const materials = await db.$transaction(async transaction => {
      const selected = await transaction.material.findMany({ where: { id: { in: ids } } });
      if (selected.length !== ids.length) throw new Error('部分资料已不存在，请刷新后重新选择。整批资料未移动。');
      if (selected.some(material => material.courseId !== input.courseId)) throw new Error('只能移动当前课程的资料。');
      if (input.folderId) {
        const folder = await transaction.folder.findUnique({ where: { id: input.folderId } });
        if (!folder || folder.courseId !== input.courseId) throw new Error('只能移动到当前课程的有效文件夹。');
      }
      const updated = await transaction.material.updateMany({ where: { id: { in: ids }, courseId: input.courseId }, data: { folderId: input.folderId } });
      if (updated.count !== ids.length) throw new Error('资料已变化，整批资料未移动，请刷新后重试。');
      return transaction.material.findMany({ where: { id: { in: ids } } });
    });
    return NextResponse.json({ materials: materials.map(publicMaterial) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    if (Number(request.headers.get('content-length')) > MAX_UPLOAD_BYTES + 1024 * 1024) throw new Error('单份文件不能超过 100 MB。');
    const form = await request.formData(), file = form.get('file'), courseId = form.get('courseId');
    if (!(file instanceof File) || typeof courseId !== 'string') throw new Error('请选择文件和所属课程。');
    if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new Error('文件为空或超过 100 MB，请重新选择。');
    return NextResponse.json(await storeMaterial(Buffer.from(await file.arrayBuffer()), file.name, courseId));
  } catch (error) { return errorResponse(error); }
}
