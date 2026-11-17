import { withoutBasePath } from '@/lib/base-path';
import { parseSetCookieHeader } from 'better-auth/cookies';
import { NextResponse } from 'next/server';

const cookiePrefix = 'lms.remote.';
const authCookieName = /^(?:__Secure-|__Host-)?better-auth\.[\w.-]+$/;

export function remoteAuthOrigin() {
  const configured = process.env.REMOTE_AUTH_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('服务器登录地址配置无效。');
  return url.origin;
}

function serverCookies(headers: Headers) {
  return (headers.get('cookie') ?? '').split(';').flatMap(part => {
    const separator = part.indexOf('='), name = part.slice(0, separator).trim();
    if (separator < 0 || !name.startsWith(cookiePrefix)) return [];
    const originalName = name.slice(cookiePrefix.length);
    return authCookieName.test(originalName) ? [`${originalName}=${part.slice(separator + 1).trim()}`] : [];
  }).join('; ');
}

export async function readRemoteSession(headers: Headers) {
  const origin = remoteAuthOrigin();
  if (!origin) throw new Error('服务器登录尚未配置。');
  const cookie = serverCookies(headers);
  if (!cookie) return null;
  const response = await fetch(origin + '/api/auth/get-session', { headers: { Cookie: cookie, Accept: 'application/json' }, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('服务器登录验证暂不可用。');
  const session = await response.json();
  if (session === null) return null;
  const expires = new Date(session?.session?.expiresAt).getTime();
  if (typeof session?.user?.email !== 'string' || !Number.isFinite(expires)) throw new Error('服务器登录验证返回异常。');
  return expires <= Date.now() ? null : { user: { email: session.user.email } };
}

export async function proxyRemoteAuth(request: Request) {
  try {
    const origin = remoteAuthOrigin();
    if (!origin) throw new Error('服务器登录尚未配置。');
    const local = new URL(process.env.APP_URL ?? '');
    const target = new URL(request.url);
    const path = withoutBasePath(target.pathname);
    const allowed = request.method === 'GET' && path === '/api/auth/get-session' || request.method === 'POST' && ['/api/auth/sign-in/email', '/api/auth/sign-out'].includes(path);
    if (!allowed) return NextResponse.json({ error: '此登录操作不可用。' }, { status: 404 });
    if (request.method === 'POST' && (request.headers.get('origin') !== local.origin || target.protocol !== local.protocol || (request.headers.get('host') ?? target.host) !== local.host)) return NextResponse.json({ error: '请从当前学习空间登录。' }, { status: 403 });
    const headers = new Headers({ Accept: 'application/json', Cookie: serverCookies(request.headers) });
    if (request.method === 'POST') { headers.set('Origin', origin); headers.set('Content-Type', 'application/json'); }
    const upstream = await fetch(origin + path, { method: request.method, headers, ...(request.method === 'POST' ? { body: await request.text() } : {}), cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (upstream.status >= 300 && upstream.status < 400) throw new Error('服务器登录返回异常。');
    const payload = await upstream.json();
    if (payload && typeof payload === 'object') { delete payload.token; if (payload.session && typeof payload.session === 'object') delete payload.session.token; }
    const result = NextResponse.json(payload, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
    const attributes = { httpOnly: true, secure: local.protocol === 'https:', sameSite: 'lax' as const, path: '/' };
    for (const header of upstream.headers.getSetCookie()) {
      for (const [name, cookie] of parseSetCookieHeader(header)) {
        if (authCookieName.test(name)) result.cookies.set(cookiePrefix + name, cookie.value, { ...attributes, maxAge: cookie['max-age'], expires: cookie.expires });
      }
    }
    if (path === '/api/auth/sign-out' && upstream.ok) {
      for (const pair of serverCookies(request.headers).split('; ')) {
        const name = pair.split('=')[0];
        if (authCookieName.test(name)) result.cookies.set(cookiePrefix + name, '', { ...attributes, maxAge: 0 });
      }
    }
    return result;
  } catch { return NextResponse.json({ error: '服务器登录暂不可用，请稍后重试。' }, { status: 503 }); }
}
