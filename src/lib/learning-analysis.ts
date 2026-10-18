import { beijingDay, studyStatus, type PracticeLocation, type QuestionRef, type QuestionStudyState } from './practice-hub';

export type LearningJudgment = {
  id: string; questionKey: string; recordId: string; sourceRecordId: string; sourceMaterialId?: string; roundId?: string; ref: QuestionRef;
  title: string; sourceName: string; topics: string[]; origin: 'original' | 'ai' | 'pdf' | 'unknown';
  at: string; correct: boolean; timeSource: 'judged' | 'saved'; available: boolean;
  location: PracticeLocation;
};
export type LearningRecord = { id: string; sourceRecordId: string; title: string; at: string; finished: boolean; location: PracticeLocation; engine: QuestionRef['engine']; roundId?: string };
export type LearningAnalysisInput = {
  courseId: string; courseName: string; judgments: LearningJudgment[]; records: LearningRecord[];
  states: Pick<QuestionStudyState, 'key' | 'manualWrong' | 'consolidatedAt'>[];
  materialCount: number; versionCount: number; withheld: boolean;
};
export type LearningAnalysisData = {
  courseId: string; courseName: string; period: 7 | 30; updatedAt: string;
  metrics: { total: number; correct: number; accuracy: number | null; activeDays: number; reviewCount: number };
  days: LearningDay[]; topics: { name: string; total: number; correct: number; reviewCount: number }[];
  judgments: LearningJudgment[]; reviewItems: LearningJudgment[];
  records: (LearningRecord & { total: number; correct: number })[];
  materialCount: number; versionCount: number; savedTimeCount: number; withheld: boolean;
};

export function analyzeLearning(input: LearningAnalysisInput, period: 7 | 30, now = new Date()): LearningAnalysisData {
  const today = beijingDay(now);
  const days: LearningDay[] = Array.from({ length: period }, (_, index) => {
    const date = new Date(`${today}T00:00:00+08:00`);
    date.setUTCDate(date.getUTCDate() - period + index + 1);
    const key = beijingDay(date);
    return { key, label: `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`, total: 0, correct: 0 };
  });
  const byDay = new Map(days.map(day => [day.key, day]));
  const judgments = [...new Map(input.judgments.filter(item => Number.isFinite(Date.parse(item.at)) && Date.parse(item.at) <= now.getTime() && byDay.has(beijingDay(new Date(item.at)))).map(item => [item.id, item])).values()]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const latest = new Map<string, LearningJudgment>();
  const states = new Map(input.states.map(state => [state.key, state]));
  const topics = new Map<string, { name: string; total: number; correct: number; reviewCount: number }>();
  for (const item of judgments) {
    const day = byDay.get(beijingDay(new Date(item.at)))!;
    day.total++; if (item.correct) day.correct++;
    if (!latest.has(item.questionKey)) latest.set(item.questionKey, item);
    for (const name of new Set(item.topics.map(topic => topic.trim()).filter(Boolean))) {
      const topic = topics.get(name) ?? { name, total: 0, correct: 0, reviewCount: 0 };
      topic.total++; if (item.correct) topic.correct++;
      topics.set(name, topic);
    }
  }
  const needsReview = [...latest.values()].filter(item => {
    const state = states.get(item.questionKey);
    return studyStatus(state ? { ...state, favorite: false, tags: [], note: '' } : undefined, { correct: item.correct, at: item.at }, now.toISOString()).mistake;
  });
  for (const item of needsReview) for (const name of new Set(item.topics.map(topic => topic.trim()).filter(Boolean))) topics.get(name)!.reviewCount++;
  const correct = judgments.filter(item => item.correct).length;
  const records = [...new Map([...input.records].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).filter(record => Number.isFinite(Date.parse(record.at)) && Date.parse(record.at) <= now.getTime() && byDay.has(beijingDay(new Date(record.at)))).map(record => [record.id, record])).values()]
    .map(record => { const items = judgments.filter(item => item.recordId === record.id); return { ...record, total: items.length, correct: items.filter(item => item.correct).length }; })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return {
    courseId: input.courseId, courseName: input.courseName, period, updatedAt: now.toISOString(),
    metrics: { total: judgments.length, correct, accuracy: judgments.length ? Math.round(correct / judgments.length * 100) : null, activeDays: days.filter(day => day.total > 0).length, reviewCount: needsReview.length },
    days, judgments, topics: [...topics.values()].sort((a, b) => b.reviewCount - a.reviewCount || a.correct / a.total - b.correct / b.total || b.total - a.total || a.name.localeCompare(b.name, 'zh-CN')),
    reviewItems: needsReview.filter(item => item.available).slice(0, 3), records,
    materialCount: input.materialCount, versionCount: input.versionCount,
    savedTimeCount: judgments.filter(item => item.timeSource === 'saved').length, withheld: input.withheld,
  };
}

export type LearningDay = { key: string; label: string; total: number; correct: number };
