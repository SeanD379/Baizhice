import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
vi.mock('./db', async () => {
  const { PrismaClient } = await import('@prisma/client'), fs = await import('node:fs/promises');
  const dataDir = await fs.mkdtemp(path.join(process.env.TEMP!, 'lms-knowledge-practice-'));
  return { dataDir, db: new PrismaClient({ datasources: { db: { url: `file:${path.join(dataDir, 'test.db').replaceAll('\\', '/')}` } } }) };
});
vi.mock('./deepseek', async original => ({ ...await original<typeof import('./deepseek')>(), deepSeekConfig: () => ({ configured: true, model: 'test' }), requestStructuredOutput: vi.fn() }));
import { db, dataDir } from './db';
import { requestStructuredOutput } from './deepseek';
import { sourceDocument, type NotebookDocument } from './notebook';
import { generateKnowledgePractice, reviewKnowledgePractice } from './knowledge-practice-store';
import { loadOriginalSession } from './original-practice-store';
const body = '1、2、3 的平均值为 2。';
const document: NotebookDocument = { chapters: [], inbox: [], trash: [], pages: ['one', 'two'].map(id => ({ id, title: id === 'one' ? '平均值' : '未选知识点', chapterId: null, doc: sourceDocument(body, { kind: 'material', label: '原文整理', refs: [{ materialId: 'material', name: '平均值.docx', page: 1, snippet: body }] }, id) })) };
beforeAll(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: { ...process.env, DATABASE_URL: `file:${path.join(dataDir, 'test.db').replaceAll('\\', '/')}` }, stdio: 'pipe' });
  await db.course.createMany({ data: [{ id: 'course', name: '课程' }, { id: 'other', name: '其他课程' }] });
  await db.material.create({ data: { id: 'material', courseId: 'course', name: '平均值.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', hash: 'hash', size: 1, filePath: 'unused', origin: 'test', status: 'extracted' } });
  await mkdir(path.join(dataDir, 'extractions'));
  await writeFile(path.join(dataDir, 'extractions/material.json'), JSON.stringify({ state: 'complete', pageCount: 1, sourceCount: 1, continuation: { startSource: 1, hasMore: false }, durationMs: 1, updatedAt: 'test', pages: [{ page: 1, text: body, method: 'docx-text', state: 'extracted', warnings: [] }] }));
});
beforeEach(async () => {
  await db.originalPracticeRound.deleteMany(); await db.originalPracticeSession.deleteMany(); await db.originalQuestionBank.deleteMany();
  await db.notebook.upsert({ where: { courseId: 'course' }, update: { content: JSON.stringify(document) }, create: { courseId: 'course', content: JSON.stringify(document) } });
  vi.clearAllMocks();
  vi.mocked(requestStructuredOutput).mockResolvedValue({ model: 'test', output: { questions: [{ sectionId: 'one', kind: 'choice', prompt: '三个数的平均值为多少？', options: ['1', '2', '3'], answer: '2', explanation: '相加得 6，再除以 3。', criteria: [], reference: { materialId: 'material', page: 1, snippet: body } }] } });
});
afterAll(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
it('generates only selected knowledge and persists a pending variant with answer and explanation', async () => {
  const result = await generateKnowledgePractice('course', 'material', ['one']);
  expect(JSON.parse(vi.mocked(requestStructuredOutput).mock.calls[0][0].input).map((section: { id: string }) => section.id)).toEqual(['one']);
  expect(result.bank.questions).toHaveLength(1);
  expect(result.bank.questions[0]).toMatchObject({ origin: 'variant', answer: 'B', answerSource: 'ai', explanation: '相加得 6，再除以 3。', practiceArea: 'knowledge', practiceReview: 'pending' });
  expect(result.questionIds).toEqual([result.bank.questions[0].id]);
  await expect(loadOriginalSession('course', 'knowledge', result.questionIds, 'practice')).rejects.toThrow('核对');
  const bank = await reviewKnowledgePractice('course', result.bank.id, result.bank.revision, result.questionIds);
  expect(bank.questions[0].practiceReview).toBe('approved');
  expect((await loadOriginalSession('course', 'knowledge', result.questionIds, 'practice')).session.ids).toEqual(result.questionIds);
});
it('rejects another course, unselected-source pages and pending note review without calling AI', async () => {
  await expect(generateKnowledgePractice('other', 'material', ['one'])).rejects.toThrow();
  await expect(generateKnowledgePractice('course', 'material', ['missing'])).rejects.toThrow();
  const pending = structuredClone(document); pending.pages[0].doc.content![0].attrs!.origin = { kind: 'material', label: '待核对', needsReview: true, refs: [{ materialId: 'material', name: '平均值.docx', page: 1, snippet: body }] };
  await db.notebook.update({ where: { courseId: 'course' }, data: { content: JSON.stringify(pending) } });
  await expect(generateKnowledgePractice('course', 'material', ['one'])).rejects.toThrow('核对');
  expect(requestStructuredOutput).not.toHaveBeenCalled();
});
it('rejects a notebook edit during generation and never saves the stale result', async () => {
  vi.mocked(requestStructuredOutput).mockImplementationOnce(async () => {
    await db.notebook.update({ where: { courseId: 'course' }, data: { content: JSON.stringify({ ...document, pages: [] }) } });
    return { model: 'test', output: { questions: [{ sectionId: 'one', kind: 'choice', prompt: '平均值为多少？', options: ['1', '2'], answer: '2', explanation: '平均值为 2。', criteria: [], reference: { materialId: 'material', page: 1, snippet: body } }] } };
  });
  await expect(generateKnowledgePractice('course', 'material', ['one'])).rejects.toThrow('变化');
  expect(await db.originalQuestionBank.count()).toBe(0);
});
it('keeps earlier reviewed questions when generating another candidate and checks review revisions', async () => {
  const first = await generateKnowledgePractice('course', 'material', ['one']);
  await reviewKnowledgePractice('course', first.bank.id, first.bank.revision, first.questionIds);
  const second = await generateKnowledgePractice('course', 'material', ['one']);
  expect(second.bank.questions).toHaveLength(2);
  expect(second.bank.questions.find(question => question.id === first.questionIds[0])?.practiceReview).toBe('approved');
  await expect(reviewKnowledgePractice('course', second.bank.id, 1, second.questionIds)).rejects.toThrow('变化');
});
it('shares duplicate in-flight requests instead of charging for the same generation twice', async () => {
  const first = generateKnowledgePractice('course', 'material', ['one']), second = generateKnowledgePractice('course', 'material', ['one']);
  const [a, b] = await Promise.all([first, second]);
  expect(a.questionIds).toEqual(b.questionIds); expect(requestStructuredOutput).toHaveBeenCalledTimes(1);
  expect(await db.originalQuestionBank.count()).toBe(1);
});
it('blocks an exam that starts during generation and does not save or expose the answers', async () => {
  const output = { model: 'test', output: { questions: [{ sectionId: 'one', kind: 'choice', prompt: '平均值？', options: ['1', '2'], answer: '2', explanation: '平均值为 2。', criteria: [], reference: { materialId: 'material', page: 1, snippet: body } }] } };
  vi.mocked(requestStructuredOutput).mockImplementationOnce(async () => {
    await db.originalPracticeSession.create({ data: { id: 'exam', courseId: 'course', context: 'knowledge', content: JSON.stringify({ questions: [{ materialId: 'material' }], session: { mode: 'exam', submitted: false, finished: false } }) } });
    return output;
  });
  await expect(generateKnowledgePractice('course', 'material', ['one'])).rejects.toThrow('考试');
  expect(await db.originalQuestionBank.count()).toBe(0);
});
it('honors remaining variant slots and rejects missing explanations before creating a round', async () => {
  const result = await generateKnowledgePractice('course', 'material', ['one'], 1);
  const bank = await reviewKnowledgePractice('course', result.bank.id, result.bank.revision, result.questionIds);
  expect(vi.mocked(requestStructuredOutput).mock.calls[0][0].instructions).toContain('1 至 1 道');
  await db.originalQuestionBank.update({ where: { id: bank.id }, data: { content: JSON.stringify({ ...bank, questions: bank.questions.map(question => ({ ...question, explanation: '' })) }) } });
  await expect(loadOriginalSession('course', 'knowledge', result.questionIds, 'practice', true, undefined, true)).rejects.toThrow('准备完成');
  expect(await db.originalPracticeSession.count()).toBe(0);
});
it('rejects review and practice after the originating notebook knowledge is edited', async () => {
  const result = await generateKnowledgePractice('course', 'material', ['one']);
  await db.notebook.update({ where: { courseId: 'course' }, data: { content: JSON.stringify({ ...document, pages: document.pages.map(page => ({ ...page, title: '修改后的知识点' })) }) } });
  await expect(reviewKnowledgePractice('course', result.bank.id, result.bank.revision, result.questionIds)).rejects.toThrow('知识点');
});
it('does not reset an exam started in another tab when opening a ready-only file round', async () => {
  const result = await generateKnowledgePractice('course', 'material', ['one']);
  await reviewKnowledgePractice('course', result.bank.id, result.bank.revision, result.questionIds);
  const original = await loadOriginalSession('course', 'knowledge', result.questionIds, 'exam');
  await expect(loadOriginalSession('course', 'knowledge', result.questionIds, 'practice', true, undefined, true)).rejects.toThrow('考试');
  expect(JSON.parse((await db.originalPracticeSession.findUniqueOrThrow({ where: { id: original.scope } })).content).session.mode).toBe('exam');
  expect(await db.originalPracticeRound.count()).toBe(0);
});
