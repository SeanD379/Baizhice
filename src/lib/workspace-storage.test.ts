// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { notifyAuthChanged, scopedDatabaseName, workspaceFetch, workspaceLocalStorage, workspaceSessionStorage } from './workspace-storage';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); delete document.documentElement.dataset.workspace; });
afterEach(() => { delete document.documentElement.dataset.workspace; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps learning drafts and preferences separate for two accounts', () => {
  localStorage.setItem('lms.study.draft:task', 'owner draft');
  document.documentElement.dataset.workspace = 'user-alice';
  workspaceLocalStorage.setItem('lms.study.draft:task', 'alice draft');
  workspaceLocalStorage.setItem('lms.user-preferences.v1', 'alice preferences');
  document.documentElement.dataset.workspace = 'user-bob';
  expect(workspaceLocalStorage.getItem('lms.study.draft:task')).toBeNull();
  expect(workspaceLocalStorage.getItem('lms.user-preferences.v1')).toBeNull();
  workspaceLocalStorage.setItem('lms.study.draft:task', 'bob draft');
  workspaceLocalStorage.setItem('lms.user-preferences.v1', 'bob preferences');
  document.documentElement.dataset.workspace = 'user-alice';
  expect(workspaceLocalStorage.getItem('lms.study.draft:task')).toBe('alice draft');
  expect(workspaceLocalStorage.getItem('lms.user-preferences.v1')).toBe('alice preferences');
  workspaceLocalStorage.removeItem('lms.study.draft:task');
  document.documentElement.dataset.workspace = 'user-bob';
  expect(workspaceLocalStorage.getItem('lms.study.draft:task')).toBe('bob draft');
  expect(localStorage.getItem('lms.study.draft:task')).toBe('owner draft');
});

it.each([undefined, 'owner'])('preserves existing owner keys with scope %s', scope => {
  if (scope) document.documentElement.dataset.workspace = scope;
  localStorage.setItem('lms.user-preferences.v1', 'existing profile');
  sessionStorage.setItem('lms.file-practice:course:file', 'existing selection');
  expect(workspaceLocalStorage.getItem('lms.user-preferences.v1')).toBe('existing profile');
  expect(workspaceSessionStorage.getItem('lms.file-practice:course:file')).toBe('existing selection');
  workspaceLocalStorage.setItem('lms.study.draft:task', 'updated draft');
  expect(localStorage.getItem('lms.study.draft:task')).toBe('updated draft');
});

it('keeps guest session selections apart from registered accounts', () => {
  document.documentElement.dataset.workspace = 'guest-example';
  workspaceSessionStorage.setItem('lms.file-practice:course:file', 'guest selection');
  document.documentElement.dataset.workspace = 'user-alice';
  expect(workspaceSessionStorage.getItem('lms.file-practice:course:file')).toBeNull();
  workspaceSessionStorage.setItem('lms.file-practice:course:file', 'alice selection');
  workspaceSessionStorage.removeItem('lms.file-practice:course:file');
  document.documentElement.dataset.workspace = 'guest-example';
  expect(workspaceSessionStorage.getItem('lms.file-practice:course:file')).toBe('guest selection');
});

it('shares only the theme across account namespaces', () => {
  localStorage.setItem('lms.theme', 'dark');
  document.documentElement.dataset.workspace = 'user-alice';
  expect(workspaceLocalStorage.getItem('lms.theme')).toBe('dark');
  workspaceLocalStorage.setItem('lms.theme', 'light');
  document.documentElement.dataset.workspace = 'guest-example';
  expect(workspaceLocalStorage.getItem('lms.theme')).toBe('light');
  expect(localStorage.getItem('lms.theme')).toBe('light');
});

it('opens a separate notebook database for each workspace while preserving the legacy database', () => {
  expect(scopedDatabaseName('lms-notebook-drafts')).toBe('lms-notebook-drafts');
  document.documentElement.dataset.workspace = 'owner';
  expect(scopedDatabaseName('lms-notebook-drafts')).toBe('lms-notebook-drafts');
  document.documentElement.dataset.workspace = 'user-alice';
  const alice = scopedDatabaseName('lms-notebook-drafts');
  document.documentElement.dataset.workspace = 'guest-example';
  const guest = scopedDatabaseName('lms-notebook-drafts');
  expect(alice).not.toBe('lms-notebook-drafts');
  expect(guest).not.toBe(alice);
  document.documentElement.dataset.workspace = 'user-alice';
  expect(scopedDatabaseName('lms-notebook-drafts')).toBe(alice);
});

it('broadcasts account changes through a shared key without notifying the originating tab', () => {
  document.documentElement.dataset.workspace = 'user-alice';
  const listener = vi.fn(); window.addEventListener('storage', listener);
  try {
    notifyAuthChanged();
    const first = localStorage.getItem('lms.auth-session-change');
    expect(first).toBeTruthy();
    notifyAuthChanged();
    expect(localStorage.getItem('lms.auth-session-change')).not.toBe(first);
    expect(listener).not.toHaveBeenCalled();
  } finally { window.removeEventListener('storage', listener); }
});

it('binds learning requests to the current workspace while retaining upload options and headers', async () => {
  document.documentElement.dataset.workspace = 'user-alice';
  const body = new FormData(); body.set('file', new File(['notes'], 'notes.txt'));
  const signal = new AbortController().signal;
  const response = new Response('{}');
  const send = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', send);
  expect(await workspaceFetch('/api/materials', { method: 'POST', headers: { 'X-Import-Name': 'notes' }, body, signal, credentials: 'same-origin' })).toBe(response);
  const [url, options] = send.mock.calls[0];
  expect(url).toBe('/api/materials');
  expect(options).toMatchObject({ method: 'POST', body, signal, credentials: 'same-origin' });
  const headers = new Headers(options.headers);
  expect(headers.get('X-LMS-Workspace')).toBe('user-alice');
  expect(headers.get('X-Import-Name')).toBe('notes');
  expect(headers.has('Content-Type')).toBe(false);
});
it('retains Request headers when adding the legacy owner workspace', async () => {
  document.documentElement.dataset.workspace = 'owner';
  const request = new Request(new URL('/api/practice', location.href), { headers: { 'X-Existing': 'kept' } });
  const send = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', send);
  await workspaceFetch(request);
  expect(send.mock.calls[0][0]).toBe(request);
  const headers = new Headers(send.mock.calls[0][1]?.headers ?? request.headers);
  expect(headers.get('X-Existing')).toBe('kept');
  expect(headers.get('X-LMS-Workspace')).toBe('owner');
});
it('leaves auth, third-party, and absent-workspace requests unchanged', async () => {
  const send = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', send);
  const options = { method: 'POST', body: '{}' };
  await workspaceFetch('/api/materials', options);
  expect(send).toHaveBeenLastCalledWith('/api/materials', options);
  document.documentElement.dataset.workspace = 'user-alice';
  for (const url of ['/api/auth/sign-out', '/api/auth', 'https://third-party.example/api/materials', '/assets/file.docx']) {
    await workspaceFetch(url, options);
    expect(send).toHaveBeenLastCalledWith(url, options);
  }
});
it('reloads and stops a stale learning request when the server identifies an account change', async () => {
  document.documentElement.dataset.workspace = 'user-alice';
  const reload = vi.fn(); vi.stubGlobal('location', { href: location.href, reload });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 409, headers: { 'X-LMS-Workspace-Changed': '1' } })));
  await expect(workspaceFetch('/api/notebooks/course', { method: 'PATCH', body: '{}' })).rejects.toThrow('账号已切换，请刷新后重试');
  expect(reload).toHaveBeenCalledOnce();
});
it('preserves ordinary conflict and access-error responses without reloading', async () => {
  document.documentElement.dataset.workspace = 'user-alice';
  const reload = vi.fn(); vi.stubGlobal('location', { href: location.href, reload });
  for (const response of [new Response('{}', { status: 409 }), new Response('{}', { status: 403, headers: { 'X-LMS-Workspace-Changed': '1' } })]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect(await workspaceFetch('/api/notebooks/course')).toBe(response);
  }
  expect(reload).not.toHaveBeenCalled();
});
