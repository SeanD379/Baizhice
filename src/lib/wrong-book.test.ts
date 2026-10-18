import { expect, it } from 'vitest';
import { knowledgeMistakes } from './wrong-book';
import type { PracticeHistoryData } from './practice-history';

it('keeps only each question’s latest incorrect attempt across saved rounds', () => {
  const question = { id: 'q1', prompt: '条件概率怎么算？', topic: '条件概率', answer: '答案', explanation: '解析', reference: { materialId: 'm', name: '笔记', page: 1, snippet: '依据' }, kind: 'short' as const };
  const entry = (id: string, at: string, correct: boolean, withheld = false) => ({
    id, version: { id: 'v', courseId: 'c', number: 1, title: '提纲', sections: [], sourceIds: [], summary: '', createdAt: at }, createdAt: at,
    model: null, reviewed: true, sourceHash: null, questions: [question], snapshot: 'saved' as const, withheld,
    session: { id, updatedAt: at, state: { mode: 'practice' as const, submitted: false, ids: ['q1'], index: 0, answers: {}, results: {}, finished: false, attempts: [{ id: 'q1', correct, at }] } },
  });
  const history = { courseName: '课程', entries: [entry('older', '2026-09-01T00:00:00.000Z', false), entry('newer', '2026-09-02T00:00:00.000Z', true)] } as PracticeHistoryData;
  expect(knowledgeMistakes(history)).toEqual([]);
  history.entries.push(entry('latest', '2026-09-03T00:00:00.000Z', false));
  expect(knowledgeMistakes(history).map(item => item.question.id)).toEqual(['q1']);
  history.entries.push(entry('hidden', '2026-09-04T00:00:00.000Z', true, true));
  expect(knowledgeMistakes(history).map(item => item.question.id)).toEqual(['q1']);
});
