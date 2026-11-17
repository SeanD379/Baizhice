import { basePath, withBasePath, withoutBasePath } from './base-path';

type WorkspaceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function scopedName(base: string) {
  const scope = typeof document === 'undefined' ? undefined : document.documentElement.dataset.workspace;
  return !scope || scope === 'owner' ? base : `lms.workspace:${scope}:${base}`;
}
const storageKey = (key: string) => key === 'lms.theme' ? key : scopedName(key);

function browserStorage(kind: 'localStorage' | 'sessionStorage'): WorkspaceStorage {
  return {
    getItem: key => window[kind].getItem(storageKey(key)),
    setItem: (key, value) => window[kind].setItem(storageKey(key), value),
    removeItem: key => window[kind].removeItem(storageKey(key)),
  };
}
export const workspaceLocalStorage = browserStorage('localStorage');
export const workspaceSessionStorage = browserStorage('sessionStorage');
export const scopedDatabaseName = scopedName;
export const workspaceFetch: typeof fetch = async (input, init) => {
  if (typeof input === 'string') input = withBasePath(input);
  if (basePath && typeof location !== 'undefined') {
    const target = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (target.origin === new URL(location.href).origin && withBasePath(target.pathname) !== target.pathname) {
      target.pathname = withBasePath(target.pathname);
      input = input instanceof Request ? new Request(target, {
        method: input.method, headers: input.headers, body: input.body, signal: input.signal,
        credentials: input.credentials, cache: input.cache, redirect: input.redirect,
        mode: input.mode, referrer: input.referrer, referrerPolicy: input.referrerPolicy,
        integrity: input.integrity, keepalive: input.keepalive, ...(input.body ? { duplex: 'half' } : {}),
      }) : target;
    }
  }
  const scope = typeof document === 'undefined' ? undefined : document.documentElement.dataset.workspace;
  if (!scope) return fetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const pathname = withoutBasePath(url.pathname);
  if (url.origin !== new URL(location.href).origin || !pathname.startsWith('/api/') || /^\/api\/auth(?:\/|$)/.test(pathname)) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('X-LMS-Workspace', scope);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 409 && response.headers.get('X-LMS-Workspace-Changed') === '1') {
    location.reload();
    throw new Error('账号已切换，请刷新后重试');
  }
  return response;
};

const authChangeKey = 'lms.auth-session-change';
const tabId = Math.random().toString(36).slice(2);
export function notifyAuthChanged() {
  const message = { source: tabId, id: crypto.randomUUID() };
  try { window.localStorage.setItem(authChangeKey, JSON.stringify(message)); } catch { /* BroadcastChannel can still notify other tabs when storage is unavailable. */ }
  try { const channel = new BroadcastChannel(authChangeKey); channel.postMessage(message); channel.close(); } catch { /* Storage events cover browsers without BroadcastChannel. */ }
}
export function subscribeToAuthChanges(onChange: () => void) {
  const storageChanged = (event: StorageEvent) => { if (event.key === authChangeKey && event.newValue) onChange(); };
  window.addEventListener('storage', storageChanged);
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(authChangeKey); channel.onmessage = event => { if (event.data?.source !== tabId) onChange(); }; } catch { /* The native storage listener remains available. */ }
  return () => { window.removeEventListener('storage', storageChanged); channel?.close(); };
}
