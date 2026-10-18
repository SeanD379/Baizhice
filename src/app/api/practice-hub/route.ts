import { z } from 'zod';
import { requirePrivateAccess } from '@/lib/private-access';
import { checkOrigin, errorResponse } from '@/lib/server';
import { practiceAreaSchema, practiceHubSummary } from '@/lib/practice-hub-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try { checkOrigin(request); const input = z.object({ courseId: z.string().min(1).max(100), section: practiceAreaSchema }).parse(Object.fromEntries(new URL(request.url).searchParams)); return Response.json(await practiceHubSummary(input.courseId, input.section)); }
  catch (error) { return errorResponse(error); }
}
