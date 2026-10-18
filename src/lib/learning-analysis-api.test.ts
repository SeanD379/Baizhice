import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
vi.mock('./db', async () => {
  const { PrismaClient } = await import('@prisma/client'), fs = await import('node:fs/promises'), path = await import('node:path');
  await fs.mkdir(path.resolve('tmp'), { recursive: true });
  const dataDir = await fs.mkdtemp(path.resolve('tmp/learning-analysis-api-'));
  return { dataDir, db: new PrismaClient({ datasources: { db: { url: `file:${path.join(dataDir, 'test.db').replaceAll('\\', '/')}` } } }) };
});
import { db, dataDir } from './db';
import { GET } from '../app/api/learning-analysis/route';
import { PATCH as updateStates } from '../app/api/practice-state/route';
import { prepareQuestionBanks } from './question-bank-store';
import { saveOriginalSession } from './original-practice-store';
import { blankSession } from './practice-session';
import { blankOriginalSession } from './original-practice-store';
import { hashContent } from './generation';
import type { LearningAnalysisData } from './learning-analysis';
import type { OriginalQuestion, OriginalSessionState } from './question-bank-types';
const base = 'http://127.0.0.1:4175';
const request = (url: string, body?: object, method = 'GET') => new Request(base + url, { method, headers: { host: '127.0.0.1:4175', origin: base, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const read = async (courseId = 'course', period = 7) => GET(request(`/api/learning-analysis?courseId=${courseId}&period=${period}`));
let questions: OriginalQuestion[], state: OriginalSessionState;
let generatedScope: string;
beforeAll(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: { ...process.env, DATABASE_URL: `file:${path.join(dataDir, 'test.db').replaceAll('\\', '/')}` }, stdio: 'pipe' });
  await db.course.createMany({ data: [{ id: 'course', name: '分析测试课程' }, { id: 'other', name: '其他课程' }] });
  await db.material.createMany({ data: [
    { id: 'reading', courseId: 'course', name: '阅读练习.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 12, hash: 'reading-hash', filePath: 'private-reading-path', origin: 'test', status: 'extracted' },
    { id: 'paper', courseId: 'course', name: '原卷.pdf', mime: 'application/pdf', size: 12, hash: 'paper-hash', filePath: 'private-paper-path', origin: 'test', status: 'ready', chapter: '历年套卷' },
  ] });
  await mkdir(path.join(dataDir, 'extractions'));
  await writeFile(path.join(dataDir, 'extractions/reading.json'), JSON.stringify({ state: 'complete', pageCount: 1, sourceCount: 1, continuation: { startSource: 1, hasMore: false }, durationMs: 1, updatedAt: 'test', pages: [{ page: 1, text: '1、请选择正确答案。\nA. 甲\nB. 乙\n答案：A\n\n2、请选择另一答案。\nA. 甲\nB. 乙\n答案：B', method: 'docx-text', state: 'extracted', warnings: [] }] }));
  questions = (await prepareQuestionBanks('course', ['reading']))[0].questions;
  const at = new Date(Date.now() - 3600000).toISOString();
  state = { ...blankOriginalSession(questions.map(q => q.id), 'practice'), answers: { [questions[0].id]: 'B' }, results: { [questions[0].id]: { answer: 'B', correct: false, source: 'original', judgedAt: at } } };
  await db.originalPracticeSession.create({ data: { id: 'original', courseId: 'course', context: 'knowledge', content: JSON.stringify({ questions, session: state }) } });
  await db.originalPracticeRound.create({ data: { sessionId: 'original', courseId: 'course', content: JSON.stringify({ questions, session: state }) } });
  await db.version.create({ data: { id: 'v', courseId: 'course', number: 1, title: '复习版本', content: '[]', sourceIds: '["reading"]', summary: '已存版本' } });
  const generated = { id: 'generated-q', topic: '阅读理解', kind: 'single', prompt: '已保存生成题', options: ['A', 'B'], answer: 'SECRET_REFERENCE', explanation: 'SECRET_EXPLANATION', reference: { materialId: 'reading', name: '阅读练习.docx', page: 1, snippet: '引用' } };
  await db.practiceSet.create({ data: { id: 'set', courseId: 'course', versionId: 'v', questions: JSON.stringify([generated]), sectionIds: '[]', sourceHash: 'saved-hash', model: 'test', reviewed: false } });
  generatedScope = hashContent(JSON.stringify(['v', 'set', [generated]]));
  const session = { ...blankSession(), roundId: 'd99feb68-a9e9-467b-a8b5-de143627d731', ids: ['generated-q'], attempts: [{ id: 'generated-q', correct: true, at }], answers: { 'generated-q': 'SECRET_USER_ANSWER' }, results: { 'generated-q': { answer: 'SECRET_USER_ANSWER', correct: true } } };
  await db.practiceSession.create({ data: { id: generatedScope, courseId: 'course', versionId: 'v', content: JSON.stringify(session) } });
  await db.practiceRound.create({ data: { scope: generatedScope, revision: 1, courseId: 'course', versionId: 'v', questions: JSON.stringify([generated]), content: JSON.stringify(session) } });
  await db.examRecord.create({ data: { materialId: 'paper', content: JSON.stringify({ answers: { '1': '原卷作答' }, marks: { '1': 'correct' }, markedAt: { '1': at }, annotations: {} }) } });
});
afterAll(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });

it('reads every practice engine without duplicate archived judgments or writes or answer disclosure', async () => {
  const before = await Promise.all([db.originalPracticeSession.findMany(), db.originalPracticeRound.findMany(), db.practiceSession.findMany(), db.practiceRound.findMany(), db.examRecord.findMany(), db.originalQuestionBank.findMany()]);
  const response = await read(); expect(response.status).toBe(200);
  const data = await response.json() as LearningAnalysisData;
  expect(data.metrics).toMatchObject({ total: 3, correct: 2, reviewCount: 1, accuracy: 67 });
  expect(data.judgments.map(j => j.ref.engine).sort()).toEqual(['generated', 'original', 'pdf']);
  expect(data.judgments.every(j => j.recordId && j.ref.questionId)).toBe(true);
  expect(data.judgments.find(j => j.ref.engine === 'generated')).toMatchObject({ sourceMaterialId: 'reading', sourceRecordId: expect.any(String) });
  expect(data.records.every(record => record.sourceRecordId)).toBe(true);
  expect(data.materialCount).toBe(2); expect(data.versionCount).toBe(1);
  for (const secret of ['SECRET_REFERENCE', 'SECRET_EXPLANATION', 'SECRET_USER_ANSWER', 'private-reading-path', '"answer":']) expect(JSON.stringify(data)).not.toContain(secret);
  expect(await Promise.all([db.originalPracticeSession.findMany(), db.originalPracticeRound.findMany(), db.practiceSession.findMany(), db.practiceRound.findMany(), db.examRecord.findMany(), db.originalQuestionBank.findMany()])).toEqual(before);
});

it('reflects saved source judgments, consolidation state and newly added materials on the next read', async () => {
  const saved = await saveOriginalSession('course', 'original', 1, { ...state, answers: { [questions[0].id]: 'A' }, results: { [questions[0].id]: { answer: 'A', correct: true, source: 'original' } } });
  expect((await (await read()).json()).metrics.reviewCount).toBe(0);
  await saveOriginalSession('course', 'original', saved.revision, { ...saved.session, answers: { [questions[0].id]: 'B' }, results: { [questions[0].id]: { answer: 'B', correct: false, source: 'original' } } });
  expect((await (await read()).json()).metrics.reviewCount).toBe(1);
  const response = await updateStates(request('/api/practice-state', { courseId: 'course', refs: [{ engine: 'original', questionId: questions[0].id, materialId: 'reading' }], changes: { consolidated: true } }, 'PATCH'));
  expect(response.status).toBe(200);
  await db.material.create({ data: { id: 'new', courseId: 'course', name: '新资料', mime: 'text/plain', size: 1, hash: 'new', filePath: 'unused', origin: 'test' } });
  const data = await (await read()).json();
  expect(data.metrics.reviewCount).toBe(0); expect(data.materialCount).toBe(3);
});

it('excludes protected material and version history when an unsubmitted exam starts', async () => {
  const previous = await db.originalPracticeSession.findUniqueOrThrow({ where: { id: 'original' } });
  const exam = { questions, session: { ...blankOriginalSession(questions.map(q => q.id), 'exam') } };
  await db.originalPracticeSession.update({ where: { id: 'original' }, data: { content: JSON.stringify(exam) } });
  try {
    const data = await (await read()).json() as LearningAnalysisData;
    expect(data.withheld).toBe(true);
    expect(data.metrics.total).toBe(1);
    expect(data.judgments[0].ref.engine).toBe('pdf');
    expect(data.topics).toEqual([]);
    expect(data.records.every(record => record.engine === 'pdf')).toBe(true);
  } finally { await db.originalPracticeSession.update({ where: { id: 'original' }, data: { content: previous.content } }); }
});

it('scopes data by course and rejects invalid periods and missing courses', async () => {
  const other = await (await read('other')).json();
  expect(other.metrics.total).toBe(0); expect(other.materialCount).toBe(0); expect(other.records).toEqual([]);
  expect((await read('missing')).status).toBe(400);
  expect((await read('course', 14)).status).toBe(400);
  expect((await read('')).status).toBe(400);
});

it('retains excluded source history without recommending an unavailable practice source', async () => {
  await db.material.update({ where: { id: 'reading' }, data: { excluded: true } });
  try {
    const data = await (await read()).json() as LearningAnalysisData;
    expect(data.metrics.total).toBeGreaterThan(1);
    expect(data.judgments.filter(j => j.ref.materialId === 'reading' || j.ref.versionId === 'v').every(j => !j.available)).toBe(true);
  } finally { await db.material.update({ where: { id: 'reading' }, data: { excluded: false } }); }
});

it('keeps an archived generated round tied to its original set when a later set reuses the same question id and prompt', async () => {
  await db.course.create({ data: { id: 'collision', name: '同题干历史' } });
  await db.version.create({ data: { id: 'collision-v', courseId: 'collision', number: 1, title: '版本', content: '[]', sourceIds: '[]', summary: '' } });
  const first = { id: 'shared', kind: 'single', topic: '主题', prompt: '同一个题干', options: ['A', 'B'], answer: 'A', explanation: '旧解析', reference: { materialId: 'removed', name: '历史资料', page: 1, snippet: '原文' } };
  const later = { ...first, answer: 'B', explanation: '新解析' };
  await db.practiceSet.createMany({ data: [
    { id: 'first-set', courseId: 'collision', versionId: 'collision-v', questions: JSON.stringify([first]), sectionIds: '[]', sourceHash: 'first', reviewed: false, model: 'test', createdAt: new Date(Date.now() - 7200000) },
    { id: 'later-set', courseId: 'collision', versionId: 'collision-v', questions: JSON.stringify([later]), sectionIds: '[]', sourceHash: 'later', reviewed: false, model: 'test' },
  ] });
  const scope = hashContent(JSON.stringify(['collision-v', 'first-set', [first]]));
  await db.practiceRound.create({ data: { scope, revision: 1, courseId: 'collision', versionId: 'collision-v', questions: JSON.stringify([first]), content: JSON.stringify({ ...blankSession(), ids: ['shared'], attempts: [{ id: 'shared', correct: false, at: new Date(Date.now() - 3600000).toISOString() }] }) } });
  const data = await (await read('collision')).json() as LearningAnalysisData;
  expect(data.judgments[0].ref.setId).toBe('first-set');
  expect(data.judgments[0].available).toBe(false);
});

it('does not recommend a historical original question after the same reference has changed content', async () => {
  const bank = await db.originalQuestionBank.findFirstOrThrow({ where: { materialId: 'reading' } });
  const content = JSON.parse(bank.content);
  content.questions[0].prompt += '（题目已更新）';
  await db.originalQuestionBank.update({ where: { id: bank.id }, data: { content: JSON.stringify(content) } });
  try {
    const data = await (await read()).json() as LearningAnalysisData;
    const old = data.judgments.filter(item => item.ref.engine === 'original' && item.ref.questionId === questions[0].id);
    expect(old.length).toBeGreaterThan(0);
    expect(old.every(item => !item.available)).toBe(true);
  } finally { await db.originalQuestionBank.update({ where: { id: bank.id }, data: { content: bank.content } }); }
});

it('counts identical legacy archive snapshots once using their earliest actual saved time', async () => {
  await db.course.create({ data: { id: 'legacy', name: '旧归档' } });
  const legacyQuestion = { ...questions[0], materialId: 'old-material' };
  const legacy = { ...blankOriginalSession([legacyQuestion.id], 'practice'), answers: { [legacyQuestion.id]: 'B' }, results: { [legacyQuestion.id]: { answer: 'B', correct: false, source: 'original' } } };
  const content = JSON.stringify({ questions: [legacyQuestion], session: legacy });
  const earliest = new Date(Date.now() - 10800000);
  await db.originalPracticeSession.create({ data: { id: 'legacy-scope', courseId: 'legacy', context: 'knowledge', content, updatedAt: new Date(Date.now() - 3600000) } });
  await db.originalPracticeRound.createMany({ data: [
    { sessionId: 'legacy-scope', courseId: 'legacy', content, createdAt: earliest },
    { sessionId: 'legacy-scope', courseId: 'legacy', content, createdAt: new Date(Date.now() - 7200000) },
  ] });
  const data = await (await read('legacy')).json() as LearningAnalysisData;
  expect(data.metrics.total).toBe(1);
  expect(data.savedTimeCount).toBe(1);
  expect(data.judgments[0].at).toBe(earliest.toISOString());
});

it('preserves separately timestamped judgments while absorbing their untimestamped legacy copy', async () => {
  const row = await db.originalPracticeSession.findUniqueOrThrow({ where: { id: 'legacy-scope' } });
  const saved = JSON.parse(row.content);
  saved.session.results[questions[0].id].judgedAt = new Date(Date.now() - 1800000).toISOString();
  await db.originalPracticeSession.update({ where: { id: row.id }, data: { content: JSON.stringify(saved) } });
  saved.session.results[questions[0].id].judgedAt = new Date(Date.now() - 3600000).toISOString();
  await db.originalPracticeRound.create({ data: { sessionId: row.id, courseId: 'legacy', content: JSON.stringify(saved) } });
  const data = await (await read('legacy')).json() as LearningAnalysisData;
  expect(data.metrics.total).toBe(2);
  expect(data.savedTimeCount).toBe(0);
});
