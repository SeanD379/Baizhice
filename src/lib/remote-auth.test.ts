import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxyRemoteAuth, readRemoteSession, remoteAuthOrigin } from './remote-auth';

const fetchMock = vi.fn();
const base = 'http://127.0.0.1:4175';
const upstream = 'https://study.example.com';
function request(path = '/api/auth/sign-in/email', origin: string | null = base, cookie = '') {
  return new Request(base + path, { method: path.endsWith('/get-session') ? 'GET' : 'POST', headers: { ...(origin ? { Origin: origin } : {}), Cookie: cookie, 'Content-Type': 'application/json' }, ...(path.endsWith('/get-session') ? {} : { body: JSON.stringify({ email: 'owner@example.com', password: 'test-only-password' }) }) });
}
function response(body: unknown, status = 200, cookie?: string) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
beforeEach(() => {
  vi.stubEnv('REMOTE_AUTH_URL', upstream);
  vi.stubEnv('APP_URL', base);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each(['http://study.example.com', 'https://name:password@study.example.com', 'https://study.example.com/api', 'https://study.example.com/?next=https://other.example', 'invalid'])('rejects an unsafe configured server: %s', url => {
  vi.stubEnv('REMOTE_AUTH_URL', url);
  expect(() => remoteAuthOrigin()).toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('keeps the existing local-auth path when remote login is not configured', () => {
  vi.stubEnv('REMOTE_AUTH_URL', '');
  expect(remoteAuthOrigin()).toBeNull();
});

it('forwards sign-in to the fixed HTTPS server and maps only authentication cookies', async () => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', '__Secure-better-auth.session_token=server%2Fcookie; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600');
  headers.append('Set-Cookie', 'unrelated=private; Domain=study.example.com; Path=/');
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ token: 'server-token', user: { email: 'owner@example.com' } }), { headers }));
  const incoming = request();
  const result = await proxyRemoteAuth(incoming);
  expect(fetchMock).toHaveBeenCalledWith(upstream + '/api/auth/sign-in/email', expect.objectContaining({ method: 'POST', cache: 'no-store', redirect: 'manual' }));
  const init = fetchMock.mock.calls[0][1];
  expect(new Headers(init.headers).get('Origin')).toBe(upstream);
  expect(JSON.parse(init.body).password).toBe('test-only-password');
  expect(result.status).toBe(200);
  expect(result.cookies.get('lms.remote.__Secure-better-auth.session_token')?.value).toBe('server/cookie');
  const setCookie = result.headers.get('Set-Cookie')!;
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('SameSite=lax');
  expect(setCookie).not.toMatch(/(?:^|;)\s*Secure(?:;|$)/i);
  expect(setCookie).not.toContain('Domain=');
  expect(setCookie).not.toContain('unrelated');
  expect(await result.json()).toEqual({ user: { email: 'owner@example.com' } });
});

it.each(['https://evil.example', 'null', null])('blocks a cross-origin or missing-origin sign-in before forwarding credentials: %s', async origin => {
  const result = await proxyRemoteAuth(request('/api/auth/sign-in/email', origin));
  expect(result.status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('accepts the original local Host when NextRequest normalizes the loopback URL', async () => {
  fetchMock.mockResolvedValue(response({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 401));
  const incoming = new NextRequest(base + '/api/auth/sign-in/email', { method: 'POST', headers: { Host: '127.0.0.1:4175', Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
  expect(new URL(incoming.url).hostname).toBe('localhost');
  expect((await proxyRemoteAuth(incoming)).status).toBe(401);
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('rejects a different target Host even with a trusted Origin and forwarded host', async () => {
  const incoming = new Request(base + '/api/auth/sign-in/email', { method: 'POST', headers: { Host: 'evil.example', Origin: base, 'X-Forwarded-Host': '127.0.0.1:4175' }, body: '{}' });
  expect((await proxyRemoteAuth(incoming)).status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not expose signup or arbitrary upstream paths', async () => {
  const result = await proxyRemoteAuth(request('/api/auth/sign-up/email'));
  expect(result.status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('restores only namespaced auth cookies when verifying a server session', async () => {
  fetchMock.mockResolvedValue(response({ user: { email: 'owner@example.com' }, session: { token: 'not-for-client', expiresAt: new Date(Date.now() + 3600000).toISOString() } }));
  const session = await readRemoteSession(new Headers({ Cookie: 'unrelated=secret; lms.remote.__Secure-better-auth.session_token=server%2Fcookie; __Secure-better-auth.session_token=untrusted' }));
  expect(fetchMock).toHaveBeenCalledWith(upstream + '/api/auth/get-session', expect.objectContaining({ cache: 'no-store' }));
  expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Cookie')).toBe('__Secure-better-auth.session_token=server%2Fcookie');
  expect(session).toEqual({ user: { email: 'owner@example.com' } });
});

it('does not contact the server when there is no remote auth cookie', async () => {
  expect(await readRemoteSession(new Headers())).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects an expired upstream session and reports service failures', async () => {
  const headers = new Headers({ Cookie: 'lms.remote.__Secure-better-auth.session_token=expired' });
  fetchMock.mockResolvedValueOnce(response({ user: { email: 'owner@example.com' }, session: { expiresAt: '2000-01-01T00:00:00Z' } }));
  expect(await readRemoteSession(headers)).toBeNull();
  fetchMock.mockResolvedValueOnce(response({}, 503));
  await expect(readRemoteSession(headers)).rejects.toThrow();
});

it('clears locally mapped cookies when the server accepts sign-out', async () => {
  fetchMock.mockResolvedValue(response({ success: true }));
  const result = await proxyRemoteAuth(request('/api/auth/sign-out', base, 'lms.remote.__Secure-better-auth.session_token=session; lms.remote.__Secure-better-auth.session_data=cache'));
  expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Cookie')).toContain('__Secure-better-auth.session_token=session');
  expect(result.cookies.get('lms.remote.__Secure-better-auth.session_token')?.maxAge).toBe(0);
  expect(result.cookies.get('lms.remote.__Secure-better-auth.session_data')?.maxAge).toBe(0);
});

it('does not follow upstream redirects and reports network failures without leaking details', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }));
  expect((await proxyRemoteAuth(request())).status).toBe(503);
  fetchMock.mockRejectedValueOnce(new Error('private diagnostic details'));
  const result = await proxyRemoteAuth(request());
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain('private diagnostic details');
});
