import { db } from './db';
import { analyzeLearning, type LearningJudgment, type LearningRecord } from './learning-analysis';
import { practiceHistory } from './practice-history';
import { originalPracticeHistory } from './original-practice-store';
import { practiceHubSummary, readQuestionStates } from './practice-hub-store';
import { questionRefKey, type DailyGroup, type PracticeLocation, type QuestionRef } from './practice-hub';
import { readExamProtection } from './exam-protection';
import { listQuestionBanks } from './question-bank-store';
import { originalQuestionShape } from './question-bank';
import { hashContent } from './generation';
import { isDeepStrictEqual } from 'node:util';
import type { Question } from './practice';
import type { OriginalQuestion, OriginalSessionState } from './question-bank-types';
import type { ExamRecord } from './exam-record';

export async function learningAnalysis(courseId: string, period: 7 | 30, now = new Date()) {
  const [generated, original, hub, states, papers, versions, sets, tasks, banks] = await Promise.all([
    practiceHistory(courseId), originalPracticeHistory(courseId), practiceHubSummary(courseId, 'mistakes'), readQuestionStates(courseId),
    db.examRecord.findMany({ where: { material: { courseId } } }), db.version.findMany({ where: { courseId }, select: { id: true, sourceIds: true } }),
    db.practiceSet.findMany({ where: { courseId }, select: { id: true, versionId: true, questions: true } }),
    db.dailyPracticeTask.findMany({ where: { courseId }, select: { content: true } }), listQuestionBanks(courseId, true),
  ]);
  // Re-read after collecting snapshots: an exam can have started while they were loading.
  const protection = await readExamProtection(courseId);
  const hiddenMaterials = new Set(protection.withheldMaterials);
  const hiddenVersions = new Set([...protection.withheldVersions, ...versions.filter(version => (JSON.parse(version.sourceIds) as string[]).some(id => hiddenMaterials.has(id))).map(version => version.id)]);
  const catalog = new Map(hub.catalog.map(question => [question.key, question]));
  const currentOriginals = new Map(banks.filter(bank => !bank.stale).flatMap(bank => bank.questions.map(question => [question.id, question] as const)));
  const generatedSets = sets.map(set => ({ ...set, questions: JSON.parse(set.questions) as Question[] }));
  const dailyGroups = tasks.flatMap(task => (JSON.parse(task.content) as { groups: DailyGroup[] }).groups);
  const judgments: LearningJudgment[] = [], records: LearningRecord[] = [];
  const historyLocation = (section: 'knowledge' | 'papers'): PracticeLocation => ({ section, activity: 'history' });

  for (const entry of generated.entries) {
    const saved = entry.session;
    if (!saved || entry.withheld || hiddenVersions.has(entry.version.id) || saved.state.mode === 'exam' && !saved.state.submitted) continue;
    const recordId = `generated:${saved.id}:${saved.state.roundId ?? 'legacy'}`;
    const location = historyLocation('knowledge');
    const dailyGroup = dailyGroups.find(group => group.engine === 'generated' && group.scope === saved.id);
    const set = generatedSets.find(set => set.versionId === entry.version.id && (
      entry.snapshot === 'saved' && !entry.archived && set.id === entry.id ||
      hashContent(JSON.stringify([set.versionId, set.id, set.questions])) === saved.id ||
      dailyGroup?.refs.length && dailyGroup.refs.every(ref => ref.setId === set.id && ref.versionId === set.versionId)
    ));
    const sourceRecordId = entry.archived ? entry.id : saved.id;
    records.push({ id: recordId, sourceRecordId, title: entry.version.title, at: saved.updatedAt, finished: saved.state.finished || saved.state.submitted || !!entry.archived, location, engine: 'generated', roundId: saved.state.roundId });
    for (const attempt of saved.state.attempts) {
      const setQuestion = set?.questions.find(question => question.id === attempt.id);
      const question = entry.questions.find(question => question.id === attempt.id) ?? setQuestion;
      const ref: QuestionRef = { engine: 'generated', questionId: attempt.id, versionId: entry.version.id, ...(set ? { setId: set.id } : {}) };
      if (question && hiddenMaterials.has(question.reference.materialId)) continue;
      judgments.push({
        id: JSON.stringify(['generated', saved.id, attempt.id, attempt.at, attempt.correct]), questionKey: !set && entry.snapshot !== 'reconstructed' ? JSON.stringify([questionRefKey(ref), saved.id]) : questionRefKey(ref), recordId, sourceRecordId, sourceMaterialId: question?.reference.materialId, roundId: saved.state.roundId, ref,
        title: question?.prompt ?? '已保存题目（缺少题干快照）', sourceName: question?.reference.name ?? entry.version.title,
        topics: question?.topic ? [question.topic] : [], origin: set ? 'ai' : entry.snapshot === 'reconstructed' ? 'original' : 'unknown',
        at: attempt.at, correct: attempt.correct, timeSource: 'judged', available: !!catalog.get(questionRefKey(ref))?.available && (set ? isDeepStrictEqual(question, setQuestion) : entry.snapshot === 'reconstructed'), location,
      });
    }
  }

  const explicitSignatures = new Set<string>(), legacy = new Map<string, LearningJudgment>();
  for (const entry of original.entries) {
    const session = entry.session as OriginalSessionState, questions = entry.questions as OriginalQuestion[];
    if (session.mode === 'memorize' || session.mode === 'exam' && !session.submitted || questions.some(question => hiddenMaterials.has(question.materialId))) continue;
    const recordId = `original:${session.roundId}`, location = historyLocation(entry.context === 'paper' ? 'papers' : 'knowledge');
    const material = hub.materials.find(material => material.id === questions[0]?.materialId);
    records.push({ id: recordId, sourceRecordId: entry.id, title: material?.name ?? questions[0]?.sources[0]?.name ?? '原题历史记录', at: entry.at, finished: session.finished || session.submitted || !!hub.records.find(record => record.engine === 'original' && record.id === entry.id)?.finished, location, engine: 'original', roundId: session.roundId });
    for (const question of questions) {
      const result = session.results[question.id];
      if (result?.correct !== true && result?.correct !== false) continue;
      const ref: QuestionRef = { engine: 'original', questionId: question.id, materialId: question.materialId };
      const at = result.judgedAt ?? entry.at;
      const current = currentOriginals.get(question.id);
      const compatible = !!current && !current.knowledgeSourceStale && originalQuestionShape(current) === originalQuestionShape(question) && (!question.answer.trim() || current.answer === question.answer && current.answerSource === question.answerSource);
      const signature = hashContent(JSON.stringify([session.roundId, originalQuestionShape(question), question.answer, result.answer, result.correct, result.source]));
      const item: LearningJudgment = {
        id: result.judgedAt ? JSON.stringify(['original', session.roundId, question.id, at, result.correct]) : `original:legacy:${signature}`, questionKey: questionRefKey(ref), recordId, sourceRecordId: entry.id, sourceMaterialId: question.materialId, roundId: session.roundId, ref,
        title: question.prompt, sourceName: hub.materials.find(material => material.id === question.materialId)?.name ?? question.sources[0]?.name ?? '来源已移除', topics: question.topics,
        origin: question.origin === 'variant' ? 'ai' : 'original', at, correct: result.correct, timeSource: result.judgedAt ? 'judged' : 'saved',
        available: !!catalog.get(questionRefKey(ref))?.available && compatible, location,
      };
      if (result.judgedAt) {
        judgments.push(item);
        if (Number.isFinite(Date.parse(at)) && Date.parse(at) <= now.getTime()) explicitSignatures.add(signature);
      } else if (Number.isFinite(Date.parse(at)) && (!legacy.has(signature) || Date.parse(at) < Date.parse(legacy.get(signature)!.at))) legacy.set(signature, item);
    }
  }
  for (const [signature, item] of legacy) if (!explicitSignatures.has(signature)) judgments.push(item);

  for (const row of papers) {
    if (hiddenMaterials.has(row.materialId)) continue;
    const saved = JSON.parse(row.content) as ExamRecord, material = hub.materials.find(material => material.id === row.materialId);
    const recordId = `pdf:${row.materialId}`, location = historyLocation('papers');
    records.push({ id: recordId, sourceRecordId: row.materialId, title: material?.name ?? '原卷历史记录', at: row.updatedAt.toISOString(), finished: hub.records.find(record => record.engine === 'pdf' && record.materialId === row.materialId)?.finished ?? false, location, engine: 'pdf' });
    for (const [number, mark] of Object.entries(saved.marks)) {
      if (mark !== 'correct' && mark !== 'wrong') continue;
      const ref: QuestionRef = { engine: 'pdf', questionId: number, materialId: row.materialId };
      const at = saved.markedAt?.[number] ?? row.updatedAt.toISOString();
      judgments.push({ id: JSON.stringify(['pdf', row.materialId, number, at, mark]), questionKey: questionRefKey(ref), recordId, sourceRecordId: row.materialId, sourceMaterialId: row.materialId, ref,
        title: `原卷第 ${number} 题`, sourceName: material?.name ?? '原卷历史记录', topics: [], origin: 'pdf', at, correct: mark === 'correct', timeSource: saved.markedAt?.[number] ? 'judged' : 'saved', available: !!material?.available, location });
    }
  }
  // Resource counts use the same records as the course workspace, including excluded materials.
  const materialCount = await db.material.count({ where: { courseId } });
  return analyzeLearning({ courseId, courseName: hub.courseName, judgments, records, states, materialCount, versionCount: versions.length, withheld: hiddenMaterials.size > 0 || hiddenVersions.size > 0 }, period, now);
}
