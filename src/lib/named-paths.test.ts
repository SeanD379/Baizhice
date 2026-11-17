// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/baizhice'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); delete document.documentElement.dataset.workspace; });

it('keeps login returns inside the named workspace and rejects recursive or external destinations', async () => {
  const { loginReturnPath } = await import('./login-navigation');
  expect(loginReturnPath('/baizhice/?course=c1&settings=profile#notes')).toBe('/baizhice/?course=c1&settings=profile#notes');
  expect(loginReturnPath('/?course=c1')).toBe('/baizhice/?course=c1');
  for (const value of [null, '//evil.example', '/\\evil.example', '/%2f%2fevil.example', '/baizhice/login', '/baizhice/%6cogin', '/portfolio', '/baizhice/../portfolio']) expect(loginReturnPath(value)).toBe('/baizhice/');
});

it('prefixes learning requests without dropping the account guard, body, signal or upload headers', async () => {
  const { workspaceFetch } = await import('./workspace-storage');
  document.documentElement.dataset.workspace = 'user-alice';
  const send = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', send);
  const body = new FormData(); body.set('file', new File(['notes'], 'notes.txt'));
  const signal = new AbortController().signal;
  await workspaceFetch('/api/materials', { method: 'POST', body, signal, headers: { 'X-Import': 'kept' } });
  const [url, init] = send.mock.calls[0];
  expect(url).toBe('/baizhice/api/materials');
  expect(init.body).toBe(body); expect(init.signal).toBe(signal);
  expect(new Headers(init.headers).get('X-LMS-Workspace')).toBe('user-alice');
  expect(new Headers(init.headers).get('X-Import')).toBe('kept');
  expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  await workspaceFetch('/baizhice/api/materials');
  expect(send.mock.calls[1][0]).toBe('/baizhice/api/materials');
  expect(new Headers(send.mock.calls[1][1].headers).get('X-LMS-Workspace')).toBe('user-alice');
});

it('prefixes requests without an account and leaves other origins untouched', async () => {
  const { workspaceFetch } = await import('./workspace-storage');
  const send = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', send);
  await workspaceFetch('/api/materials'); expect(send.mock.calls[0][0]).toBe('/baizhice/api/materials');
  document.documentElement.dataset.workspace = 'user-alice';
  await workspaceFetch('/api/auth/sign-out');
  expect(send.mock.calls[1][0]).toBe('/baizhice/api/auth/sign-out');
  expect(send.mock.calls[1][1]).toBeUndefined();
  await workspaceFetch('https://other.example/api/materials');
  expect(send.mock.calls[2][0]).toBe('https://other.example/api/materials');
});

it('reloads a prefixed request when the server detects a switched identity', async () => {
  const { workspaceFetch } = await import('./workspace-storage');
  document.documentElement.dataset.workspace = 'user-alice';
  const reload = vi.fn(); vi.stubGlobal('location', { href: location.href, reload });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 409, headers: { 'X-LMS-Workspace-Changed': '1' } })));
  await expect(workspaceFetch('/baizhice/api/notebooks/course')).rejects.toThrow('账号已切换'); expect(reload).toHaveBeenCalledOnce();
});


it('keeps practice navigation and browser history inside the application path', async () => {
  const { practiceLocation } = await import('./practice-hub');
  expect(practiceLocation('course-one', { section: 'papers', activity: 'practice', materialId: 'paper-one' })).toBe('/baizhice/?course=course-one&view=practice&section=papers&activity=practice&paper=paper-one');
});
it('retains Request uploads and headers when prefixing an absolute same-origin request', async () => {
  const { workspaceFetch } = await import('./workspace-storage');
  document.documentElement.dataset.workspace = 'user-alice';
  const send = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', send);
  const original = new Request(new URL('/api/notebooks/course', location.href), { method: 'PATCH', body: 'notes', headers: { 'X-Existing': 'kept' } });
  expect(original.method).toBe('PATCH');
  await workspaceFetch(original);
  const [request, init] = send.mock.calls[0];
  expect(new URL(request.url).pathname).toBe('/baizhice/api/notebooks/course');
  expect(request.method).toBe('PATCH'); expect(await request.text()).toBe('notes');
  expect(new Headers(init.headers).get('X-LMS-Workspace')).toBe('user-alice');
  expect(new Headers(init.headers).get('X-Existing')).toBe('kept');
});
