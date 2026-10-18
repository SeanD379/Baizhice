import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
vi.mock('./db', async () => {
  const { PrismaClient } = await import('@prisma/client'), fs = await import('node:fs/promises'), path = await import('node:path');
  await fs.mkdir(path.resolve('tmp'), { recursive: true });
  const dataDir = await fs.mkdtemp(path.resolve('tmp/practice-hub-api-'));
  return { dataDir, db: new PrismaClient({ datasources: { db: { url: `file:${path.join(dataDir, 'test.db').replaceAll('\\', '/')}` } } }) };
});
import { db, dataDir } from './db';
import { prepareQuestionBanks } from './question-bank-store';
import { GET as summaryGET } from '../app/api/practice-hub/route';
import { GET as statesGET, PATCH as statesPATCH } from '../app/api/practice-state/route';
import { POST as dailyPOST } from '../app/api/practice-daily/route';
import { loadOriginalSession } from './original-practice-store';
import { createDailyTask, practiceHubSummary, readDailyTask, startDailyGroup } from './practice-hub-store';
import { blankSession } from './practice-session';
import { questionRefKey } from './practice-hub';
import type { PracticeHubSummary, DailyTask, QuestionRef } from './practice-hub';
import type { OriginalSessionData, OriginalQuestion } from './question-bank-types';
const base = 'http://127.0.0.1:4173';
const request = (url: string, body?: object, method = 'POST') => new Request(base + url, body ? { method, headers: { 'content-type': 'application/json', host: '127.0.0.1:4173', origin: base }, body: JSON.stringify(body) } : undefined);
let refs: QuestionRef[];
beforeAll(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: { ...process.env, DATABASE_URL: `file:${path.join(dataDir, 'test.db').replaceAll('\\', '/')}` }, stdio: 'pipe' });
  await db.course.createMany({ data: [{ id: 'course', name: '测试语文' }, { id: 'other', name: '其他课程' }, { id: 'empty', name: '空课程' }] });
  await db.material.create({ data: { id: 'material', courseId: 'course', name: '阅读练习.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 12, hash: 'original', filePath: 'unused', origin: 'test', status: 'extracted' } });
  const text = Array.from({ length: 7 }, (_, i) => `${i + 1}、请选择正确答案。\nA. 甲\nB. 乙\n答案：A`).join('\n\n');
  await mkdir(path.join(dataDir, 'extractions'));
  await writeFile(path.join(dataDir, 'extractions/material.json'), JSON.stringify({ state: 'complete', pageCount: 1, sourceCount: 1, continuation: { startSource: 1, hasMore: false }, durationMs: 1, updatedAt: 'test', pages: [{ page: 1, text, method: 'docx-text', state: 'extracted', warnings: [] }] }));
  const [bank] = await prepareQuestionBanks('course', ['material']);
  refs = bank.questions.map(q => ({ engine: 'original', questionId: q.id, materialId: q.materialId }));
  expect(refs.length).toBe(7);
});
afterAll(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
it('shows an explicit paper destination in its catalog and paper shelf without changing material chapters',async()=>{
  const row=await db.originalQuestionBank.findFirstOrThrow(),content=JSON.parse(row.content),chapter=(await db.material.findUniqueOrThrow({where:{id:'material'}})).chapter;
  try{await db.originalQuestionBank.update({where:{id:row.id},data:{content:JSON.stringify({...content,questions:content.questions.map((question:OriginalQuestion)=>({...question,practiceArea:'papers'}))})}});
    const summary=await practiceHubSummary('course','papers');expect(summary.catalog.find(question=>question.key===questionRefKey(refs[0]))?.section).toBe('papers');
    expect(summary.materials.find(material=>material.id==='material')?.paper).toBe(true);expect(summary.recommendation).toBe('material');
    expect((await db.material.findUniqueOrThrow({where:{id:'material'}})).chapter).toBe(chapter);
  }finally{await db.originalQuestionBank.update({where:{id:row.id},data:{content:row.content}});}
});

it('reads all homes without creating rounds, tasks, banks, or repairing an interrupted AI job', async () => {
  await db.originalQuestionBank.updateMany({ data: { content: JSON.stringify({ name: '阅读练习.docx', state: 'processing', questions: (await prepareQuestionBanks('course', ['material']))[0].questions, progress: { done: 0, total: 7 } }) } });
  for (const section of ['knowledge', 'mistakes', 'papers']) {
    const response = await summaryGET(request(`/api/practice-hub?courseId=course&section=${section}`));
    expect(response.status).toBe(200);
    const result = await response.json() as PracticeHubSummary;
    expect(result.courseName).toBe('测试语文');
    expect(JSON.stringify(result)).not.toContain('"answer":');
    expect(JSON.stringify(result)).not.toContain('"explanation":');
  }
  expect(await db.originalPracticeSession.count()).toBe(0);
  expect(await db.practiceSession.count()).toBe(0);
  expect(await db.dailyPracticeTask.count()).toBe(0);
  expect(await db.originalQuestionBank.count()).toBe(1);
  expect(JSON.parse((await db.originalQuestionBank.findFirstOrThrow()).content).state).toBe('processing');
});

it('persists favorite, imported mistake, tags and review note and rejects cross-course references', async () => {
  const response = await statesPATCH(request('/api/practice-state', { courseId: 'course', refs: [refs[0]], changes: { favorite: true, manualWrong: true, tags: ['阅读'], note: '先读问题再找出处' } }, 'PATCH'));
  expect(response.status).toBe(200);
  const saved = await (await statesGET(request('/api/practice-state?courseId=course'))).json();
  expect(saved.states[0]).toMatchObject({ favorite: true, manualWrong: true, tags: ['阅读'], note: '先读问题再找出处' });
  const wrongCourse = await statesPATCH(request('/api/practice-state', { courseId: 'other', refs: [refs[0]], changes: { favorite: true } }, 'PATCH'));
  expect(wrongCourse.status).toBe(400);
  expect(await db.practiceQuestionState.count({ where: { courseId: 'other' } })).toBe(0);
});

it('keeps one five-question task per day and resumes its own round after saving an answer', async () => {
  const create = () => dailyPOST(request('/api/practice-daily', { action: 'create', courseId: 'course', section: 'knowledge' }));
  const response = await create(); expect(response.status).toBe(200);
  const task = await response.json() as DailyTask;
  expect(task.groups.flatMap(g => g.refs)).toHaveLength(5);
  const again = await (await create()).json() as DailyTask;
  expect(again.id).toBe(task.id);
  expect(await db.originalPracticeSession.count()).toBe(0);
  const start = () => dailyPOST(request('/api/practice-daily', { action: 'start', courseId: 'course', taskId: task.id, groupId: task.groups[0].id }));
  const first = await (await start()).json() as { data: OriginalSessionData };
  expect(first.data.session.ids).toHaveLength(5);
  const content = { questions: first.data.questions, session: { ...first.data.session, answers: { [first.data.session.ids[0]]: '甲' } } };
  await db.originalPracticeSession.update({ where: { id: first.data.scope }, data: { content: JSON.stringify(content) } });
  const resumed = await (await start()).json() as { data: OriginalSessionData };
  expect(resumed.data.scope).toBe(first.data.scope);
  expect(resumed.data.session.roundId).toBe(first.data.session.roundId);
  expect(resumed.data.session.answers[first.data.session.ids[0]]).toBe('甲');
  expect(await db.originalPracticeSession.count()).toBe(1);
});

it('withholds original answers from the moment an exam starts, even with no answers yet', async () => {
  const exam = await loadOriginalSession('course', 'paper', refs.map(ref => ref.questionId), 'exam');
  expect((await practiceHubSummary('course', 'papers')).withheldMaterials).toContain('material');
  await db.originalPracticeSession.delete({ where: { id: exam.scope } });
});

it('counts PDF due review only after each selected question is marked again during this task', async () => {
  await db.course.create({ data: { id: 'pdf-course', name: '原卷复习' } });
  await db.material.create({ data: { id: 'pdf', courseId: 'pdf-course', name: '2026 原卷.pdf', mime: 'application/pdf', size: 12, hash: 'pdf-hash', filePath: 'unused', origin: 'test', chapter: '历年套卷', status: 'ready' } });
  const record = { answers: { '1': '旧作答' }, marks: { '1': 'wrong' }, markedAt: { '1': '2026-10-01T00:00:00Z' }, annotations: {} };
  await db.examRecord.create({ data: { materialId: 'pdf', content: JSON.stringify(record), updatedAt: new Date('2026-10-01T00:00:00Z') } });
  const task = await createDailyTask('pdf-course', 'mistakes', new Date('2026-10-02T00:00:00Z'));
  expect(task.groups[0].finished).toBe(false);
  await db.examRecord.update({ where: { materialId: 'pdf' }, data: { content: JSON.stringify({ ...record, marks: { '1': 'correct' }, markedAt: { '1': new Date(Date.now() + 1000).toISOString() } }) } });
  expect((await readDailyTask('pdf-course', task.id)).groups[0].finished).toBe(true);
});

it('resumes the recommended unfinished original paper with its saved answers and round', async () => {
  await db.material.update({ where: { id: 'material' }, data: { chapter: '历年套卷' } });
  const exam = await loadOriginalSession('course', 'paper', refs.map(ref => ref.questionId), 'exam');
  await db.originalPracticeSession.update({ where: { id: exam.scope }, data: { content: JSON.stringify({ questions: exam.questions, session: { ...exam.session, answers: { [refs[0].questionId]: 'A' } } }) } });
  const task = await createDailyTask('course', 'papers');
  const started = await startDailyGroup('course', task.id, task.groups[0].id);
  const resumed = started.data as OriginalSessionData;
  expect(resumed.scope).toBe(exam.scope);
  expect(resumed.session.roundId).toBe(exam.session.roundId);
  expect(resumed.session.answers[refs[0].questionId]).toBe('A');
  await db.dailyPracticeTask.delete({ where: { id: task.id } });
  await db.originalPracticeSession.delete({ where: { id: exam.scope } });
  await db.material.update({ where: { id: 'material' }, data: { chapter: '未分类' } });
});

it('does not create an unusable PDF task for an unread Word paper', async () => {
  await db.material.create({ data: { id: 'unread-word', courseId: 'other', name: '新导入原卷.docx', mime: 'application/docx', size: 10, hash: 'unread', filePath: 'unused', origin: 'test', chapter: '历年套卷', status: 'stored' } });
  const response = await dailyPOST(request('/api/practice-daily', { action: 'create', courseId: 'other', section: 'papers' }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain('读取');
  expect(await db.dailyPracticeTask.count({ where: { courseId: 'other' } })).toBe(0);
});

it('identifies the daily task of an unfinished generated scope for homepage resume', async () => {
  await db.version.create({ data: { id: 'generated-version', courseId: 'other', number: 1, title: '知识点验收', content: '[]', sourceIds: '[]', summary: '' } });
  await db.practiceSession.create({ data: { id: 'generated-daily-scope', courseId: 'other', versionId: 'generated-version', content: JSON.stringify({ ...blankSession(), ids: ['q'], answers: { q: '已作答' } }) } });
  const task = await db.dailyPracticeTask.create({ data: { courseId: 'other', section: 'knowledge', day: '2026-10-02', content: JSON.stringify({ groups: [{ id: 'generated-group', engine: 'generated', scope: 'generated-daily-scope', versionId: 'generated-version', refs: [], context: 'knowledge', title: '每日知识点' }] }) } });
  const summary = await practiceHubSummary('other', 'knowledge');
  expect(summary.records.find(record => record.id === 'generated-daily-scope')).toMatchObject({ taskId: task.id, answered: 1, finished: false, versionId: 'generated-version' });
});

it('keeps reviewed questions in knowledge practice despite a previous paper attempt', async () => {
  const material = await db.material.findUniqueOrThrow({ where: { id: 'material' } });
  const bank = await db.originalQuestionBank.findFirstOrThrow({ where: { materialId: 'material' } });
  const content = JSON.parse(bank.content), question = content.questions[0];
  try {
    await db.material.update({ where: { id: 'material' }, data: { chapter: '历年套卷' } });
    await db.originalQuestionBank.update({ where: { id: bank.id }, data: { content: JSON.stringify({ ...content, questions: content.questions.map((item: { id: string }) => item.id === question.id ? { ...item, practiceArea: 'knowledge' } : item) }) } });
    await db.originalPracticeSession.create({ data: { id: 'adopted-paper-attempt', courseId: 'course', context: 'paper', content: JSON.stringify({ questions: [question], session: { roundId: crypto.randomUUID(), mode: 'practice', ids: [question.id], index: 0, answers: { [question.id]: 'A' }, results: { [question.id]: { answer: 'A', correct: true, source: 'original', judgedAt: new Date().toISOString() } }, submitted: false, finished: true } }) } });
    const summary = await practiceHubSummary('course', 'knowledge');
    expect(summary.catalog.find(item => item.ref.questionId === question.id)).toMatchObject({ section: 'knowledge', available: true, lastAttempt: { correct: true } });
    expect(summary.catalog.find(item => item.ref.questionId === content.questions[1].id)?.section).toBe('papers');
  } finally {
    await db.originalPracticeSession.deleteMany({ where: { id: 'adopted-paper-attempt' } });
    await db.originalQuestionBank.update({ where: { id: bank.id }, data: { content: bank.content } });
    await db.material.update({ where: { id: 'material' }, data: { chapter: material.chapter } });
  }
});

it('leaves an empty course unchanged and refuses to start a daily task whose source has changed', async () => {
  const empty = await dailyPOST(request('/api/practice-daily', { action: 'create', courseId: 'empty', section: 'knowledge' }));
  expect(empty.status).toBe(400);
  expect(await db.dailyPracticeTask.count({ where: { courseId: 'empty' } })).toBe(0);
  const task = await db.dailyPracticeTask.findFirstOrThrow();
  await db.material.update({ where: { id: 'material' }, data: { hash: 'changed' } });
  const start = await dailyPOST(request('/api/practice-daily', { action: 'start', courseId: 'course', taskId: task.id, groupId: JSON.parse(task.content).groups[0].id }));
  expect(start.status).toBe(400);
  expect(await db.originalPracticeSession.count()).toBe(1);
});
