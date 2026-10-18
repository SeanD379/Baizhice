import { expect, it } from 'vitest';
import { blankSession, submitExam, validateSession } from './practice-session';
import type { Question } from './practice';

const questions = [
  { id: 'c', kind: 'choice', options: ['A', 'B'], answer: 'A' },
  { id: 's', kind: 'short', answer: '参考要点' },
] as Question[];
const draft = () => ({ ...blankSession(), mode: 'exam' as const, ids: ['c', 's'], index: 1, answers: { c: 'A', s: '**我的推理**' } });
const at = '2026-09-11T12:00:00Z';

it('defaults old sessions to practice without losing their draft', () => {
  const { mode, submitted, ...old } = draft();
  expect(validateSession(old, questions)).toEqual({ ...old, mode: 'practice', submitted: false });
});
it('restores exam drafts with their position and no answer results', () => {
  expect(validateSession(JSON.parse(JSON.stringify(draft())), questions)).toEqual(draft());
});
it('submits the whole group once, grades objective answers, and defers subjective attempts', () => {
  const before = draft();
  const submitted = submitExam(before, questions, at);
  expect(before.results).toEqual({});
  expect(submitted).toMatchObject({ submitted: true, finished: false, index: 0, results: { c: { answer: 'A', correct: true }, s: { answer: '**我的推理**', correct: null } }, attempts: [{ id: 'c', correct: true, at }] });
  expect(validateSession(JSON.parse(JSON.stringify(submitted)), questions)).toEqual(submitted);
  expect(() => submitExam(submitted, questions, at)).toThrow('重复交卷');
  expect(() => validateSession({ ...submitted, finished: true }, questions)).toThrow('自评');
  expect(validateSession({ ...submitted, finished: true, results: { ...submitted.results, s: { ...submitted.results.s, correct: false } }, attempts: [...submitted.attempts, { id: 's', correct: false, at }] }, questions).finished).toBe(true);
});
it('rejects partial submissions and premature results', () => {
  expect(() => submitExam({ ...draft(), answers: { c: 'A', s: ' ' } }, questions, at)).toThrow('所有题目');
  expect(() => validateSession({ ...draft(), results: { c: { answer: 'A', correct: true } } }, questions)).toThrow('交卷前');
  expect(() => validateSession({ ...draft(), submitted: true, results: { c: { answer: 'A', correct: true } } }, questions)).toThrow('整组答案');
});
