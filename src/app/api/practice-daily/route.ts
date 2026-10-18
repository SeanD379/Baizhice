import { z } from 'zod';
import { requirePrivateAccess } from '@/lib/private-access';
import { checkOrigin, errorResponse } from '@/lib/server';
import { createDailyTask, practiceAreaSchema, readDailyTask, startDailyGroup } from '@/lib/practice-hub-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const id = z.string().min(1).max(300), courseId = z.string().min(1).max(100);
export async function GET(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try { checkOrigin(request); const input = z.object({ courseId, taskId: id }).parse(Object.fromEntries(new URL(request.url).searchParams)); return Response.json(await readDailyTask(input.courseId, input.taskId)); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const input = z.discriminatedUnion('action', [z.object({ action: z.literal('create'), courseId, section: practiceAreaSchema }), z.object({ action: z.literal('start'), courseId, taskId: id, groupId: id })]).parse(await request.json());
    return Response.json(input.action === 'create' ? await createDailyTask(input.courseId, input.section) : await startDailyGroup(input.courseId, input.taskId, input.groupId));
  } catch (error) { return errorResponse(error); }
}
