import { requirePrivateAccess } from '@/lib/private-access';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkOrigin, errorResponse } from '@/lib/server';
import { historyMarkdown, practiceHistory } from '@/lib/practice-history';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const params=new URL(request.url).searchParams;
    const courseId=z.string().min(1).max(100).parse(params.get('courseId'));
    const format=z.enum(['json','markdown']).parse(params.get('format')??'json');
    const data=await practiceHistory(courseId);
    return format==='markdown'?new Response(historyMarkdown(data),{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename="practice-history.md"','Cache-Control':'no-store'}}):NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
  } catch(error){return errorResponse(error);}
}
