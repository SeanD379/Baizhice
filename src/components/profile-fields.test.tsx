// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ProfileFields } from './profile-fields';
import { UserPreferencesProvider } from './user-preferences';
import { ThemeProvider } from './ui-theme';

let root: Root, host: HTMLDivElement;
function Fixture({ failSave = false }: { failSave?: boolean }) {
  const [values, setValues] = useState(['第一条', '中间条', '最后条']);
  const [clicks, setClicks] = useState(0);
  return <div className="user-settings"><header className="user-settings-header">设置</header><div className="user-settings-content">
    <ProfileFields onEditingChange={() => {}} fields={values.map((value, index) => ({
      id: String(index), title: `信息${index}`, value, icon: <span/>, characterLimit: 20,
      save: next => { if (failSave) return '无法保存，请重试。'; setValues(current => current.map((item, position) => position === index ? next : item)); return null; },
    }))}/><button onClick={() => setClicks(count => count + 1)}>背景按钮</button><output>{JSON.stringify({ values, clicks })}</output>
  </div></div>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const read = () => JSON.parse(host.querySelector('output')!.textContent!);
async function render(failSave = false) { await act(async () => root.render(<UserPreferencesProvider><ThemeProvider><Fixture failSave={failSave}/></ThemeProvider></UserPreferencesProvider>)); }
async function edit(index: number, value: string) {
  const row = host.querySelector<HTMLElement>(`[data-field="${index}"]`)!;
  await act(async () => row.click());
  const input = row.querySelector<HTMLInputElement>('input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  return input;
}

it.each([0, 1, 2])('saves row %i independently while retaining the row nodes and consuming the outside click', async index => {
  await render(); const rows = Array.from(host.querySelectorAll('[data-field]'));
  const input = await edit(index, '新的内容');
  expect(document.activeElement).toBe(input);
  await act(async () => host.querySelector<HTMLButtonElement>('button:not([aria-label])')!.click());
  const expected = ['第一条', '中间条', '最后条']; expected[index] = '新的内容';
  expect(read()).toEqual({ values: expected, clicks: 0 });
  expect(Array.from(host.querySelectorAll('[data-field]'))).toEqual(rows);
  expect(input.readOnly).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('button:not([aria-label])')!.click());
  expect(read().clicks).toBe(1);
});
it('finishes the current row before a second click can open another row and Escape cancels only that edit', async () => {
  await render(); await edit(0, '已保存的第一条');
  const second = host.querySelector<HTMLElement>('[data-field="1"]')!;
  await act(async () => second.click());
  expect(second.getAttribute('aria-expanded')).toBe('false');
  expect(read().values[0]).toBe('已保存的第一条');
  const input = await edit(1, '不应保存');
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(read().values[1]).toBe('中间条');
  expect(input.readOnly).toBe(true);
});
it('waits for Chinese composition to end before saving a pending outside click', async () => {
  await render(); const input = await edit(1, '拼音中');
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
  expect(input.readOnly).toBe(false);
  await act(async () => host.querySelector<HTMLButtonElement>('button:not([aria-label])')!.click());
  expect(read().values[1]).toBe('中间条');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '中文完成'); input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文完成' })); });
  expect(read().values[1]).toBe('中文完成');
  expect(input.readOnly).toBe(true);
  expect(read().clicks).toBe(0);
});
it('retains the draft and input focus when saving fails, and permits cancelling without a write', async () => {
  await render(true); const input = await edit(1, '保留的草稿');
  await act(async () => host.querySelector<HTMLButtonElement>('button:not([aria-label])')!.click());
  expect(read().values[1]).toBe('中间条'); expect(input.value).toBe('保留的草稿');
  expect(input.readOnly).toBe(false); expect(document.activeElement).toBe(input);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法保存');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="取消编辑信息1"]')!.click());
  expect(input.value).toBe('中间条'); expect(input.readOnly).toBe(true);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
