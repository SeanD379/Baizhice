// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PracticeStudyProvider, QuestionStudyControls } from './practice-study-context';
import { questionRefKey, type QuestionStudyState } from '@/lib/practice-hub';

const question = { engine: 'original' as const, questionId: 'q', materialId: 'm' };
let root: Root, container: HTMLDivElement, states: QuestionStudyState[];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  states = [{ key: questionRefKey(question), ref: question, revision: 1, favorite: false, manualWrong: true, tags: ['旧标签'], note: '已保存笔记', consolidatedAt: null }];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const { changes } = JSON.parse(init.body as string);
      states = states.map(state => ({ ...state, ...changes, revision: state.revision + 1 }));
    }
    return new Response(JSON.stringify({ states }));
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function edit(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('retains unsaved review text and tags when favorite and consolidation update other fields', async () => {
  await act(async () => root.render(<PracticeStudyProvider courseId="c"><QuestionStudyControls question={question} editable/></PracticeStudyProvider>));
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes('标签与复盘笔记'))!.click());
  const note = container.querySelector('textarea')!, tags = container.querySelector('input')!;
  await edit(note, '刚输入的错因'); await edit(tags, '阅读，审题');
  const click = async (text: string) => act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === text)!.click());
  await click('收藏题目');
  expect(note.value).toBe('刚输入的错因'); expect(tags.value).toBe('阅读，审题');
  await click('标记已巩固');
  expect(note.value).toBe('刚输入的错因'); expect(tags.value).toBe('阅读，审题');
  await click('保存笔记与标签');
  expect(states[0]).toMatchObject({ favorite: true, note: '刚输入的错因', tags: ['阅读', '审题'], revision: 4 });
});

it('groups the practice action and review trigger with the study buttons and retains drafts when collapsed', async () => {
  await act(async () => root.render(<PracticeStudyProvider courseId="c"><QuestionStudyControls question={question} editable primaryAction={<button>练习这道题</button>}/></PracticeStudyProvider>));
  const actions = container.querySelector('.question-study-buttons')!;
  expect(actions.textContent).toContain('练习这道题');
  const review = [...actions.querySelectorAll('button')].find(button => button.textContent?.includes('标签与复盘笔记'))!;
  const editor = container.querySelector('.question-review-editor') as HTMLElement;
  expect(editor.hidden).toBe(true);
  await act(async () => review.click());
  expect(review.getAttribute('aria-expanded')).toBe('true');
  await edit(editor.querySelector('textarea')!, '收起前的复盘草稿');
  await act(async () => review.click());
  expect(editor.hidden).toBe(true);
  await act(async () => review.click());
  expect(editor.querySelector('textarea')!.value).toBe('收起前的复盘草稿');
});
