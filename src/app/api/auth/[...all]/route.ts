import { getAuth, privateCloudEnabled } from '@/lib/auth';
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
async function handle(request: Request) {
  if (!privateCloudEnabled()) return NextResponse.json({ error: '当前为本机学习空间，无需登录。' }, { status: 404 });
  try { return await getAuth().handler(request); }
  catch { return NextResponse.json({ error: '私人学习空间登录尚未配置。' }, { status: 503 }); }
}
export { handle as GET, handle as POST };
