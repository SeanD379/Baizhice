import { describe, expect, it } from 'vitest';
import { beijingDay, mistakeFiles, parsePracticeLocation, practiceLocation, selectDailyQuestions, studyStatus, type StudyQuestion } from './practice-hub';

describe('practice navigation', () => {
  it('keeps section links on a homepage and restores old paper links as an activity', () => {
    expect(parsePracticeLocation(new URLSearchParams('view=practice&section=knowledge'))).toEqual({ section: 'knowledge', activity: null });
    expect(parsePracticeLocation(new URLSearchParams('view=exam&paper=paper-1&question=17'))).toEqual({ section: 'papers', activity: 'practice', materialId: 'paper-1', question: '17' });
    expect(practiceLocation('course-a', { section: 'papers', activity: null })).toBe('/?course=course-a&view=practice&section=papers');
    expect(parsePracticeLocation(new URLSearchParams('section=mistakes&activity=favorites&question=original:17'))).toEqual({ section: 'mistakes', activity: 'favorites', question: 'original:17' });
  });
});

it('changes the task date at Beijing midnight rather than UTC midnight', () => {
  expect(beijingDay(new Date('2026-10-01T15:59:59Z'))).toBe('2026-10-01');
  expect(beijingDay(new Date('2026-10-01T16:00:00Z'))).toBe('2026-10-02');
});

it('groups mistakes by material identity across topics and retains consolidated history without merging equal filenames', () => {
  const question = (id: string, materialId: string, extra: Partial<StudyQuestion> = {}): StudyQuestion => ({ key: id, ref: { engine: 'original', questionId: id, materialId }, prompt: id, topic: id, sourceName: '讲义.docx', section: 'knowledge', origin: 'original', available: true, favorite: false, manualWrong: false, mistake: true, consolidated: false, tags: [], note: '', ...extra });
  const groups = mistakeFiles([question('a', 'm1'), question('b', 'm1', { topic: '另一知识点' }), question('c', 'm2'), question('done', 'm1', { mistake: false, consolidated: true }), question('favorite', 'm3', { mistake: false, favorite: true })], []);
  expect(groups.map(group => [group.id, group.questions.map(q => q.key)])).toEqual([['m1', ['a', 'b', 'done']], ['m2', ['c']]]);
});

it('uses the actual reference material for generated mistakes without changing their saved study keys', () => {
  const question = (materialId: string): StudyQuestion => ({ key: materialId, ref: { engine: 'generated', questionId: materialId, versionId: 'v' }, sourceMaterialId: materialId, prompt: materialId, topic: '概念', sourceName: '同名资料.docx', section: 'knowledge', origin: 'ai', available: true, favorite: false, manualWrong: false, mistake: true, consolidated: false, tags: [], note: '' });
  const materials = ['m1', 'm2'].map(id => ({ id, name: '同名资料.docx' })) as Parameters<typeof mistakeFiles>[1];
  expect(mistakeFiles([question('m1'), question('m2')], materials).map(group => group.id)).toEqual(['m1', 'm2']);
});

it('reopens a consolidated mistake after a new wrong answer while retaining notes and favorites', () => {
  const state = { favorite: true, manualWrong: true, tags: ['古诗文'], note: '注意主语', consolidatedAt: '2026-10-01T08:00:00Z' };
  expect(studyStatus(state, { correct: false, at: '2026-10-01T07:00:00Z' }, '2026-10-02T08:00:00Z')).toMatchObject({ favorite: true, mistake: false, consolidated: true });
  expect(studyStatus(state, { correct: false, at: '2026-10-02T07:00:00Z' }, '2026-10-02T08:00:00Z')).toMatchObject({ favorite: true, mistake: true, consolidated: false, tags: ['古诗文'], note: '注意主语' });
  expect(studyStatus(state, { correct: true, at: '2026-10-02T07:00:00Z' }, '2026-10-02T08:00:00Z')).toMatchObject({ mistake: false, consolidated: true });
  expect(studyStatus({ ...state, consolidatedAt: null }, { correct: true, at: '2026-10-01T07:00:00Z' }, '2026-10-02T08:00:00Z')).toMatchObject({ mistake: true });
});

it('selects at most five due and new questions, skips stale sources and leaves recently studied questions for later', () => {
  const question = (key: string, extra: Partial<StudyQuestion> = {}): StudyQuestion => ({ key, ref: { engine: 'original', questionId: key, materialId: 'm' }, prompt: key, topic: '古诗文', sourceName: '讲义', section: 'knowledge', origin: 'original', available: true, favorite: false, manualWrong: false, mistake: false, consolidated: false, tags: [], note: '', ...extra });
  const pool = [question('new-1'), question('later', { lastAttempt: { correct: true, at: '2026-10-02T00:00:00Z' }, dueAt: '2026-10-05T00:00:00Z' }), question('stale', { available: false }), question('due', { lastAttempt: { correct: false, at: '2026-09-30T00:00:00Z' }, dueAt: '2026-10-01T00:00:00Z', mistake: true }), ...['2', '3', '4', '5', '6'].map(id => question('new-' + id))];
  expect(selectDailyQuestions(pool, 'knowledge', new Date('2026-10-02T02:00:00Z')).map(q => q.key)).toEqual(['due', 'new-1', 'new-2', 'new-3', 'new-4']);
  expect(selectDailyQuestions(pool, 'mistakes', new Date('2026-10-02T02:00:00Z')).map(q => q.key)).toEqual(['due']);
});
