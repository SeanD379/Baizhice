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
