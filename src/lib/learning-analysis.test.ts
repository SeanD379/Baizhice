import { describe, expect, it } from 'vitest';
import { analyzeLearning, type LearningAnalysisInput, type LearningJudgment } from './learning-analysis';

const now = new Date('2026-10-15T04:00:00Z');
const judgment = (id: string, changes: Partial<LearningJudgment> = {}): LearningJudgment => ({
  id, questionKey: id, recordId: `record:${id}`, sourceRecordId: `saved:${id}`, roundId: 'round',
  ref: { engine: 'original', questionId: id, materialId: 'material' },
  title: `题目 ${id}`, sourceName: '阅读练习', topics: ['阅读理解'], origin: 'original',
  at: '2026-10-14T03:00:00Z', correct: false, timeSource: 'judged', available: true,
  location: { section: 'knowledge', activity: 'history' }, ...changes,
});
const input = (judgments: LearningJudgment[]): LearningAnalysisInput => ({
  courseId: 'course', courseName: '语文', judgments, records: [], states: [],
  materialCount: 2, versionCount: 1, withheld: false,
});

describe('unified learning analysis', () => {
  it('counts actual original, generated and PDF judgments once across archived copies', () => {
    const a = judgment('a');
    const result = analyzeLearning(input([a, { ...a }, judgment('b', { ref: { engine: 'generated', questionId: 'b', versionId: 'v' }, correct: true, origin: 'ai' }), judgment('c', { ref: { engine: 'pdf', questionId: '1', materialId: 'paper' }, topics: [], origin: 'pdf', correct: true })]), 7, now);
    expect(result.metrics).toEqual({ total: 3, correct: 2, accuracy: 67, activeDays: 1, reviewCount: 1 });
    expect(result.topics[0]).toMatchObject({ name: '阅读理解', total: 2, correct: 1 });
    expect(result.judgments).toHaveLength(3);
    expect(result.materialCount).toBe(2);
  });

  it('uses Beijing date boundaries and excludes invalid, future and out-of-period timestamps', () => {
    const result = analyzeLearning(input([judgment('boundary', { at: '2026-10-08T16:00:00Z' }), judgment('old', { at: '2026-10-08T15:59:59Z' }), judgment('future', { at: '2026-10-15T04:00:01Z' }), judgment('invalid', { at: 'invalid' })]), 7, now);
    expect(result.metrics.total).toBe(1);
    expect(result.days[0]).toEqual({ key: '2026-10-09', label: '10/9', total: 1, correct: 0 });
    expect(result.days).toHaveLength(7);
    expect(analyzeLearning(input([judgment('old', { at: '2026-10-01T00:00:00Z' })]), 30, now).metrics.total).toBe(1);
  });

  it('uses each question latest result and existing consolidation state for review priority', () => {
    const data = input([judgment('first', { questionKey: 'q' }), judgment('next', { questionKey: 'q', correct: true, at: '2026-10-15T02:00:00Z' }), judgment('wrong', { questionKey: 'consolidated' }), judgment('unavailable', { available: false })]);
    data.states = [{ key: 'consolidated', consolidatedAt: '2026-10-15T00:00:00Z', manualWrong: false }];
    const result = analyzeLearning(data, 7, now);
    expect(result.metrics.total).toBe(4);
    expect(result.metrics.reviewCount).toBe(1);
    expect(result.reviewItems).toHaveLength(0);
    expect(result.topics[0].reviewCount).toBe(1);
  });

  it('does not count multi-topic labels twice in the overview or invent a topic for untagged paper questions', () => {
    const result = analyzeLearning(input([judgment('multi', { topics: ['阅读理解', '表达', '表达'] }), judgment('paper', { topics: [] })]), 7, now);
    expect(result.metrics.total).toBe(2);
    expect(result.topics.map(t => t.name).sort()).toEqual(['表达', '阅读理解']);
    expect(result.topics.every(t => t.total === 1)).toBe(true);
  });

  it('keeps an empty course at zero with no invented percentage, record or recommendation', () => {
    const result = analyzeLearning(input([]), 7, now);
    expect(result.metrics).toEqual({ total: 0, correct: 0, accuracy: null, activeDays: 0, reviewCount: 0 });
    expect(result.reviewItems).toEqual([]);
    expect(result.records).toEqual([]);
    expect(result.savedTimeCount).toBe(0);
  });

  it('retains source identities and explicitly counts legacy saved timestamps', () => {
    const result = analyzeLearning(input([judgment('legacy', { timeSource: 'saved', available: false })]), 7, now);
    expect(result.savedTimeCount).toBe(1);
    expect(result.judgments[0]).toMatchObject({ recordId: 'record:legacy', roundId: 'round', ref: { materialId: 'material' }, available: false });
  });

  it('shows the latest saved record when current and archived snapshots share a round', () => {
    const data = input([judgment('a')]);
    data.records = [
      { id: 'record:a', sourceRecordId: 'current', title: '最新记录', at: '2026-10-15T02:00:00Z', finished: true, engine: 'original', location: { section: 'knowledge', activity: 'history' } },
      { id: 'record:a', sourceRecordId: 'archived', title: '旧快照', at: '2026-10-14T02:00:00Z', finished: false, engine: 'original', location: { section: 'knowledge', activity: 'history' } },
    ];
    expect(analyzeLearning(data, 7, now).records[0]).toMatchObject({ title: '最新记录', total: 1, finished: true });
  });
});
