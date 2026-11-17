// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UserPreferencesProvider, useUserPreferences } from './user-preferences';
import { ThemeProvider, ThemeToggle } from './ui-theme';
import { workspaceLocalStorage } from '@/lib/workspace-storage';

let root: Root;
let container: HTMLDivElement;
function Consumer() {
  const { preferences, savePreferences, resetPreferences, storageError, reducedMotion } = useUserPreferences();
  return <><output>{JSON.stringify({ ...preferences, reducedMotion })}</output><p role="alert">{storageError}</p><button onClick={() => savePreferences({ nickname: '小林', avatar: 'data:image/webp;base64,YQ==', readingSize: 'large', reduceMotion: true, sendShortcut: 'mod-enter' })}>修改</button><button onClick={resetPreferences}>恢复</button></>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete document.documentElement.dataset.workspace; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const read = () => JSON.parse(container.querySelector('output')!.textContent!);

it('defaults to the signed-in name when this account has no saved nickname', async () => {
  document.documentElement.dataset.workspace = 'user-alice';
  localStorage.setItem('lms.user-preferences.v1', JSON.stringify({ nickname: '原账号' }));
  workspaceLocalStorage.setItem('lms.user-preferences.v1', JSON.stringify({ readingSize: 'large' }));
  await act(async () => root.render(<UserPreferencesProvider initialNickname="小雅"><Consumer/></UserPreferencesProvider>));
  expect(read()).toMatchObject({ nickname: '小雅', readingSize: 'large' });
});
it('saves profiles separately and preserves the account nickname on the next visit', async () => {
  document.documentElement.dataset.workspace = 'user-alice';
  await act(async () => root.render(<UserPreferencesProvider initialNickname="小雅"><Consumer/></UserPreferencesProvider>));
  await act(async () => container.querySelector('button')!.click());
  await act(async () => root.render(null));
  document.documentElement.dataset.workspace = 'user-bob';
  await act(async () => root.render(<UserPreferencesProvider initialNickname="小周"><Consumer/></UserPreferencesProvider>));
  expect(read()).toMatchObject({ nickname: '小周', avatar: null, readingSize: 'standard' });
  await act(async () => root.render(null));
  document.documentElement.dataset.workspace = 'user-alice';
  await act(async () => root.render(<UserPreferencesProvider initialNickname="小雅"><Consumer/></UserPreferencesProvider>));
  expect(read()).toMatchObject({ nickname: '小林', avatar: 'data:image/webp;base64,YQ==', readingSize: 'large' });
  expect(localStorage.getItem('lms.user-preferences.v1')).toBeNull();
});

it('restores saved preferences and applies the reading and motion choices', async () => {
  localStorage.setItem('lms.user-preferences.v1', JSON.stringify({ nickname: '小林', avatar: null, readingSize: 'large', reduceMotion: true, sendShortcut: 'mod-enter' }));
  await act(async () => root.render(<UserPreferencesProvider><Consumer/></UserPreferencesProvider>));
  expect(read()).toMatchObject({ nickname: '小林', readingSize: 'large', reducedMotion: true, sendShortcut: 'mod-enter' });
  expect(document.documentElement.style.getPropertyValue('--reading-scale')).toBe('1.25');
  expect(document.documentElement.dataset.reducedMotion).toBe('true');
});
it('ignores malformed saved fields instead of breaking the settings', async () => {
  localStorage.setItem('lms.user-preferences.v1', JSON.stringify({ nickname: '', avatar: 'https://invalid.example/avatar', readingSize: 4, reduceMotion: 'yes', sendShortcut: 'anything' }));
  await act(async () => root.render(<UserPreferencesProvider><Consumer/></UserPreferencesProvider>));
  expect(read()).toMatchObject({ nickname: '私人学习者', avatar: null, readingSize: 'standard', reduceMotion: false, sendShortcut: 'enter' });
});
it('resets preferences without removing the profile or unrelated learning data', async () => {
  localStorage.setItem('learning-draft', '我的答案');
  await act(async () => root.render(<UserPreferencesProvider><Consumer/></UserPreferencesProvider>));
  await act(async () => container.querySelector('button')!.click());
  await act(async () => container.querySelectorAll('button')[1].click());
  expect(read()).toMatchObject({ nickname: '小林', avatar: 'data:image/webp;base64,YQ==', readingSize: 'standard', reduceMotion: false, sendShortcut: 'enter' });
  expect(localStorage.getItem('learning-draft')).toBe('我的答案');
  expect(JSON.parse(localStorage.getItem('lms.user-preferences.v1')!)).toMatchObject({ nickname: '小林', readingSize: 'standard' });
});
it('reports storage failure and does not claim the profile was saved', async () => {
  await act(async () => root.render(<UserPreferencesProvider><Consumer/></UserPreferencesProvider>));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await act(async () => container.querySelector('button')!.click());
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('无法保存');
  expect(read().nickname).toBe('私人学习者');
});
it('merges a delayed avatar save with the latest saved nickname and reading preferences', async () => {
  let delayedSave: ReturnType<typeof useUserPreferences>['savePreferences'] | undefined;
  function CaptureSave() { delayedSave ??= useUserPreferences().savePreferences; return null; }
  await act(async () => root.render(<UserPreferencesProvider><Consumer/><CaptureSave/></UserPreferencesProvider>));
  await act(async () => container.querySelector('button')!.click());
  await act(async () => { delayedSave!({ avatar: null }); });
  expect(read()).toMatchObject({ nickname: '小林', avatar: null, readingSize: 'large', sendShortcut: 'mod-enter' });
});
it('clears the storage error when a theme save succeeds on retry', async () => {
  await act(async () => root.render(<UserPreferencesProvider><ThemeProvider><ThemeToggle/><Consumer/></ThemeProvider></UserPreferencesProvider>));
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await act(async () => container.querySelector('.theme-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('无法保存');
  set.mockRestore();
  await act(async () => container.querySelector('.theme-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(localStorage.getItem('lms.theme')).toBe('light');
  expect(container.querySelector('[role="alert"]')!.textContent).toBe('');
});
