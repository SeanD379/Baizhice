import { NextResponse } from 'next/server';
import { getAuth, privateCloudEnabled } from './auth';
import { readRemoteSession, remoteAuthOrigin } from './remote-auth';
import { readGuestSession } from './guest-session';
import { workspaceContext, type LearningSession } from './workspace-context';

export async function privateSession(headers: Headers): Promise<LearningSession | null> {
  const guest = readGuestSession(headers); if (guest) return guest;
  const remote = remoteAuthOrigin();
  const hasLocalCookie = /(?:^|;\s*)(?:__Secure-|__Host-)?better-auth\./.test(headers.get('cookie') ?? '');
  if (!remote || hasLocalCookie) {
    const session = await getAuth().api.getSession({ headers });
    if (session) return session;
  }
  if (remote) {
    const session = await readRemoteSession(headers);
    return session?.user.email.toLowerCase() === process.env.PRIVATE_OWNER_EMAIL?.toLowerCase() ? session : null;
  }
  return null;
}
export async function requirePrivateAccess(request: Request): Promise<NextResponse | null> {
  if (!privateCloudEnabled()) return null;
  if (workspaceContext.getStore()) return null;
  try {
    if (await privateSession(request.headers)) return NextResponse.json({ error: '学习空间尚未初始化，请刷新后重试。' }, { status: 503 });
    return NextResponse.json({ error: '请先登录你的学习空间。' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: '私人学习空间登录尚未配置，请检查服务器配置。' }, { status: 503 });
  }
}
