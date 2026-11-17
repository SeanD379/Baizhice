import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
// These routes validate input or clear cookies without database IO. Keep the
// real route, Better Auth router, origin checks, body parser and cookie writer.
vi.mock('./db', () => ({ authDb: {}, db: {}, dataDir: '.', getDataDir: () => '.' }));
vi.mock('./auth-secret', () => ({ getAuthSecret: () => 'test-only-named-path-secret-at-least-32-characters' }));
beforeEach(() => {
  vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/baizhice');
  vi.stubEnv('APP_URL', 'https://study.example.com'); vi.stubEnv('PRIVATE_CLOUD', '1'); vi.stubEnv('REMOTE_AUTH_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

it.each(['/api/auth', '/baizhice/api/auth'])('routes POST sign-in through real Better Auth after Next normalizes %s', async prefix => {
  const { POST } = await import('../app/api/auth/[...all]/route');
  const response = await POST(new NextRequest(`https://study.example.com${prefix}/sign-in/email`, {
    method: 'POST', headers: { Origin: 'https://study.example.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invalid-email', password: 'test-only-password' }),
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'INVALID_EMAIL' });
});

it.each(['/api/auth', '/baizhice/api/auth'])('routes POST sign-out and clears original cookies after Next normalizes %s', async prefix => {
  const { POST } = await import('../app/api/auth/[...all]/route');
  const response = await POST(new NextRequest(`https://study.example.com${prefix}/sign-out`, {
    method: 'POST', headers: { Origin: 'https://study.example.com', 'Content-Type': 'application/json' }, body: '{}',
  }));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true });
  expect(response.headers.getSetCookie().some(cookie => cookie.startsWith('__Secure-better-auth.session_token=;') && cookie.includes('Path=/;') && cookie.includes('Max-Age=0'))).toBe(true);
});
