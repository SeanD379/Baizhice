import { NextResponse } from 'next/server';
import { getAuth, privateCloudEnabled } from './auth';

export async function privateSession(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  return session?.user.email.toLowerCase() === process.env.PRIVATE_OWNER_EMAIL?.toLowerCase() ? session : null;
}
export async function requirePrivateAccess(request: Request): Promise<NextResponse | null> {
  if (!privateCloudEnabled()) return null;
  try {
    if (await privateSession(request.headers)) return null;
    return NextResponse.json({ error: '请先登录你的私人学习空间。' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: '私人学习空间登录尚未配置，请检查服务器配置。' }, { status: 503 });
  }
}
