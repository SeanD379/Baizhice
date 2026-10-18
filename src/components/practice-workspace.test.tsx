import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { blankSession, submitExam, type PracticeSession } from '@/lib/practice-session';
import type { PracticeData } from '@/lib/practice-store';
import type { Version } from '@/lib/types';
import { PracticeWorkspace } from './practice-workspace';

const saved = vi.hoisted(() => ({ value: true }));
vi.mock('./use-practice-session', () => ({ usePracticeSession: (data: PracticeData) => ({ session: data.session, setSession: vi.fn(), saveMessage: '', saveError: '', isSaved: saved.value }) }));
const question = { id: 'q', kind: 'short' as const, prompt: '测试题干', topic: '测试知识点', answer: '隐藏参考答案', explanation: '隐藏解析', reference: { materialId: 'm', name: '资料.pptx', page: 2, snippet: '依据' } };
function render(session: PracticeSession) {
  const data = { questions: [question], session, set: null, configured: true } as PracticeData;
  return renderToStaticMarkup(<PracticeWorkspace courseId="c" version={{ id: 'v', number: 1 } as Version} data={data} onRead={() => {}} onSource={() => {}}/>);
}
const draft = () => ({ ...blankSession(), mode: 'exam' as const, ids: ['q'], answers: { q: '我的回答' } });
it('withholds reference answers and optional AI feedback before whole-group submission', () => {
  const html = render(draft());
  expect(html).toContain('整组交卷并查看解析');
  expect(html).not.toContain('隐藏参考答案');
  expect(html).not.toContain('隐藏解析');
  expect(html).not.toContain('同意发送并获取 AI 反馈');
});
it('reveals references and self-assessment after submission with format-aware locations', () => {
  saved.value = true;
  const html = render(submitExam(draft(), [question], '2026-09-11T12:00:00Z'));
  expect(html).toContain('隐藏参考答案');
  expect(html).toContain('尚未覆盖要点，加入待巩固');
  expect(html).toContain('第 2 张幻灯片');
  expect(html).toContain('同意发送并获取 AI 反馈');
});
it('disables requesting AI feedback while keeping the component mounted for an unsaved answer', () => {
  saved.value = false;
  const html = render(submitExam(draft(), [question], '2026-09-11T12:00:00Z'));
  expect(html).toMatch(/<button[^>]*disabled[^>]*>同意发送并获取 AI 反馈/);
  expect(html).toContain('答案保存成功后');
  saved.value = true;
});
