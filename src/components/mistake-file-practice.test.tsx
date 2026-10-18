// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MistakeFilePractice } from './mistake-file-practice';
import { PracticeStudyProvider } from './practice-study-context';
import type { StudyQuestion } from '@/lib/practice-hub';

let root: Root, container: HTMLDivElement, withheld: string[], fail: boolean;
const onOpen = vi.fn();
const question = (id: string, materialId = 'm'): StudyQuestion => ({ key: JSON.stringify(['original', id, materialId, '', '']), ref: { engine: 'original', questionId: id, materialId }, prompt: `错题 ${id}`, topic: id, sourceName: `${materialId}.docx`, section: 'knowledge', origin: 'original', available: true, favorite: false, manualWrong: false, mistake: true, consolidated: false, tags: [], note: '' });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const click = async (text: string) => act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes(text))!.click());
beforeEach(() => {
  withheld = []; fail = false; onOpen.mockClear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/practice-hub')) return response({ materials: [{ id: 'm', name: 'm.docx' }], catalog: [question('1'), question('2'), question('other', 'another')], withheldMaterials: withheld });
    if (url.startsWith('/api/practice-state')) return response({ states: [] });
    if (init?.method === 'POST') return fail ? response({ error: '来源已更新' }, 409) : response({ scope: 'mistake-scope' });
    return response({});
  }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(<PracticeStudyProvider courseId="c"><MistakeFilePractice courseId="c" location={{ section: 'mistakes', activity: 'file', materialId: 'm' }} onOpen={onOpen}/></PracticeStudyProvider>));
  await vi.waitFor(() => expect(container.textContent).toContain('错题 1'));
}
it('shows only this material and starts its selected mistakes in a new saved round', async () => {
  await render(); expect(container.textContent).not.toContain('错题 other');
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  await click('批量管理');
  await act(async () => (container.querySelector('[aria-label="选择错题 1"]') as HTMLInputElement).click());
  await click('错题巩固');
  await vi.waitFor(() => expect(onOpen).toHaveBeenCalledWith({ section: 'mistakes', activity: 'practice', materialId: 'm', scope: 'mistake-scope', fromFile: true }));
  const body = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body;
  expect(JSON.parse(body as string)).toMatchObject({ action: 'original-load', questionIds: ['1'], newRound: true, mode: 'practice' });
});
it('blocks consolidation while this material has an unsubmitted exam', async () => {
  withheld = ['m']; await render();
  expect(container.textContent).toContain('未交卷');
  const button = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('错题巩固'))!;
  expect(button.disabled).toBe(true);
});
it('retains the detail page and shows the failure when starting a round is rejected', async () => {
  fail = true; await render(); await click('错题巩固');
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('来源已更新'));
  expect(onOpen).not.toHaveBeenCalled();
});

it('preserves an unsaved review note on another question when bulk management succeeds', async () => {
  await render(); await click('批量管理');
  const second = container.querySelectorAll('article')[1];
  await act(async () => [...second.querySelectorAll('button')].find(button => button.textContent?.includes('标签与复盘笔记'))!.click());
  const textarea = second.querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '未保存的复盘草稿'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => (container.querySelector('[aria-label="选择错题 1"]') as HTMLInputElement).click());
  await click('批量收藏');
  await vi.waitFor(() => expect(container.querySelectorAll('article')[1]?.querySelector('textarea')?.value).toBe('未保存的复盘草稿'));
});
