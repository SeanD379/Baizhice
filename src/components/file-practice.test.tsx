// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FilePractice } from './file-practice';
import { sourceDocument } from '@/lib/notebook';
import type { OriginalQuestion, QuestionBankData } from '@/lib/question-bank-types';
vi.mock('./react-bits/SpotlightCard', () => ({ default: ({ children, className }: { children: React.ReactNode; className: string }) => <div className={className}>{children}</div> }));
vi.mock('./react-bits/LatticeLoader', () => ({ default: ({ label }: { label: string }) => <span>{label}</span> }));
const question = (id: string, answer = ''): OriginalQuestion => ({ id, materialId: 'file', number: id, section: '单选题', kind: 'single', prompt: `题目 ${id}`, context: '', options: [{ label: 'A', text: '甲' }, { label: 'B', text: '乙' }], sources: [{ name: '练习.docx', page: 1, snippet: '原文出处', location: 'paragraph' }], answer, answerSource: answer ? 'original' : 'none', explanation: answer ? '已有解析' : '', criteria: [], topics: ['知识点'], warnings: [], origin: 'original', practiceArea: 'knowledge' });
let root: Root, container: HTMLDivElement, bank: QuestionBankData, exam: boolean;
const onOpen = vi.fn();
const response = (json: unknown) => new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); sessionStorage.clear(); onOpen.mockReset(); exam = false;
  bank = { id: 'bank', materialId: 'file', name: '练习.docx', sourceHash: 'source', revision: 1, state: 'partial', error: '', updatedAt: 'test', progress: { done: 1, total: 2 }, questions: [question('1'), question('2', 'B')] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (body?.action === 'analyze') { bank = { ...bank, state: 'ready', revision: bank.revision + 1, questions: bank.questions.map(q => body.questionIds.includes(q.id) ? { ...q, answer: 'A', answerSource: 'ai', explanation: '补充解析' } : q) }; return response({ banks: [bank] }); }
    if (body?.action === 'original-load') return response({ scope: 'prepared-round' });
    if (body?.action === 'generate-knowledge') { const generated = { ...question('generated', 'A'), origin: 'variant' as const, answerSource: 'ai' as const, practiceReview: 'pending' as const }; bank = { ...bank, revision: bank.revision + 1, questions: [...bank.questions, generated] }; return response({ bank, questionIds: [generated.id] }); }
    if (body?.action === 'review-knowledge') { bank = { ...bank, revision: bank.revision + 1, questions: bank.questions.map(q => body.questionIds.includes(q.id) ? { ...q, practiceReview: 'approved' } : q) }; return response({ bank }); }
    if (url.startsWith('/api/question-banks')) return response({ banks: [bank], configured: true });
    if (url.startsWith('/api/notebooks/')) return response({ document: { chapters: [], inbox: [], trash: [], pages: [{ id: 'knowledge', title: '知识点', chapterId: null, doc: sourceDocument('知识点正文', { kind: 'material', label: '原文整理', refs: [{ materialId: 'file', name: '练习.docx', page: 1, snippet: '原文出处' }] }, 'source') }] } });
    return response({ withheldMaterials: exam ? ['file'] : [], materials: [{ id: 'file', name: '练习.docx', available: true, status: 'extracted' }] });
  }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<FilePractice courseId="course" materialId="file" onOpen={onOpen} onSource={() => undefined}/>)); await vi.waitFor(() => expect(container.textContent).toContain('练习.docx')); }
async function click(text: string) { const button = [...document.querySelectorAll('button')].find(button => button.textContent === text)!; expect(button).toBeTruthy(); await act(async () => button.click()); }
async function choose(label: string) { const checkbox = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; expect(checkbox).toBeTruthy(); await act(async () => checkbox.click()); }
it('starts exactly the selected ready question and makes no answer-generation request', async () => {
  await render(); await choose('选择题目 2'); await click('开始复习（1 项）');
  await vi.waitFor(() => expect(onOpen).toHaveBeenCalled());
  const posts = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(String(options!.body)));
  expect(posts).toEqual([expect.objectContaining({ action: 'original-load', questionIds: ['2'] })]);
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ activity: 'practice', materialId: 'file', scope: 'prepared-round', fromFile: true }));
});
it('fills only selected incomplete questions and requires answer review before entering practice', async () => {
  await render(); await choose('选择题目 1'); await click('开始复习（1 项）');
  expect(container.textContent).toContain('补齐 1 题答案与解析'); expect(onOpen).not.toHaveBeenCalled();
  await click('准备所选内容'); await vi.waitFor(() => expect(container.textContent).toContain('已核对，开始复习'));
  const analyze = vi.mocked(fetch).mock.calls.find(([, options]) => options?.body && JSON.parse(String(options.body)).action === 'analyze');
  expect(JSON.parse(String(analyze![1]!.body)).questionIds).toEqual(['1']);
  expect(bank.questions[1].answer).toBe('B'); expect(onOpen).not.toHaveBeenCalled();
  await click('已核对，开始复习'); await vi.waitFor(() => expect(onOpen).toHaveBeenCalled());
});
it('keeps selection on refresh and restores selected knowledge without exposing another file', async () => {
  await render(); await choose('选择题目 2'); await click('知识点（1）'); await choose('选择知识点 knowledge');
  await act(async () => root.unmount()); root = createRoot(container); await render();
  expect(container.textContent).toContain('开始复习（2 项）');
  await click('知识点（1）'); expect(container.querySelector<HTMLInputElement>('input[aria-label="选择知识点 knowledge"]')!.checked).toBe(true);
});
it('combines only selected originals and reviewed knowledge questions without regenerating on retry', async () => {
  await render(); await choose('选择题目 2'); await click('知识点（1）'); await choose('选择知识点 knowledge');
  await click('开始复习（2 项）'); await click('准备所选内容'); await vi.waitFor(() => expect(container.textContent).toContain('已核对，开始复习'));
  await click('已核对，开始复习'); await vi.waitFor(() => expect(onOpen).toHaveBeenCalled());
  const posts = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(String(options!.body)));
  expect(posts.find(body => body.action === 'generate-knowledge').pageIds).toEqual(['knowledge']);
  expect(posts.find(body => body.action === 'review-knowledge').questionIds).toEqual(['generated']);
  expect(posts.find(body => body.action === 'original-load').questionIds).toEqual(['2', 'generated']);
});
it('blocks answer disclosure and preparation while the file has an unsubmitted exam', async () => {
  exam = true; await render(); expect(container.textContent).toContain('未交卷考试');
  expect(container.textContent).not.toContain('已有解析'); expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
});
it('retains completed answers and exact selections across a failed preparation and retry', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  let fail = true;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (fail && options?.body && JSON.parse(String(options.body)).action === 'analyze') {
      fail = false;
      return new Response(JSON.stringify({ error: '本批中断，已完成答案保留。' }), { status: 503 });
    }
    return originalFetch(url, options);
  });
  await render(); await choose('选择题目 1'); await choose('选择题目 2');
  await click('开始复习（2 项）'); await click('准备所选内容');
  await vi.waitFor(() => expect(container.textContent).toContain('本批中断'));
  expect(onOpen).not.toHaveBeenCalled(); expect(bank.questions[1].answer).toBe('B');
  await click('重试准备'); await vi.waitFor(() => expect(container.textContent).toContain('已核对，开始复习'));
  const attempts = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.body && JSON.parse(String(options.body)).action === 'analyze');
  expect(attempts.map(([, options]) => JSON.parse(String(options!.body)).questionIds)).toEqual([['1'], ['1']]);
  await click('已核对，开始复习'); await vi.waitFor(() => expect(onOpen).toHaveBeenCalled());
});
it('recovers a knowledge generation completed after returning to selection under StrictMode', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  let finish!: () => Promise<void>;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (options?.body && JSON.parse(String(options.body)).action === 'generate-knowledge') return new Promise<Response>(resolve => { finish = async () => resolve(await originalFetch(url, options)); });
    return originalFetch(url, options);
  });
  await act(async () => root.render(<StrictMode><FilePractice courseId="course" materialId="file" onOpen={onOpen} onSource={() => undefined}/></StrictMode>));
  await vi.waitFor(() => expect(container.textContent).toContain('练习.docx'));
  await choose('选择题目 2'); await click('知识点（1）'); await choose('选择知识点 knowledge');
  await click('开始复习（2 项）'); await click('准备所选内容'); await vi.waitFor(() => expect(finish).toBeTruthy());
  await click('返回选择'); await act(async () => finish());
  await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem('lms.file-practice:course:file')!).questions).toEqual(['2', 'generated']));
  const begin = [...container.querySelectorAll('button')].find(button => button.textContent?.startsWith('开始复习'))!;
  await act(async () => begin.click()); await click('已核对，开始复习');
  await vi.waitFor(() => expect(onOpen).toHaveBeenCalled());
  const posts = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(String(options!.body)));
  expect(posts.filter(body => body.action === 'generate-knowledge')).toHaveLength(1);
  expect(posts.find(body => body.action === 'original-load').questionIds).toEqual(['2', 'generated']);
});
it('withholds stale knowledge answers and excludes them from batch choice', async () => {
  bank.questions.push({ ...question('stale', 'A'), origin: 'variant', answerSource: 'ai', explanation: '失效知识点的解析', knowledgeSourceStale: true, knowledgeSource: { pageIds: ['knowledge'], fingerprint: 'old' } });
  await render();
  expect(container.textContent).toContain('来源已更新'); expect(container.textContent).not.toContain('失效知识点的解析');
  expect(container.querySelector('input[aria-label="选择题目 stale"]')).toBeNull();
  await click('批量选择'); await click('选择本轮题目'); expect(container.textContent).toContain('开始复习（2 项）');
});
it('does not reselect a deselected generated question when a cancelled duplicate finishes late', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  const completions: ((response: Response) => void)[] = [];
  let generatedResponse: Response;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (options?.body && JSON.parse(String(options.body)).action === 'generate-knowledge') return new Promise<Response>(resolve => completions.push(resolve));
    return originalFetch(url, options);
  });
  await render(); await click('知识点（1）'); await choose('选择知识点 knowledge');
  await click('开始复习（1 项）'); await click('准备所选内容'); await vi.waitFor(() => expect(completions).toHaveLength(1));
  await click('返回选择'); await click('开始复习（1 项）'); await vi.waitFor(() => expect(completions).toHaveLength(2));
  await act(async () => { generatedResponse = await originalFetch('/api/question-banks', { body: JSON.stringify({ action: 'generate-knowledge' }) }); completions[1](generatedResponse.clone()); });
  await vi.waitFor(() => expect(container.textContent).toContain('已核对，开始复习'));
  await choose('选择题目 generated');
  await act(async () => completions[0](generatedResponse.clone()));
  expect(JSON.parse(sessionStorage.getItem('lms.file-practice:course:file')!).questions).toEqual([]);
  expect(container.querySelector<HTMLInputElement>('input[aria-label="选择题目 generated"]')!.checked).toBe(false);
});
it('places the original-file source beside answer disclosure and preserves its paragraph location', async () => {
  const onSource = vi.fn();
  await act(async () => root.render(<FilePractice courseId="course" materialId="file" onOpen={onOpen} onSource={onSource}/>));
  const row = container.querySelector('.file-practice-card-actions');
  expect(row?.querySelector('summary')?.textContent).toBe('查看答案与解析');
  const source = row?.querySelector<HTMLButtonElement>('.file-practice-source'); expect(source).toBeTruthy();
  await act(async () => source!.click());
  expect(onSource).toHaveBeenCalledWith(expect.objectContaining({ materialId: 'file', page: 1, location: 'paragraph', snippet: '原文出处' }));
});
it('centers real preparation progress in a dismissible loading dialog without losing selection', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => options?.body && JSON.parse(String(options.body)).action === 'analyze' ? new Promise<Response>(() => undefined) : originalFetch(url, options));
  await render(); await choose('选择题目 1'); await choose('选择题目 2'); await click('开始复习（2 项）'); await click('准备所选内容');
  const dialog = document.querySelector('[role="dialog"]'); expect(dialog?.querySelector('.practice-loading-screen')).toBeTruthy();
  expect(dialog?.textContent).toContain('正在准备复习'); expect(dialog?.querySelector('progress')?.getAttribute('max')).toBe('2');
  const back = [...dialog!.querySelectorAll('button')].find(button => button.textContent === '返回选择')!;
  await act(async () => back.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[aria-label="选择题目 1"]')!.checked).toBe(true);
});
