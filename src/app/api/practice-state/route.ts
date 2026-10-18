import { z } from 'zod';
import { requirePrivateAccess } from '@/lib/private-access';
import { checkOrigin, errorResponse } from '@/lib/server';
import { changeQuestionStates, questionRefSchema, readQuestionStates, stateChangeSchema } from '@/lib/practice-hub-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const course = z.string().min(1).max(100);
export async function GET(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try { checkOrigin(request); return Response.json({ states: await readQuestionStates(course.parse(new URL(request.url).searchParams.get('courseId'))) }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try { checkOrigin(request); const input = z.object({ courseId: course, refs: z.array(questionRefSchema).min(1).max(500), changes: stateChangeSchema, revision: z.number().int().nonnegative().optional() }).parse(await request.json()); return Response.json({ states: await changeQuestionStates(input.courseId, input.refs, input.changes, input.revision) }); }
  catch (error) { return errorResponse(error); }
}
