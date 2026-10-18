// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SourceNote } from './notebook-content';
import type { NotebookOrigin } from '@/lib/notebook';

let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const origin: NotebookOrigin = { kind: 'ai', label: 'AI 整理 · 个人修订', refs: [{ materialId: 'word', name: '概念.docx', page: 2, snippet: '汇率' }], needsReview: true, generation: { provider: 'DeepSeek', model: 'test', draftId: 'd', contentOrigin: 'ai-supplement' } };

it('shows supplementary content and question provenance before and after human confirmation', async () => {
  const onReference = vi.fn(), onConfirm = vi.fn();
  await act(async () => root.render(<SourceNote origin={origin} onReference={onReference} onConfirm={onConfirm}/>));
  expect(container.textContent).toContain('AI 补充解释 · 个人修订 · 待核对');
  expect(container.textContent).toContain('提问出处，非答案依据');
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  expect(onReference).toHaveBeenCalledWith(origin.refs[0]);
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '我已核对')!.click());
  expect(onConfirm).toHaveBeenCalledOnce();
  await act(async () => root.render(<SourceNote origin={{ ...origin, label: '审核完成', needsReview: false }} onReference={onReference} onConfirm={onConfirm}/>));
  expect(container.textContent).toContain('AI 补充解释'); expect(container.textContent).toContain('提问出处，非答案依据');
  expect(container.textContent).not.toContain('待核对'); expect(container.textContent).not.toContain('我已核对');
});
it('marks old generated notes as source organization without changing non AI source names', async () => {
  await act(async () => root.render(<SourceNote origin={{ ...origin, generation: { provider: 'DeepSeek', model: 'old', draftId: 'old' } }}/>));
  expect(container.textContent).toContain('原文整理 · 个人修订'); expect(container.textContent).not.toContain('提问出处');
  await act(async () => root.render(<SourceNote origin={{ ...origin, kind: 'material', generation: undefined, label: '讲义摘录' }}/>));
  expect(container.textContent).toContain('讲义摘录');
});
it('collapses repeated file references into one entry while preserving every original jump', async () => {
  const refs = Array.from({ length: 10 }, (_, index) => ({ ...origin.refs[0], page: index + 2, location: 'paragraph' as const })), onReference = vi.fn();
  await act(async () => root.render(<SourceNote origin={{ ...origin, refs }} onReference={onReference}/>));
  const details = container.querySelector('details')!;
  expect(details.open).toBe(false); expect(details.querySelector('summary')?.textContent).toBe('概念.docx10 处出处');
  expect(details.querySelectorAll('strong')).toHaveLength(1); expect(details.querySelectorAll('button')).toHaveLength(10);
  details.open = true;
  await act(async () => details.querySelectorAll<HTMLButtonElement>('button')[7].click());
  expect(onReference).toHaveBeenCalledWith(refs[7]);
});
