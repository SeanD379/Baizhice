import { afterEach, expect, it, vi } from 'vitest';
// The health route and cookie construction require no database IO.
vi.mock('./db', () => ({ authDb: {} }));
vi.mock('./auth-secret', () => ({ getAuthSecret: () => 'test-only-named-path-secret-at-least-32-characters' }));
afterEach(() => vi.unstubAllEnvs());
it('mounts real Better Auth handlers under the named path and retains existing session cookie names and root scope', async () => {
  vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/baizhice'); vi.stubEnv('APP_URL', 'https://study.example.com');
  const { getAuth } = await import('./auth');
  const auth = getAuth();
  const response = await auth.handler(new Request('https://study.example.com/baizhice/api/auth/ok'));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
  const context = await auth.$context;
  expect(context.authCookies.sessionToken.name).toBe('__Secure-better-auth.session_token');
  expect(context.authCookies.sessionToken.attributes.path).toBe('/');
});
