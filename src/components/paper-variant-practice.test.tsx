// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PaperVariantPractice } from './paper-variant-practice';
import type { Material } from '@/lib/types';
import type { PracticeLocation } from '@/lib/practice-hub';
import type { OriginalQuestion, QuestionBankData } from '@/lib/question-bank-types';

const material: Material = { id: 'paper', courseId: 'c', name: '很长的原卷文件名.pdf', chapter: '历年套卷', status: 'ready', excluded: false, origin: 'upload', mime: 'application/pdf', size: 2, fixture: null, createdAt: '' };
const base: OriginalQuestion = { id: 'base', materialId: 'paper', number: '24', section: '阅读理解', kind: 'single', prompt: '完整原题题干', context: '共同材料全文', options: [{ label: 'A', text: '原题选项' }], topics: ['阅读'], sources: [], answer: '原题答案秘密', answerSource: 'original', explanation: '原题解析秘密', criteria: [], warnings: [], origin: 'original', media: [{ url: '/figure.png', label: '原题图表' }] };
const variant = (id: string): OriginalQuestion => ({ ...base, id: `base:variant:${id}`, origin: 'variant', prompt: `同类题 ${id}`, answer: '变式答案秘密', explanation: '变式解析秘密' });
let root: Root, container: HTMLDivElement, bank: QuestionBankData, configured: boolean, withheld: string[], calls: Record<string, unknown>[], failed: string;
const onOpen = vi.fn((_location: PracticeLocation) => {});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const button = (text: string) => [...document.querySelectorAll('button')].find(el => el.textContent === text)!;
const click = async (text: string) => act(async () => button(text).click());
async function render(question?: string) {
  await act(async () => root.render(<PaperVariantPractice courseId="c" materials={[material]} location={{ section: 'papers', activity: 'variants', materialId: 'paper', question }} onOpen={onOpen} onUpload={()=>{}}/>));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  bank = { id: 'bank', materialId: 'paper', name: material.name, sourceHash: 'hash', revision: 1, state: 'ready', questions: [base, ...Array.from({ length: 7 }, (_, i) => variant(`old-${i}`))], progress: { done: 8, total: 8 }, error: '', updatedAt: '' };
  configured = true; withheld = []; calls = []; onOpen.mockClear(); failed = '';
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/practice-hub')) return response({ withheldMaterials: withheld, records: [] });
    if (!init?.method || init.method === 'GET') return response({ banks: [bank], configured });
    const body = JSON.parse(init.body as string); calls.push(body);
    if (body.action === failed) return response({ error: '这次请求失败，请重试' }, 500);
    if (body.action === 'variants') { bank = { ...bank, revision: 2, questions: [...bank.questions, variant('fresh-1'), variant('fresh-2'), { ...variant('other'), id: 'another-base:variant:fresh' }] }; return response({ bank }); }
    if (body.action === 'prepare') { bank = { ...bank, stale: false }; return response({ banks: [bank], configured }); }
    return response({ scope: 'variant-scope' });
  }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('shows the complete original, restores its selection, and restores only its five most recent variants without calling AI', async () => {
  await render('base');
  expect(container.textContent).toContain('共同材料全文'); expect(container.textContent).toContain('原题选项');
  expect(container.querySelector('img[alt="原题图表"]')).toBeTruthy();
  expect((container.querySelector('[aria-label="选择原题"]') as HTMLSelectElement).value).toBe('base');
  expect(container.querySelectorAll('.hub-variant-results article')).toHaveLength(5);
  expect(container.querySelector('.hub-variant-results')?.textContent).not.toContain('同类题 old-0');
  expect(container.querySelector('.hub-variant-results')?.textContent).not.toContain('变式答案秘密');
  expect(calls).toHaveLength(0);
});

it('uses only original mistakes as variant bases and keeps the mistake section without the material management tables', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.startsWith('/api/practice-hub') ? response({ withheldMaterials: [], catalog: [{ ref: { engine: 'original', questionId: 'base', materialId: 'paper' }, mistake: true, available: true }] }) : originalFetch(url, init)));
  bank.questions.push({ ...base, id: 'not-wrong', number: '25' });
  await act(async () => root.render(<PaperVariantPractice courseId="c" materials={[material]} location={{ section: 'mistakes', activity: 'variants' }} onOpen={onOpen} onUpload={()=>{}}/>));
  await vi.waitFor(() => expect(container.textContent).toContain('完整原题题干'));
  expect(container.querySelectorAll('[aria-label="选择原题"] option')).toHaveLength(2);
  expect(container.querySelector('.original-material-details')).toBeNull();
  expect(calls).toHaveLength(0);
  await click('开始 5 道同类题');
  await vi.waitFor(() => expect(onOpen).toHaveBeenCalledWith({ section: 'mistakes', activity: 'practice', scope: 'variant-scope', variant: true, materialId: 'paper', fromFile: true }));
});

it('requires generation consent and starts precisely this response’s new variants, retaining the paper section and variant route', async () => {
  await render(); await click('生成最多 5 道同类题');
  expect(calls).toHaveLength(0); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('API 费用');
  await click('同意发送并生成');
  expect(calls).toEqual([{ action: 'variants', courseId: 'c', bankId: 'bank', questionId: 'base', count: 5, confirmed: true }]);
  expect(container.querySelectorAll('.hub-variant-results article')).toHaveLength(2);
  expect(container.querySelector('.hub-variant-results')?.textContent).not.toContain('同类题 old-6');
  await click('开始 2 道同类题');
  expect(calls.at(-1)).toMatchObject({ action: 'original-load', context: 'knowledge', questionIds: ['base:variant:fresh-1', 'base:variant:fresh-2'], mode: 'practice', newRound: true });
  expect(onOpen).toHaveBeenLastCalledWith({ section: 'papers', activity: 'practice', scope: 'variant-scope', variant: true });
});

it.each(['answer', 'stale', 'configuration', 'exam'] as const)('explains %s and disables generating without an AI request', async (reason) => {
  if (reason === 'answer') bank.questions = [{ ...base, answer: '' }];
  if (reason === 'stale') bank.stale = true;
  if (reason === 'configuration') configured = false;
  if (reason === 'exam') withheld = ['paper'];
  await render(); expect(button('生成最多 5 道同类题').disabled).toBe(true); expect(calls).toHaveLength(0);
  const expected = { answer: '参考答案', stale: '重新读取', configuration: '尚未配置', exam: '未交卷' };
  expect(container.textContent).toContain(expected[reason]);
  if (reason === 'exam') { expect(container.textContent).not.toContain('原题答案秘密'); expect(container.querySelector('.hub-variant-results')).toBeNull(); }
});

it('rechecks exams when confirming generation and when starting previously generated questions', async () => {
  await render(); await click('生成最多 5 道同类题'); withheld = ['paper']; await click('同意发送并生成');
  expect(calls).toHaveLength(0); expect(document.body.textContent).toContain('未交卷');
});

it('rechecks exams before starting a group', async () => {
  await render(); withheld = ['paper']; await click('开始 5 道同类题');
  expect(calls).toHaveLength(0); expect(onOpen).not.toHaveBeenCalled();
});

it('retains the original and existing variants after a failed generation and offers retry', async () => {
  await render(); failed = 'variants'; await click('生成最多 5 道同类题'); await click('同意发送并生成');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('这次请求失败');
  expect(container.querySelectorAll('.hub-variant-results article')).toHaveLength(5);
  failed = ''; await click('同意发送并生成'); expect(container.querySelectorAll('.hub-variant-results article')).toHaveLength(2);
});

it('updates the existing selection URL parameters without generating when the selected original changes', async () => {
  const next = { ...base, id: 'second', number: '25' }; bank.questions.push(next); await render();
  await act(async () => { const select = container.querySelector('[aria-label="选择原题"]') as HTMLSelectElement; select.value = 'second'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(onOpen).toHaveBeenCalledWith({ section: 'papers', activity: 'variants', materialId: 'paper', question: 'second' });
  expect(calls).toHaveLength(0);
});

it('cancels the fee confirmation without generating', async () => {
  await render(); await click('生成最多 5 道同类题'); await click('取消');
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(calls).toHaveLength(0);
});

it('rereads a stale source explicitly without generating and restores the original selector', async () => {
  bank.stale = true; await render(); await click('重新读取试卷');
  expect(calls).toEqual([{ action: 'prepare', courseId: 'c', materialIds: ['paper'] }]);
  expect(button('生成最多 5 道同类题').disabled).toBe(false);
  expect(container.querySelector('.hub-variant-base')?.textContent).toContain('完整原题题干');
});

it('shows a retry when exam status cannot be read and never generates or starts a group', async () => {
  const normal = global.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.startsWith('/api/practice-hub') ? response({ error: '考试状态读取失败' }, 500) : normal(url, init)));
  await render(); expect(container.textContent).toContain('考试状态读取失败');
  expect(button('生成最多 5 道同类题').disabled).toBe(true); expect(calls).toHaveLength(0);
});
