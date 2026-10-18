import { z } from 'zod';
import { db } from './db';
import { deepSeekConfig } from './deepseek';
import { hashContent } from './generation';
import { listQuestionBanks } from './question-bank-store';
import { loadOriginalSession, resumeOriginalSession } from './original-practice-store';
import { practiceContext } from './practice-store';
import { notebookFromVersion, sourceBlocks, type NotebookDocument, type NotebookOrigin, type RichNode } from './notebook';
import { publicVersion } from './server';
import { beijingDay, questionRefKey, selectDailyQuestions, studyStatus, type DailyGroup, type DailyTask, type HubRecord, type PracticeArea, type PracticeHubSummary, type QuestionRef, type QuestionStudyState, type StudyAttempt, type StudyQuestion } from './practice-hub';
import type { OriginalQuestion, OriginalSessionState } from './question-bank-types';
import type { Question } from './practice';
import type { PracticeSession } from './practice-session';
import { blankSession } from './practice-session';
import type { ExamRecord } from './exam-record';
import { examProtection } from './exam-protection';

export const practiceAreaSchema = z.enum(['knowledge', 'mistakes', 'papers']);
export const questionRefSchema = z.object({ engine: z.enum(['original', 'generated', 'pdf']), questionId: z.string().min(1).max(300), materialId: z.string().min(1).max(100).optional(), versionId: z.string().min(1).max(100).optional(), setId: z.string().min(1).max(100).optional() });
export const stateChangeSchema = z.object({ favorite: z.boolean().optional(), manualWrong: z.boolean().optional(), tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(), note: z.string().max(8000).optional(), consolidated: z.boolean().optional() }).refine(value => Object.keys(value).length > 0);
const publicState = (row: { ref: string; refKey: string; revision: number; favorite: boolean; manualWrong: boolean; tags: string; note: string; consolidatedAt: Date | null }): QuestionStudyState => ({ ref: JSON.parse(row.ref), key: row.refKey, revision: row.revision, favorite: row.favorite, manualWrong: row.manualWrong, tags: JSON.parse(row.tags), note: row.note, consolidatedAt: row.consolidatedAt?.toISOString() ?? null });
export async function readQuestionStates(courseId: string) {
  if (!await db.course.findUnique({ where: { id: courseId } })) throw Error('课程不存在。');
  return (await db.practiceQuestionState.findMany({ where: { courseId } })).map(publicState);
}
const reviewed = (node: RichNode): boolean => node.type === 'sourceBlock' && (node.attrs?.origin as { needsReview?: boolean } | undefined)?.needsReview === true || !!node.content?.some(reviewed);

export async function practiceHubSummary(courseId: string, section: PracticeArea, now = new Date()): Promise<PracticeHubSummary> {
  const [course, materials, notebook, versions, sets, generatedSessions, generatedRounds, originalSessions, originalRounds, states, paperRecords, tasks] = await Promise.all([
    db.course.findUnique({ where: { id: courseId } }), db.material.findMany({ where: { courseId }, orderBy: { createdAt: 'asc' } }),
    db.notebook.findUnique({ where: { courseId } }), db.version.findMany({ where: { courseId }, orderBy: { number: 'desc' } }),
    db.practiceSet.findMany({ where: { courseId }, orderBy: { createdAt: 'desc' } }), db.practiceSession.findMany({ where: { courseId }, orderBy: { updatedAt: 'desc' } }),
    db.practiceRound.findMany({ where: { courseId }, orderBy: { createdAt: 'desc' } }), db.originalPracticeSession.findMany({ where: { courseId }, orderBy: { updatedAt: 'desc' } }),
    db.originalPracticeRound.findMany({ where: { courseId }, orderBy: { createdAt: 'desc' } }), db.practiceQuestionState.findMany({ where: { courseId } }),
    db.examRecord.findMany({ where: { material: { courseId } } }), db.dailyPracticeTask.findMany({ where: { courseId } }),
  ]);
  if (!course) throw Error('课程不存在。');
  const banks = await listQuestionBanks(courseId, true), materialMap = new Map(materials.map(m => [m.id, m]));
  const stateMap = new Map(states.map(row => [row.refKey, publicState(row)]));
  const adoptedAreas = new Map(banks.flatMap(bank => bank.questions.filter(question => question.practiceArea).map(question => [questionRefKey({ engine: 'original', questionId: question.id, materialId: question.materialId }),question.practiceArea!] as const)));
  const catalog = new Map<string, StudyQuestion>(), attempts = new Map<string, StudyAttempt>(), records: HubRecord[] = [];
  const put = (ref: QuestionRef, info: Omit<StudyQuestion, 'ref' | 'key' | 'favorite' | 'manualWrong' | 'mistake' | 'consolidated' | 'tags' | 'note'>, replace = false) => {
    const key = questionRefKey(ref);
    if (!catalog.has(key) || replace) catalog.set(key, { ref, key, ...info, favorite: false, manualWrong: false, mistake: false, consolidated: false, tags: [], note: '' });
  };
  const attempt = (ref: QuestionRef, value: StudyAttempt, area: 'knowledge' | 'papers') => {
    const key = questionRefKey(ref);
    if ((attempts.get(key)?.at ?? '') < value.at) { attempts.set(key, value); const item = catalog.get(key); if (item) item.section = adoptedAreas.get(key) ?? area; }
  };
  function original(q: OriginalQuestion, available: boolean, source = '') {
    const material = materialMap.get(q.materialId);
    available = available && q.practiceReview !== 'pending' && !q.knowledgeSourceStale;
    put({ engine: 'original', questionId: q.id, materialId: q.materialId }, { prompt: q.prompt, topic: q.topics.join(' · ') || q.section || '未归类', sourceName: material?.name ?? q.sources[0]?.name ?? '原题快照', number: q.number, section: q.practiceArea??(material?.chapter === '历年套卷' ? 'papers' : 'knowledge'), origin: q.origin === 'variant' ? 'ai' : 'original', available, sourceHash: hashContent(JSON.stringify([q, source])), collected: !!q.practiceArea, needsAnswer: !q.answer.trim() || !q.explanation.trim(), needsReview: q.practiceReview === 'pending' });
  }
  for (const bank of banks) for (const q of bank.questions) original(q, !bank.stale, bank.sourceHash);
  for (const row of [...originalSessions.map(r => ({ ...r, at: r.updatedAt, archived: false })), ...originalRounds.map(r => ({ ...r, context: originalSessions.find(s => s.id === r.sessionId)?.context ?? 'knowledge', at: r.createdAt, archived: true }))]) {
    const { questions, session } = JSON.parse(row.content) as { questions: OriginalQuestion[]; session: OriginalSessionState };
    const area = row.context === 'paper' ? 'papers' : 'knowledge';
    records.push({ id: row.id, engine: 'original', title: materialMap.get(questions[0]?.materialId)?.name ?? '原题练习', at: row.at.toISOString(), section: area, total: session.ids.length, answered: Object.values(session.answers).filter(a => a.trim()).length, finished: session.finished || session.submitted || row.archived, materialId: questions[0]?.materialId });
    for (const q of questions) {
      original(q, false);
      if (session.mode === 'memorize' || session.mode === 'exam' && !session.submitted) continue;
      const result = session.results[q.id];
      if (result?.correct !== undefined && result.correct !== null) attempt({ engine: 'original', questionId: q.id, materialId: q.materialId }, { correct: result.correct, at: result.judgedAt ?? row.at.toISOString() }, area);
    }
  }
  const setQuestions = sets.map(set => ({ ...set, questions: JSON.parse(set.questions) as Question[] }));
  for (const set of setQuestions) for (const q of set.questions) put({ engine: 'generated', questionId: q.id, versionId: set.versionId, setId: set.id }, { prompt: q.prompt, topic: q.topic, sourceName: q.reference.name, sourceMaterialId: q.reference.materialId, section: 'knowledge', origin: 'ai', available: false });
  if (versions[0]) {
    const { data } = await practiceContext(courseId, versions[0].id);
    for (const q of data.questions) put({ engine: 'generated', questionId: q.id, versionId: versions[0].id, ...(data.set ? { setId: data.set.id } : {}) }, { prompt: q.prompt, topic: q.topic, sourceName: q.reference.name, sourceMaterialId: q.reference.materialId, section: 'knowledge', origin: data.set ? 'ai' : 'original', available: true, sourceHash: hashContent(JSON.stringify(q)) }, true);
  }
  for (const row of [...generatedSessions.map(r => ({ ...r, at: r.updatedAt, archived: false })), ...generatedRounds.map(r => ({ ...r, id: r.scope, at: r.createdAt, archived: true }))]) {
    const session = JSON.parse(row.content) as PracticeSession;
    const set = setQuestions.find(s => s.versionId === row.versionId && session.ids.every(id => s.questions.some(q => q.id === id)));
    const taskId = tasks.find(task => (JSON.parse(task.content).groups as DailyGroup[]).some(group => group.scope === row.id))?.id;
    records.push({ id: row.id, engine: 'generated', title: versions.find(v => v.id === row.versionId)?.title ?? '知识点练习', at: row.at.toISOString(), section: 'knowledge', total: session.ids.length, answered: Object.values(session.answers).filter(a => a.trim()).length, finished: session.finished || session.submitted || row.archived, versionId: row.versionId, setId: set?.id, ...(taskId ? { taskId } : {}) });
    if (session.mode === 'exam' && !session.submitted) continue;
    for (const a of session.attempts) attempt({ engine: 'generated', questionId: a.id, versionId: row.versionId, ...(set ? { setId: set.id } : {}) }, a, 'knowledge');
  }
  for (const row of paperRecords) {
    const record = JSON.parse(row.content) as ExamRecord;
    records.push({ id: row.materialId, engine: 'pdf', title: materialMap.get(row.materialId)?.name ?? '原卷记录', at: row.updatedAt.toISOString(), section: 'papers', total: 23, answered: Object.values(record.answers).filter(a => a.trim()).length, finished: Object.keys(record.marks).length === 23, materialId: row.materialId });
    for (const number of new Set([...Object.keys(record.answers), ...Object.keys(record.marks), ...states.filter(s => (JSON.parse(s.ref) as QuestionRef).materialId === row.materialId).map(s => (JSON.parse(s.ref) as QuestionRef).questionId)])) {
      const ref: QuestionRef = { engine: 'pdf', questionId: number, materialId: row.materialId }, material = materialMap.get(row.materialId);
      put(ref, { prompt: `原卷第 ${number} 题`, number, topic: '原卷题号', sourceName: material?.name ?? '原卷记录', section: 'papers', origin: 'pdf', available: !!material && !material.excluded && material.status !== 'review' && !material.conflictResolution, sourceHash: material?.hash });
      if (record.marks[number]) attempt(ref, { correct: record.marks[number] === 'correct', at: record.markedAt?.[number] ?? row.updatedAt.toISOString() }, 'papers');
    }
  }
  for (const state of stateMap.values()) if (state.ref.engine === 'pdf' && !catalog.has(state.key)) {
    const material = materialMap.get(state.ref.materialId!);
    put(state.ref, { prompt: `原卷第 ${state.ref.questionId} 题`, number: state.ref.questionId, topic: '原卷题号', sourceName: material?.name ?? '已移除原卷', section: 'papers', origin: 'pdf', available: !!material && !material.excluded && !material.conflictResolution, sourceHash: material?.hash });
  }
  const questions = [...catalog.values()].map(q => ({ ...q, ...studyStatus(stateMap.get(q.key), attempts.get(q.key), now.toISOString()), revision: stateMap.get(q.key)?.revision }));
  const document: NotebookDocument = notebook ? JSON.parse(notebook.content) : versions[0] ? notebookFromVersion(publicVersion(versions[0])) : { pages: [], chapters: [], inbox: [], trash: [] };
  const knowledge = document.pages.map(page => ({ id: page.id, title: page.title, chapter: document.chapters.find(c => c.id === page.chapterId)?.title ?? '未分章', needsReview: reviewed(page.doc), materialIds: [...new Set(sourceBlocks(page.doc).flatMap(block => (block.attrs?.origin as NotebookOrigin | undefined)?.refs.map(ref => ref.materialId) ?? []))] }));
  const shelf = materials.filter(m => !m.excluded).map(m => {
    const bank = banks.find(b => b.materialId === m.id), latest = records.filter(r => r.materialId === m.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    return { id: m.id, name: m.name, mime: m.mime, chapter: m.chapter, status: m.status, available: m.status !== 'review' && !m.conflictResolution, questions: bank?.questions.filter(q => q.origin === 'original').length ?? 0, year: m.name.match(/20\d{2}/)?.[0] ?? '', answered: latest?.answered ?? 0, finished: latest?.finished ?? false, stale: !!bank?.stale, sourceHash: m.hash, paper:m.chapter==='历年套卷'||!!bank?.questions.some(q=>q.practiceArea==='papers') };
  });
  const papers = shelf.filter(m => m.paper && m.available);
  const recommendation = [...papers].sort((a, b) => Number(a.finished) - Number(b.finished) || Number(b.answered > 0) - Number(a.answered > 0))[0]?.id ?? null;
  const row = tasks.find(t => t.section === section && t.day === beijingDay(now));
  const daily = row ? await publicTask(row) : null;
  const { withheldMaterials, withheldVersions } = examProtection(originalSessions, generatedSessions, versions);
  return { courseId, courseName: course.name, section, day: beijingDay(now), configured: deepSeekConfig().configured, materials: shelf, knowledge, catalog: questions, records: records.sort((a, b) => b.at.localeCompare(a.at)), daily, dailyCount: section === 'papers' ? Number(!!recommendation) : selectDailyQuestions(questions, section, now).length, recommendation, withheldMaterials, withheldVersions };
}

export async function changeQuestionStates(courseId: string, refs: QuestionRef[], changes: z.infer<typeof stateChangeSchema>, revision?: number) {
  const summary = await practiceHubSummary(courseId, 'mistakes'), available = new Map(summary.catalog.map(q => [q.key, q]));
  for (const ref of refs) {
    const item = available.get(questionRefKey(ref));
    if (!item && !(ref.engine === 'pdf' && /^[1-9]$|^1\d$|^2[0-3]$/.test(ref.questionId) && summary.materials.some(m => m.id === ref.materialId && m.chapter === '历年套卷'))) throw Error('题目不属于本课程或来源已移除，请刷新后重试。');
    if (changes.manualWrong && item?.available === false) throw Error('资料来源已更新，请重新读取并核对后加入错题集。');
  }
  const data = { ...(changes.favorite !== undefined ? { favorite: changes.favorite } : {}), ...(changes.manualWrong !== undefined ? { manualWrong: changes.manualWrong, ...(changes.manualWrong ? { consolidatedAt: null } : {}) } : {}), ...(changes.tags ? { tags: JSON.stringify([...new Set(changes.tags)]) } : {}), ...(changes.note !== undefined ? { note: changes.note } : {}), ...(changes.consolidated !== undefined ? { consolidatedAt: changes.consolidated ? new Date() : null } : {}) };
  await db.$transaction(async tx => {
    for (const ref of refs) {
      const refKey = questionRefKey(ref), existing = await tx.practiceQuestionState.findUnique({ where: { courseId_refKey: { courseId, refKey } } });
      if (revision !== undefined && revision !== (existing?.revision ?? 0)) throw Error('另一页面已更新收藏或笔记，请刷新后再保存；当前文字仍保留。');
      if (existing) await tx.practiceQuestionState.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } });
      else await tx.practiceQuestionState.create({ data: { courseId, refKey, ref: JSON.stringify(ref), ...data } });
    }
  });
  return readQuestionStates(courseId);
}

async function publicTask(row: { id: string; courseId: string; section: string; day: string; content: string; createdAt: Date }): Promise<DailyTask> {
  const { groups } = JSON.parse(row.content) as { groups: DailyGroup[] };
  const enriched = await Promise.all(groups.map(async group => {
    if (group.engine === 'pdf') {
      const saved = await db.examRecord.findUnique({ where: { materialId: group.materialId! } }), record = saved ? JSON.parse(saved.content) as ExamRecord : null;
      const markedDuringTask = (id: string) => !!record?.marks[id] && (record.markedAt?.[id] ?? '') >= row.createdAt.toISOString();
      return { ...group, finished: !!record && (group.refs.length ? group.refs.every(ref => markedDuringTask(ref.questionId)) : Object.keys(record.marks).length === 23 && Object.keys(record.marks).some(markedDuringTask)) };
    }
    if (!group.scope) return group;
    const session = group.engine === 'original' ? await db.originalPracticeSession.findFirst({ where: { id: group.scope, courseId: row.courseId } }) : await db.practiceSession.findFirst({ where: { id: group.scope, courseId: row.courseId } });
    const state = session ? JSON.parse(session.content) : null;
    return { ...group, finished: !!(group.engine === 'original' ? state?.session.finished || state?.session.submitted : state?.finished || state?.submitted) };
  }));
  return { id: row.id, courseId: row.courseId, section: row.section as PracticeArea, day: row.day, groups: enriched, createdAt: row.createdAt.toISOString() };
}
export async function readDailyTask(courseId: string, taskId: string) { const row = await db.dailyPracticeTask.findFirst({ where: { id: taskId, courseId } }); if (!row) throw Error('这条每日任务不属于当前课程，请回到主页安排练习。'); return publicTask(row); }
export async function createDailyTask(courseId: string, section: PracticeArea, now = new Date()) {
  const day = beijingDay(now), existing = await db.dailyPracticeTask.findUnique({ where: { courseId_section_day: { courseId, section, day } } });
  if (existing) return publicTask(existing);
  const summary = await practiceHubSummary(courseId, section, now), groups: DailyGroup[] = [];
  if (section === 'papers') {
    const paper = summary.materials.find(m => m.id === summary.recommendation);
    if (paper) {
      const questions = summary.catalog.filter(q => q.ref.materialId === paper.id && q.ref.engine === 'original' && q.origin === 'original' && q.available);
      if (!questions.length && paper.mime !== 'application/pdf' && !/\.pdf$/i.test(paper.name)) throw Error('这份原卷尚未读取完整原题，请在「导入 / 选择套卷」中读取并核对后安排今日练习。');
      const unfinished = questions.length ? (await db.originalPracticeSession.findMany({ where: { courseId, context: 'paper' }, orderBy: { updatedAt: 'desc' } })).find(row => { const saved = JSON.parse(row.content) as { session: OriginalSessionState }; return !saved.session.finished && !saved.session.submitted && JSON.stringify(saved.session.ids) === JSON.stringify(questions.map(q => q.ref.questionId)); }) : undefined;
      groups.push({ id: 'paper', engine: questions.length ? 'original' : 'pdf', refs: questions.map(q => q.ref), title: paper.name, materialId: paper.id, context: 'paper', ...(unfinished ? { scope: unfinished.id, roundId: JSON.parse(unfinished.content).session.roundId } : {}) });
    }
  } else for (const question of selectDailyQuestions(summary.catalog, section, now)) {
    const key = question.ref.engine + ':' + (question.ref.engine === 'generated' ? question.ref.versionId + ':' + question.ref.setId : question.ref.engine === 'pdf' ? question.ref.materialId : 'original');
    let group = groups.find(g => g.id === key);
    if (!group) { group = { id: key, engine: question.ref.engine, refs: [], title: question.ref.engine === 'original' ? '原题巩固' : question.ref.engine === 'generated' ? '知识点题组' : question.sourceName, context: 'knowledge', ...(question.ref.versionId ? { versionId: question.ref.versionId } : {}), ...(question.ref.engine === 'pdf' ? { materialId: question.ref.materialId } : {}) }; groups.push(group); }
    group.refs.push(question.ref);
  }
  if (!groups.length) throw Error(section === 'papers' ? '还没有可推荐的原卷，请先导入或选择套卷。' : '今天没有到期题或未练题，请先准备资料，或到专项练习选择题目。');
  for (const group of groups) group.sourceHash = dailySourceHash(group, summary);
  const row = await db.dailyPracticeTask.upsert({ where: { courseId_section_day: { courseId, section, day } }, create: { courseId, section, day, content: JSON.stringify({ groups }) }, update: {} });
  return publicTask(row);
}
export async function startDailyGroup(courseId: string, taskId: string, groupId: string) {
  const task = await readDailyTask(courseId, taskId), group = task.groups.find(g => g.id === groupId);
  if (!group) throw Error('每日题组不存在，请重新打开今日任务。');
  const summary = await practiceHubSummary(courseId, task.section), available = new Map(summary.catalog.map(q => [q.key, q]));
  if (group.refs.some(ref => !available.get(questionRefKey(ref))?.available) || group.engine === 'pdf' && !summary.materials.some(m => m.id === group.materialId && m.available) || group.sourceHash && group.sourceHash !== dailySourceHash(group, summary)) throw Error('每日任务的资料已更新，原任务与答案保留；请重新核对资料后进行专项练习。');
  if (group.engine === 'pdf') return { task, group };
  const data = group.engine === 'original' ? group.scope ? await resumeOriginalSession(courseId, group.scope) : await loadOriginalSession(courseId, group.context, group.refs.map(ref => ref.questionId), group.context === 'paper' ? 'exam' : 'practice', false, `${taskId}:${group.id}`) : (await practiceContext(courseId, group.versionId!, db, taskId)).data;
  if (group.engine === 'generated') {
    const record = await db.practiceSession.upsert({ where: { id: data.scope }, create: { id: data.scope, courseId, versionId: group.versionId!, content: JSON.stringify({ ...blankSession(), roundId: crypto.randomUUID(), ids: group.refs.map(ref => ref.questionId), snapshotQuestions: data.questions }) }, update: {} });
    Object.assign(data, { session: JSON.parse(record.content), revision: record.revision });
  }
  const roundId = group.engine === 'original' ? (data as { session: OriginalSessionState }).session.roundId : undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.dailyPracticeTask.findFirstOrThrow({ where: { id: taskId, courseId } }), content = JSON.parse(row.content) as { groups: DailyGroup[] };
    const index = content.groups.findIndex(g => g.id === groupId);
    content.groups[index] = { ...content.groups[index], scope: data.scope, ...(roundId ? { roundId } : {}) };
    const updated = await db.dailyPracticeTask.updateMany({ where: { id: taskId, courseId, content: row.content }, data: { content: JSON.stringify(content) } });
    if (updated.count) return { task: await readDailyTask(courseId, taskId), group: content.groups[index], data };
  }
  throw Error('另一页面正在更新今日任务，答案已保存，请重新打开今日任务。');
}

function dailySourceHash(group: DailyGroup, summary: PracticeHubSummary) { return hashContent(JSON.stringify(group.engine === 'pdf' ? summary.materials.find(m => m.id === group.materialId)?.sourceHash : group.refs.map(ref => summary.catalog.find(q => q.key === questionRefKey(ref))?.sourceHash))); }
