import { withBasePath, withoutBasePath } from '@/lib/base-path';
import { getAuth, privateCloudEnabled } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { proxyRemoteAuth, remoteAuthOrigin } from '@/lib/remote-auth';
import { privateSession } from '@/lib/private-access';
import { createGuestSession, guestCookieName, guestLifetimeSeconds, readGuestSession } from '@/lib/guest-session';
import { discardGuestWorkspace, removeExpiredGuests, seedGuestWorkspace } from '@/lib/workspace-scope';
import { withGuestCapacity } from '@/lib/guest-capacity';
import { registrationPasswordError } from '@/lib/login-validation';
export const runtime = 'nodejs';
function clearGuest(response: Response) {
  response.headers.append('Set-Cookie', `${guestCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.APP_URL?.startsWith('https:') ? '; Secure' : ''}`);
  return response;
}
function clearPreviousIdentity(response: Response, request: Request, kind: 'local' | 'remote' | 'all') {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const name = part.trim().split('=')[0];
    const local = /^(?:__Secure-|__Host-)?better-auth\.[\w.-]+$/.test(name);
    const remote = /^lms\.remote\.(?:__Secure-|__Host-)?better-auth\.[\w.-]+$/.test(name);
    if ((local && kind !== 'remote') || (remote && kind !== 'local')) response.headers.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.APP_URL?.startsWith('https:') ? '; Secure' : ''}`);
  }
  return response;
}
function handleLocalAuth(request: Request) {
  const url = new URL(request.url), pathname = withBasePath(url.pathname);
  if (pathname === url.pathname) return getAuth().handler(request);
  // Next removes basePath before invoking Route Handlers; Better Auth matches it.
  url.pathname = pathname;
  return getAuth().handler(new Request(url, request));
}
async function handle(request: Request) {
  if (!privateCloudEnabled()) return NextResponse.json({ error: '当前为本机学习空间，无需登录。' }, { status: 404 });
  try {
    const pathname = withoutBasePath(new URL(request.url).pathname);
    const remote = remoteAuthOrigin();
    if (pathname === '/api/auth/sign-in/guest' && request.method === 'POST') {
      const appUrl = process.env.APP_URL;
      if (!appUrl || request.headers.get('origin') !== new URL(appUrl).origin) return NextResponse.json({ message: '请从当前学习空间进入。' }, { status: 403 });
      const existing = readGuestSession(request.headers);
      if (existing) return clearPreviousIdentity(NextResponse.json({ guest: true, expiresAt: existing.expiresAt }), request, 'all');
      await removeExpiredGuests();
      return withGuestCapacity(async () => {
        const guest = createGuestSession();
        const session = { user: { id: guest.id, email: `${guest.id}@guest.invalid`, name: '游客' }, guest: true, expiresAt: guest.expiresAt };
        try { await seedGuestWorkspace(session); }
        catch (error) { await discardGuestWorkspace(session); throw error; }
        const response = NextResponse.json({ guest: true, expiresAt: guest.expiresAt });
        response.cookies.set(guestCookieName, guest.token, { httpOnly: true, sameSite: 'lax', secure: new URL(appUrl).protocol === 'https:', path: '/', maxAge: guestLifetimeSeconds });
        return clearPreviousIdentity(response, request, 'all');
      });
    }
    if (pathname === '/api/auth/get-session' && request.method === 'GET') {
      const session = await privateSession(request.headers);
      const payload = session ? JSON.parse(JSON.stringify(session)) : null;
      if (payload?.session) delete payload.session.token;
      return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (pathname === '/api/auth/sign-up/email' && request.method === 'POST') {
      const input = await request.clone().json().catch(() => null);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ message: '注册信息格式不正确。' }, { status: 400 });
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      if (email && email === process.env.PRIVATE_OWNER_EMAIL?.toLowerCase()) return NextResponse.json({ message: '这是已有的私人账号，请直接登录。' }, { status: 403 });
      if (typeof input.name !== 'string' || !input.name.trim() || Array.from(input.name.trim()).length > 20) return NextResponse.json({ message: '昵称请填写 1–20 个字。' }, { status: 400 });
      const passwordError = registrationPasswordError(typeof input.password === 'string' ? input.password : '');
      if (passwordError) return NextResponse.json({ message: passwordError, fields: { password: passwordError } }, { status: 400 });
      const response = await handleLocalAuth(request);
      return response.ok ? clearPreviousIdentity(clearGuest(response), request, 'remote') : response;
    }
    if (pathname === '/api/auth/sign-in/email' && request.method === 'POST') {
      const input = await request.clone().json().catch(() => ({}));
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const owner = email === process.env.PRIVATE_OWNER_EMAIL?.toLowerCase();
      const response = remote && (owner || !email) ? await proxyRemoteAuth(request) : await handleLocalAuth(request);
      return response.ok ? clearPreviousIdentity(clearGuest(response), request, remote && (owner || !email) ? 'local' : 'remote') : response;
    }
    if (pathname === '/api/auth/sign-out' && request.method === 'POST') {
      const response = await handleLocalAuth(request);
      if (remote && request.headers.get('cookie')?.includes('lms.remote.')) {
        const upstream = await proxyRemoteAuth(request);
        if (!upstream.ok) return upstream;
        for (const cookie of upstream.headers.getSetCookie()) response.headers.append('Set-Cookie', cookie);
      }
      return clearGuest(response);
    }
    return NextResponse.json({ error: '此登录操作不可用。' }, { status: 404 });
  } catch { return NextResponse.json({ error: '登录服务暂不可用，请稍后重试。' }, { status: 503 }); }
}
export { handle as GET, handle as POST };
