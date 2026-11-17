// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceAccountSync } from './workspace-account-sync';
import { notifyAuthChanged } from '@/lib/workspace-storage';

let root: Root, container: HTMLDivElement;
const reload = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('BroadcastChannel', undefined);
  reload.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('reloads other account tabs once and ignores scoped preference changes', async () => {
  await act(async () => root.render(<WorkspaceAccountSync/>));
  window.dispatchEvent(new StorageEvent('storage', { key: 'lms.user-preferences.v1', newValue: '{}' }));
  expect(reload).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent('storage', { key: 'lms.auth-session-change', newValue: 'login' }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'lms.auth-session-change', newValue: 'logout' }));
  expect(reload).toHaveBeenCalledTimes(1);
});
it('removes the account-change listener when unmounted', async () => {
  await act(async () => root.render(<WorkspaceAccountSync/>));
  await act(async () => root.render(null));
  window.dispatchEvent(new StorageEvent('storage', { key: 'lms.auth-session-change', newValue: 'login' }));
  expect(reload).not.toHaveBeenCalled();
});
it('uses channel notifications when storage is blocked without reloading the originating tab', async () => {
  const channels = new Set<Channel>();
  class Channel {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(readonly name: string) { channels.add(this); }
    postMessage(data: unknown) { for (const channel of channels) if (channel !== this && channel.name === this.name) channel.onmessage?.({ data }); }
    close() { channels.delete(this); }
  }
  vi.stubGlobal('BroadcastChannel', Channel);
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  try {
    await act(async () => root.render(<WorkspaceAccountSync/>));
    expect(() => notifyAuthChanged()).not.toThrow();
    expect(reload).not.toHaveBeenCalled();
    const otherTab = new Channel('lms.auth-session-change');
    otherTab.postMessage({ source: 'another-tab', id: 'login' });
    expect(reload).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    reload.mockReset();
    otherTab.postMessage({ source: 'another-tab', id: 'logout' });
    expect(reload).not.toHaveBeenCalled();
    otherTab.close();
  } finally { storage.mockRestore(); }
});
