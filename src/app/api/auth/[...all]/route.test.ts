import { afterEach, expect, it, vi } from 'vitest';
const handler = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ privateCloudEnabled: () => process.env.PRIVATE_CLOUD === '1', getAuth: () => ({ handler }) }));
import { POST } from './route';
import { createGuestSession, guestCookieName } from '@/lib/guest-session';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('routes the existing sign-in endpoint to the server without creating local auth', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); vi.stubEnv('REMOTE_AUTH_URL', 'https://study.example.com'); vi.stubEnv('APP_URL', 'http://127.0.0.1:4175');
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: { email: 'owner@example.com' } }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': '__Secure-better-auth.session_token=server-session; HttpOnly; Secure; SameSite=Lax; Path=/' } }));
  vi.stubGlobal('fetch', fetchMock);
  const result = await POST(new Request('http://127.0.0.1:4175/api/auth/sign-in/email', { method: 'POST', headers: { Origin: 'http://127.0.0.1:4175' }, body: '{}' }));
  expect(result.status).toBe(200);
  expect(fetchMock).toHaveBeenCalledWith('https://study.example.com/api/auth/sign-in/email', expect.any(Object));
  expect(handler).not.toHaveBeenCalled();
  expect(result.headers.get('Set-Cookie')).toContain('lms.remote.__Secure-better-auth.session_token');
});

it('retains the existing server-side auth handler when no remote origin is configured', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); vi.stubEnv('REMOTE_AUTH_URL', '');
  handler.mockResolvedValue(new Response('{}', { status: 200 }));
  const incoming = new Request('https://study.example.com/api/auth/sign-in/email', { method: 'POST' });
  expect((await POST(incoming)).status).toBe(200);
  expect(handler).toHaveBeenCalledWith(incoming);
});

it('clears a prior local identity when remote owner login succeeds', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); vi.stubEnv('REMOTE_AUTH_URL', 'https://study.example.com'); vi.stubEnv('APP_URL', 'http://127.0.0.1:4175'); vi.stubEnv('PRIVATE_OWNER_EMAIL', 'owner@example.com');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'Content-Type':'application/json', 'Set-Cookie':'__Secure-better-auth.session_token=remote-owner; HttpOnly; Secure; Path=/' } })));
  const result = await POST(new Request('http://127.0.0.1:4175/api/auth/sign-in/email', { method:'POST', headers:{Origin:'http://127.0.0.1:4175', Cookie:'better-auth.session_token=old-local', 'Content-Type':'application/json'}, body:JSON.stringify({email:'owner@example.com',password:'test-password'}) }));
  expect(result.status).toBe(200);
  expect(result.headers.getSetCookie().some(cookie => cookie.startsWith('better-auth.session_token=;') && cookie.includes('Max-Age=0'))).toBe(true);
});

it('clears the prior remote identity when a local account logs in', async () => {
  vi.stubEnv('PRIVATE_CLOUD','1'); vi.stubEnv('REMOTE_AUTH_URL','https://study.example.com'); vi.stubEnv('APP_URL','http://127.0.0.1:4175'); vi.stubEnv('PRIVATE_OWNER_EMAIL','owner@example.com');
  handler.mockResolvedValue(new Response('{}',{headers:{'Set-Cookie':'better-auth.session_token=new-local; Path=/'}}));
  const result=await POST(new Request('http://127.0.0.1:4175/api/auth/sign-in/email',{method:'POST',headers:{Origin:'http://127.0.0.1:4175',Cookie:'lms.remote.__Secure-better-auth.session_token=old-owner','Content-Type':'application/json'},body:JSON.stringify({email:'learner@example.com',password:'test-password'})}));
  expect(result.status).toBe(200);
  expect(result.headers.getSetCookie().some(cookie=>cookie.startsWith('lms.remote.__Secure-better-auth.session_token=;')&&cookie.includes('Max-Age=0'))).toBe(true);
});
it('clears previous account credentials when reusing a valid guest session', async () => {
  vi.stubEnv('PRIVATE_CLOUD','1'); vi.stubEnv('REMOTE_AUTH_URL','https://study.example.com'); vi.stubEnv('APP_URL','http://127.0.0.1:4175'); vi.stubEnv('BETTER_AUTH_SECRET','test-only-guest-auth-switch-secret-at-least-32');
  const guest=createGuestSession();
  const result=await POST(new Request('http://127.0.0.1:4175/api/auth/sign-in/guest',{method:'POST',headers:{Origin:'http://127.0.0.1:4175',Cookie:`${guestCookieName}=${guest.token}; better-auth.session_token=old-local; lms.remote.__Secure-better-auth.session_token=old-owner`},body:'{}'}));
  expect(result.status).toBe(200);
  const cleared=result.headers.getSetCookie();
  expect(cleared.some(cookie=>cookie.startsWith('better-auth.session_token=;')&&cookie.includes('Max-Age=0'))).toBe(true);
  expect(cleared.some(cookie=>cookie.startsWith('lms.remote.__Secure-better-auth.session_token=;')&&cookie.includes('Max-Age=0'))).toBe(true);
});
it('does not let self-registration claim the existing owner identity', async () => {
  vi.stubEnv('PRIVATE_CLOUD','1'); vi.stubEnv('REMOTE_AUTH_URL',''); vi.stubEnv('PRIVATE_OWNER_EMAIL','owner@example.com');
  const result=await POST(new Request('https://study.example.com/api/auth/sign-up/email',{method:'POST',body:JSON.stringify({name:'仿冒账号',email:'OWNER@example.com',password:'test-password-123'})}));
  expect(result.status).toBe(403); expect(handler).not.toHaveBeenCalled();
});
it.each(['Aa1!abc', 'short-password', '123456789012345', 'aaaaaaaaaaaaaaa', 'abc123  ', 'Aa1!' + 'x'.repeat(125)])('rejects a new password that violates the shared policy before creating an account', async password => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); vi.stubEnv('REMOTE_AUTH_URL', ''); vi.stubEnv('PRIVATE_OWNER_EMAIL', 'owner@example.com');
  handler.mockResolvedValue(new Response('{}', { status: 200 }));
  const response = await POST(new Request('https://study.example.com/api/auth/sign-up/email', { method: 'POST', body: JSON.stringify({ name: '同学', email: 'learner@example.com', password }) }));
  expect(response.status).toBe(400); expect((await response.json()).fields.password).toBeTruthy();
  expect(handler).not.toHaveBeenCalled();
});
it('accepts an eight-character password with three classes', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); vi.stubEnv('REMOTE_AUTH_URL', ''); vi.stubEnv('PRIVATE_OWNER_EMAIL', 'owner@example.com');
  handler.mockResolvedValue(new Response('{}', { status: 200 }));
  const response = await POST(new Request('https://study.example.com/api/auth/sign-up/email', { method: 'POST', body: JSON.stringify({ name: '同学', email: 'learner@example.com', password: 'Abcdef12' }) }));
  expect(response.status).toBe(200); expect(handler).toHaveBeenCalledOnce();
});

it('preserves sign-in dispatch and root-path session clearing under the named path', async () => {
  vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/baizhice'); vi.stubEnv('PRIVATE_CLOUD', '1'); vi.stubEnv('REMOTE_AUTH_URL', '');
  handler.mockResolvedValue(new Response('{}', { status: 200 }));
  const { POST: prefixedPost } = await import('./route');
  const incoming = new Request('https://study.example.com/baizhice/api/auth/sign-in/email', { method: 'POST', headers: { Cookie: 'lms.remote.__Secure-better-auth.session_token=old' } });
  const result = await prefixedPost(incoming);
  expect(result.status).toBe(200); expect(handler).toHaveBeenCalledWith(incoming);
  expect(result.headers.getSetCookie().some(cookie => cookie.startsWith('lms.remote.__Secure-better-auth.session_token=;') && cookie.includes('Path=/;'))).toBe(true);
});
it('retains owner registration protection under the named path', async () => {
  vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/baizhice'); vi.stubEnv('PRIVATE_CLOUD','1'); vi.stubEnv('REMOTE_AUTH_URL',''); vi.stubEnv('PRIVATE_OWNER_EMAIL','owner@example.com');
  const { POST: prefixedPost } = await import('./route');
  const result = await prefixedPost(new Request('https://study.example.com/baizhice/api/auth/sign-up/email', { method:'POST', body:JSON.stringify({name:'owner',email:'OWNER@example.com',password:'test-only-password'}) }));
  expect(result.status).toBe(403); expect(handler).not.toHaveBeenCalled();
});
