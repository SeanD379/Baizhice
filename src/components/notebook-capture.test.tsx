// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyNotebook, markdownDocument, richText, sourceBlocks, type NotebookData } from '@/lib/notebook';
import { CaptureButton, NotebookProvider } from './notebook-context';
import type { NotebookStore } from './use-notebook';

let root: Root, container: HTMLDivElement, data: NotebookData, store: NotebookStore;
const origin = { kind: 'practice' as const, label: '错题复盘', questionId: 'question-3', refs: [{ materialId: 'original', name: '讲义.pdf', page: 2, snippet: '参考原文' }] };
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  data = { courseId: 'course', revision: 1, updatedAt: '', document: { ...emptyNotebook(), pages: [{ id: 'existing', title: '已有知识点', chapterId: null, doc: markdownDocument('我的个人理解。') }] } };
  store = { data, status: '已保存', error: '', conflict: null, update: vi.fn(transform => { data.document = transform(structuredClone(data.document)); }), flush: vi.fn(async () => true), resolveConflict: vi.fn(), setEditingActive: vi.fn(), getCurrent: () => data, reload: vi.fn(async () => {}) };
  await act(async () => root.render(<NotebookProvider store={store}><p>当前练习位置</p><CaptureButton title="阅读理解" body="这次复盘的解题思路。" origin={origin}/></NotebookProvider>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(label: string) { await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === label)!.click()); }
async function select(value: string) { await act(async () => { const select = document.querySelector<HTMLSelectElement>('[role=dialog] select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }); }

it('keeps the learning position while capturing feedback and its exact source into inbox', async () => {
  await click('加入笔记'); await click('确认收录');
  expect(data.document.inbox).toHaveLength(1);
  expect(richText(data.document.inbox[0].doc)).toContain('解题思路');
  expect(sourceBlocks(data.document.inbox[0].doc)[0].attrs?.origin).toEqual(origin);
  expect(container.textContent).toContain('当前练习位置');
  expect(document.querySelector('[role=dialog]')).toBeNull();
});
it('appends captured feedback without replacing personal edits', async () => {
  await click('加入笔记'); await select('existing'); await click('确认收录');
  expect(data.document.pages).toHaveLength(1);
  expect(richText(data.document.pages[0].doc)).toContain('我的个人理解');
  expect(richText(data.document.pages[0].doc)).toContain('解题思路');
  expect(data.document.inbox).toHaveLength(0);
});
it('keeps capture open when another device has deleted the selected target', async () => {
  await click('加入笔记'); await select('existing'); data.document.pages = []; await click('确认收录');
  expect(store.update).not.toHaveBeenCalled();
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('重新选择保存位置');
  await select('inbox'); await click('确认收录');
  expect(data.document.inbox).toHaveLength(1);
});
