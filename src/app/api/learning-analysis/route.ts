import { z } from 'zod';
import { requirePrivateAccess } from '@/lib/private-access';
import { checkOrigin, errorResponse } from '@/lib/server';
import { learningAnalysis } from '@/lib/learning-analysis-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const params = new URL(request.url).searchParams;
    const courseId = z.string().min(1).max(100).parse(params.get('courseId'));
    const period = z.enum(['7', '30']).parse(params.get('period') ?? '7');
    return Response.json(await learningAnalysis(courseId, period === '30' ? 30 : 7), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
