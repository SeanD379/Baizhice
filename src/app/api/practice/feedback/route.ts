import { requirePrivateAccess } from '@/lib/private-access';
import { NextResponse } from 'next/server';
import { checkOrigin, errorResponse } from '@/lib/server';
import { generateAnswerFeedback } from '@/lib/practice-feedback';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    return NextResponse.json(await generateAnswerFeedback(await request.json()),{headers:{'Cache-Control':'no-store'}});
  } catch(error){return errorResponse(error);}
}
