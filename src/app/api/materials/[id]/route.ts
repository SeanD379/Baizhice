import { requirePrivateAccess } from '@/lib/private-access';
import { NextResponse } from 'next/server';
import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db, dataDir } from '@/lib/db';
import { checkOrigin, errorResponse, publicMaterial } from '@/lib/server';
import { conflictResolutionUpdate } from '@/lib/conflict-resolution';
import { isExtracting } from '@/lib/extraction';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const body = await request.json();
    const { id } = await params;
    const action = z.object({ action: z.enum(['accept-reference', 'pause-conflict', 'reopen-conflict']) }).safeParse(body);
    if (!action.success) {
      const input = z.object({ excluded: z.boolean().optional(), chapter: z.string().trim().min(1).max(50).optional(), folderId: z.string().min(1).nullable().optional() }).parse(body);
      if (input.folderId) {
        const [material, folder] = await Promise.all([db.material.findUnique({ where: { id } }), db.folder.findUnique({ where: { id: input.folderId } })]);
        if (!material || !folder || material.courseId !== folder.courseId) throw new Error('只能移动到当前课程的文件夹。');
      }
      return NextResponse.json(publicMaterial(await db.material.update({ where: { id }, data: input })));
    }
    const material = await db.material.findUnique({ where: { id } });
    if (!material || material.status !== 'review') throw new Error('这份资料当前没有待处理的内容冲突。');
    let update;
    if (action.data.action === 'accept-reference') {
      const reference = await db.material.findFirst({ where: { courseId: material.courseId, fixture: 'independence', status: 'ready', excluded: false } });
      update = conflictResolutionUpdate({ action: 'accept-reference', referenceAvailable: !!reference });
    } else if (action.data.action === 'pause-conflict') {
      const feedback = z.object({ reason: z.string(), note: z.string().optional() }).parse(body);
      update = conflictResolutionUpdate({ action: 'pause-conflict', ...feedback });
    } else update = conflictResolutionUpdate({ action: 'reopen-conflict' });
    return NextResponse.json(publicMaterial(await db.material.update({ where: { id }, data: update })));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const { id } = await params;
    const material = await db.material.findUnique({ where: { id } });
    if (!material) return NextResponse.json({ error: '资料不存在或已删除。' }, { status: 404 });
    if (isExtracting(id)) return NextResponse.json({ error: '这份资料正在提取文字，请稍后再删除。' }, { status: 409 });

    await db.material.delete({ where: { id } });
    let cleanupWarning = false;
    const extractionPath = path.join(dataDir, 'extractions', `${id}.json`);
    await unlink(extractionPath).catch(error => { if (error.code !== 'ENOENT') cleanupWarning = true; });

    const generationDir = path.join(dataDir, 'generations');
    const drafts = await readdir(generationDir).catch(error => { if (error.code !== 'ENOENT') cleanupWarning = true; return []; });
    for (const file of drafts) {
      if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
      const draftPath = path.join(generationDir, file);
      try {
        const draft = JSON.parse(await readFile(draftPath, 'utf8'));
        if ([...(draft.pages ?? []), ...(draft.originalPages ?? [])].some((page: { materialId: string }) => page.materialId === id)) await unlink(draftPath);
      } catch { cleanupWarning = true; }
    }

    const uploadsDir = path.join(dataDir, 'uploads');
    if (path.dirname(material.filePath) === uploadsDir && !await db.material.findFirst({ where: { filePath: material.filePath } })) {
      await unlink(material.filePath).catch(error => { if (error.code !== 'ENOENT') cleanupWarning = true; });
    }
    return NextResponse.json({ deleted: true, cleanupWarning });
  } catch (error) { return errorResponse(error); }
}
