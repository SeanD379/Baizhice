// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { themeInitScript } from '@/lib/ui-theme';
import { ThemeProvider, ThemeToggle, useTheme } from './ui-theme';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([[null, 'light'], ['dark', 'dark'], ['light', 'light'], ['invalid', 'light']] as const)('restores %s as %s before hydration', (saved, expected) => {
  if (saved !== null) localStorage.setItem('lms.theme', saved);
  new Function(themeInitScript)();
  expect(document.documentElement.dataset.theme).toBe(expected);
});

it('keeps live inputs and theme consumers mounted while switching both ways', async () => {
  function Consumer() { return <output>{useTheme().theme}</output>; }
  localStorage.setItem('lms.theme', 'dark');
  new Function(themeInitScript)();
  await act(async () => root.render(<ThemeProvider><ThemeToggle/><Consumer/><textarea defaultValue="未保存的草稿"/></ThemeProvider>));
  const field = container.querySelector('textarea');
  expect(container.querySelector('output')?.textContent).toBe('dark');
  await act(async () => container.querySelector('button')!.click());
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(container.querySelector('output')?.textContent).toBe('light');
  expect(localStorage.getItem('lms.theme')).toBe('light');
  await act(async () => container.querySelector('button')!.click());
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(container.querySelector('textarea')).toBe(field);
  expect(field?.value).toBe('未保存的草稿');
});

it('defaults to light and still switches when browser storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage disabled'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled'); });
  new Function(themeInitScript)();
  expect(document.documentElement.dataset.theme).toBe('light');
  await act(async () => root.render(<ThemeProvider><ThemeToggle/></ThemeProvider>));
  await act(async () => container.querySelector('button')!.click());
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('切换到白天模式');
});

it('restores the saved theme if a framework remount resets the root attribute', async () => {
  localStorage.setItem('lms.theme', 'dark');
  document.documentElement.dataset.theme = 'light';
  await act(async () => root.render(<ThemeProvider><ThemeToggle/></ThemeProvider>));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('切换到白天模式');
});

it.each([false, true])('keeps restored defaults when a theme transition is pending (animation started: %s)', async started => {
  let update!: () => void;
  const animation = { playState: 'running', cancel: vi.fn(), reverse: vi.fn() };
  const skip = vi.fn();
  let ready!: () => void;
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: (callback: () => void) => {
    update = callback;
    return { ready: new Promise<void>(resolve => { ready = resolve; }), finished: new Promise<void>(() => {}), skipTransition: skip };
  } });
  Object.defineProperty(document.documentElement, 'animate', { configurable: true, value: vi.fn(() => animation) });
  function Reset() { const { setTheme } = useTheme(); return <button onClick={() => setTheme('light')}>恢复</button>; }
  await act(async () => root.render(<ThemeProvider><ThemeToggle/><Reset/></ThemeProvider>));
  await act(async () => container.querySelector('button')!.click());
  if (started) await act(async () => { update(); ready(); });
  await act(async () => container.querySelectorAll('button')[1].click());
  await act(async () => { update(); ready(); });
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(localStorage.getItem('lms.theme')).toBe('light');
  expect(document.documentElement.hasAttribute('data-theme-transition')).toBe(false);
  expect(skip).toHaveBeenCalled();
  if (started) expect(animation.cancel).toHaveBeenCalled();
  delete (document as unknown as Record<string, unknown>).startViewTransition;
  delete (document.documentElement as unknown as Record<string, unknown>).animate;
});
