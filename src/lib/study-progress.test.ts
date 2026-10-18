import { describe, expect, it } from 'vitest';
import { blankSession, validateSession } from './practice-session';
import type { Question } from './practice';
import { studyProgress } from './study-progress';
import { insertAnswerFormat } from './rich-answer';

const now = Date.parse('2026-09-11T12:00:00Z');
describe('attempt-based review reminders', () => {
  it('does not count drafts or unanswered questions as attempts', () => {
    const session = { ...blankSession(), ids: ['q'], answers: { q: 'draft' } };
    expect(studyProgress(session, ['q'], now)).toMatchObject({ attempted: 0, due: [], continuing: true });
    expect(studyProgress({ ...session, finished: true }, ['q'], now).continuing).toBe(false);
    expect(studyProgress(session, ['other'], now).continuing).toBe(false);
  });
  it('uses exact one-day and three-day boundaries and latest chronological attempt', () => {
    const session = { ...blankSession(), attempts: [
      { id: 'q', correct: true, at: '2026-09-08T12:00:00Z' },
      { id: 'q', correct: false, at: '2026-09-01T12:00:00Z' },
      { id: 'r', correct: false, at: '2026-09-10T12:00:00Z' },
    ] };
    expect(studyProgress(session, ['q', 'r'], now - 1).due).toHaveLength(0);
    expect(studyProgress(session, ['q', 'r'], now).due.map(a => a.id)).toEqual(['q', 'r']);
    session.attempts.push({ id: 'q', correct: true, at: '2026-09-11T12:00:00Z' });
    expect(studyProgress(session, ['q', 'r'], now).due.map(a => a.id)).toEqual(['r']);
  });
  it('ignores removed questions, invalid dates and future attempts', () => {
    const session = { ...blankSession(), attempts: [
      { id: 'removed', correct: false, at: '2026-01-01' },
      { id: 'q', correct: false, at: 'invalid' },
      { id: 'q', correct: false, at: '2027-01-01' },
    ] };
    expect(studyProgress(session, ['q'], now).attempted).toBe(0);
  });
});

describe('answer toolbar preserves plain-string answers', () => {
  it('round-trips formatted drafts through the existing session validator unchanged', () => {
    const answer = insertAnswerFormat('推理：', 3, 3, 'formula')!.value;
    const session = { ...blankSession(), ids: ['q'], answers: { q: answer } };
    expect(validateSession(JSON.parse(JSON.stringify(session)), [{ id: 'q', kind: 'short' } as Question])).toEqual(session);
  });
  it('wraps only selected text and returns selection for continued editing', () => {
    expect(insertAnswerFormat('前重点后', 1, 3, 'bold')).toEqual({ value: '前**重点**后', start: 3, end: 5 });
    expect(insertAnswerFormat('前x后', 1, 2, 'formula')?.value).toBe('前$x$后');
  });
  it('creates separate list lines and paragraphs without dropping surrounding text', () => {
    expect(insertAnswerFormat('前甲\n乙后', 1, 4, 'list')?.value).toBe('前\n\n- 甲\n- 乙\n\n后');
    expect(insertAnswerFormat('前后', 1, 1, 'paragraph')?.value).toBe('前\n\n新段落\n\n后');
    expect(insertAnswerFormat('', 0, 0, 'formula')?.value).toBe('$P(A)$');
  });
  it('rejects an insertion over the storage limit without truncating an answer', () => {
    expect(insertAnswerFormat('x'.repeat(8000), 0, 1, 'bold')).toBeNull();
    expect(insertAnswerFormat('x'.repeat(7996), 0, 1, 'bold')?.value).toHaveLength(8000);
  });
});
