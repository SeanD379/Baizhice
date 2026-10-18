import { requirePrivateAccess } from '@/lib/private-access';
import { z } from 'zod';
import { db } from '@/lib/db';
import { checkOrigin, errorResponse } from '@/lib/server';
import { checkpointNotebook, getNotebook, NotebookConflict, notebookSchema, saveNotebook } from '@/lib/notebook-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ courseId: string }> };
export async function GET(request: Request, context: Context) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    const { courseId } = await context.params;
    if (new URL(request.url).searchParams.get('history') === '1') {
      await getNotebook(courseId);
      return Response.json({ snapshots: await db.notebookSnapshot.findMany({ where: { courseId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, summary: true, createdAt: true } }) });
    }
    return Response.json(await getNotebook(courseId), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
const schema = z.object({ revision: z.number().int().positive(), requestId: z.string().uuid(), document: notebookSchema, checkpoint: z.string().min(1).max(120).optional() });
export async function PATCH(request: Request, context: Context) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    if (Number(request.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('本次笔记过大，请拆分课程。');
    const { courseId } = await context.params, input = schema.parse(await request.json());
    return Response.json(await saveNotebook(courseId, input.document, input.revision, input.requestId, input.checkpoint));
  } catch (error) {
    if (error instanceof NotebookConflict) return Response.json({ error: error.message, current: error.current }, { status: 409 });
    return errorResponse(error);
  }
}
export async function POST(request: Request, context: Context) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const { courseId } = await context.params;
    const input = z.discriminatedUnion('action', [z.object({ action: z.literal('checkpoint'), summary: z.string().min(1).max(120) }), z.object({ action: z.literal('restore'), snapshotId: z.string(), revision: z.number().int().positive(), requestId: z.string().uuid() })]).parse(await request.json());
    if (input.action === 'checkpoint') return Response.json(await checkpointNotebook(courseId, input.summary));
    const snapshot = await db.notebookSnapshot.findFirst({ where: { id: input.snapshotId, courseId } });
    if (!snapshot) throw new Error('笔记版本不存在。');
    await checkpointNotebook(courseId, '恢复前的笔记');
    return Response.json(await saveNotebook(courseId, JSON.parse(snapshot.content), input.revision, input.requestId, '恢复历史笔记'));
  } catch (error) {
    if (error instanceof NotebookConflict) return Response.json({ error: error.message, current: error.current }, { status: 409 });
    return errorResponse(error);
  }
}
