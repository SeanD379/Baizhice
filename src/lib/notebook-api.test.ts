import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
vi.mock('./db', async () => {
  const { PrismaClient } = await import('@prisma/client'), fs = await import('node:fs/promises'), path = await import('node:path');
  await fs.mkdir('tmp', { recursive: true }); const dataDir = await fs.mkdtemp(path.resolve('tmp/notebook-api-'));
  return { dataDir, db: new PrismaClient({ datasources: { db: { url: `file:${path.join(dataDir, 'test.db').replaceAll('\\', '/')}` } } }) };
});
import { db } from './db';
import { adoptNotebookSections, getNotebook } from './notebook-store';
import { emptyNotebook, exportNotebookMarkdown, markdownDocument, richText, sourceBlocks } from './notebook';
import { GET, PATCH, POST } from '../app/api/notebooks/[courseId]/route';
const context = { params: Promise.resolve({ courseId: 'course' }) };
const request = (body: unknown, method = 'PATCH') => new Request('http://127.0.0.1:4173/api/notebooks/course', { method, headers: { 'Content-Type': 'application/json', host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' }, body: JSON.stringify(body) });
const page = (body = '我的个人理解') => ({ id: 'point', title: '知识点', chapterId: null, doc: markdownDocument(body) });
beforeAll(async () => {
  for (const sql of [
    'CREATE TABLE Course (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE Material (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, folderId TEXT, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL, filePath TEXT NOT NULL, fixture TEXT, chapter TEXT NOT NULL DEFAULT "未分类", status TEXT NOT NULL DEFAULT "stored", excluded BOOLEAN NOT NULL DEFAULT 0, conflictResolution TEXT, conflictFeedbackReason TEXT, conflictFeedbackNote TEXT, conflictResolvedAt DATETIME, origin TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE Version (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, sourceIds TEXT NOT NULL, summary TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE Notebook (courseId TEXT PRIMARY KEY, content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updatedAt DATETIME NOT NULL)',
    'CREATE TABLE NotebookSnapshot (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, content TEXT NOT NULL, summary TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE NotebookMutation (courseId TEXT NOT NULL, requestId TEXT NOT NULL, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(courseId,requestId))',
  ]) await db.$executeRawUnsafe(sql);
  await db.course.create({ data: { id: 'course', name: '测试课程' } });
});
afterEach(async () => { await db.notebookMutation.deleteMany(); await db.notebookSnapshot.deleteMany(); await db.notebook.deleteMany(); await db.version.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });
it('creates an empty notebook without requiring materials or a version', async () => {
  const response = await GET(new Request('http://127.0.0.1:4173/api/notebooks/course'), context);
  expect(response.status).toBe(200); expect((await response.json()).document).toEqual(emptyNotebook());
});
it('round trips paper choice and editable tables through the notebook endpoint', async () => {
  const data = await getNotebook('course');
  const table = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 2, colwidth: null, align: 'center' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '知识点对比' }] }] }] }, { type: 'tableRow' }] };
  const list = { type: 'orderedList', attrs: { start: 7, listStyleType: 'lower-roman' }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '答题步骤' }] }] }] };
  const document = { ...emptyNotebook(), paperType: 'grid' as const, pages: [{ ...page(), doc: { type: 'doc', content: [table, list] } }] };
  expect((await PATCH(request({ revision: data.revision, requestId: randomUUID(), document }), context)).status).toBe(200);
  const response = await GET(new Request('http://127.0.0.1:4173/api/notebooks/course'), context);
  expect((await response.json()).document).toEqual(document);
});
it('makes repeated save requests idempotent and rejects changed payloads for the same request ID', async () => {
  const data = await getNotebook('course'), input = { revision: data.revision, requestId: randomUUID(), document: { ...emptyNotebook(), pages: [page()] } };
  const first = await PATCH(request(input), context), second = await PATCH(request(input), context);
  expect(first.status).toBe(200); expect(second.status).toBe(200);
  expect((await second.json()).revision).toBe(2);
  expect(await db.notebookMutation.count()).toBe(1);
  expect((await PATCH(request({ ...input, document: { ...input.document, pages: [page('改变内容')] } }), context)).status).toBe(400);
});
it('returns the cloud copy on an old revision without overwriting either device draft', async () => {
  await getNotebook('course');
  await PATCH(request({ revision: 1, requestId: randomUUID(), document: { ...emptyNotebook(), pages: [page('电脑稿')] } }), context);
  const phone = { ...emptyNotebook(), pages: [page('手机稿')] };
  const response = await PATCH(request({ revision: 1, requestId: randomUUID(), document: phone }), context);
  expect(response.status).toBe(409); expect(richText((await response.json()).current.document.pages[0].doc)).toBe('电脑稿');
  expect(richText(phone.pages[0].doc)).toBe('手机稿');
});
it('separates autosave from snapshots and legacy practice versions', async () => {
  const data = await getNotebook('course');
  await PATCH(request({ revision: data.revision, requestId: randomUUID(), document: { ...emptyNotebook(), pages: [page()] } }), context);
  expect(await db.notebookSnapshot.count()).toBe(0); expect(await db.version.count()).toBe(0);
  const checkpoint = () => POST(request({ action: 'checkpoint', summary: '完成编辑' }, 'POST'), context);
  expect((await checkpoint()).status).toBe(200); expect((await checkpoint()).status).toBe(200);
  expect(await db.notebookSnapshot.count()).toBe(1);
});
it('restores old snapshots while preserving the current version for recovery', async () => {
  await getNotebook('course');
  await PATCH(request({ revision: 1, requestId: randomUUID(), document: { ...emptyNotebook(), pages: [page('原稿')] }, checkpoint: '原稿版本' }), context);
  const old = await db.notebookSnapshot.findFirstOrThrow();
  await PATCH(request({ revision: 2, requestId: randomUUID(), document: { ...emptyNotebook(), pages: [page('新稿')] } }), context);
  const response = await POST(request({ action: 'restore', snapshotId: old.id, revision: 3, requestId: randomUUID() }, 'POST'), context);
  expect(response.status).toBe(200); expect(richText((await response.json()).document.pages[0].doc)).toBe('原稿');
  expect((await db.notebookSnapshot.findMany()).some(snapshot => snapshot.content.includes('新稿'))).toBe(true);
});
it('appends two source batches to one point, preserving personal writing and stable source IDs', async () => {
  await getNotebook('course');
  await PATCH(request({ revision: 1, requestId: randomUUID(), document: { ...emptyNotebook(), pages: [page()] } }), context);
  for (const number of [1, 2]) {
    const section = { id: `batch-${number}`, title: '同一知识点', body: `资料 ${number}`, refs: [{ materialId: `m${number}`, name: `讲义${number}.pdf`, page: 1, snippet: `资料 ${number}` }], generation: { provider: 'DeepSeek' as const, model: 'test', draftId: randomUUID() } };
    await db.$transaction(transaction => adoptNotebookSections('course', [section], [{ sectionId: section.id, pageId: 'point' }], undefined, transaction));
  }
  const saved = await getNotebook('course');
  expect(saved.document.pages).toHaveLength(1); expect(richText(saved.document.pages[0].doc)).toContain('我的个人理解');
  expect(sourceBlocks(saved.document.pages[0].doc)).toHaveLength(2);
});
it('preserves reviewed supplementary provenance through append, personal edits, snapshots and restore', async () => {
  await getNotebook('course');
  await PATCH(request({ revision: 1, requestId: randomUUID(), document: { ...emptyNotebook(), pages: [page()] } }), context);
  const generation = { provider: 'DeepSeek' as const, model: 'test', draftId: 'supplementary-draft', contentOrigin: 'ai-supplement' as const };
  const section = { id: 'supplementary', title: '汇率', body: '汇率表示两种货币之间的兑换比率。', refs: [{ materialId: 'source', name: '练习题2.docx', page: 2, snippet: '汇率' }], generation, edited: true };
  await db.$transaction(transaction => adoptNotebookSections('course', [section], [{ sectionId: section.id, pageId: 'point' }], 2, transaction, true));
  const adopted = await getNotebook('course'), old = await db.notebookSnapshot.findFirstOrThrow();
  expect(richText(adopted.document.pages[0].doc)).toContain('我的个人理解');
  expect(sourceBlocks(adopted.document.pages[0].doc)[0].attrs?.origin).toMatchObject({ label: 'AI 补充解释 · 个人修订', generation, needsReview: false });
  const changed = structuredClone(adopted.document), block = sourceBlocks(changed.pages[0].doc)[0];
  block.content![0].content![0].text = '我的汇率定义修订。';
  block.attrs!.origin = { ...(block.attrs?.origin as Record<string, unknown>), label: '我的修订', generation: undefined, needsReview: false };
  const saved = await PATCH(request({ revision: adopted.revision, requestId: randomUUID(), document: changed }), context);
  expect(saved.status).toBe(200);
  const revised = await saved.json();
  expect(sourceBlocks(revised.document.pages[0].doc)[0].attrs?.origin).toMatchObject({ generation });
  expect(exportNotebookMarkdown(revised.document, '课程')).toContain('AI 补充解释');
  expect(exportNotebookMarkdown(revised.document, '课程')).toContain('提问出处，非答案依据');
  const restore = await POST(request({ action: 'restore', snapshotId: old.id, revision: revised.revision, requestId: randomUUID() }, 'POST'), context);
  expect(restore.status).toBe(200);
  const restored = await restore.json();
  expect(sourceBlocks(restored.document.pages[0].doc)[0].attrs?.origin).toMatchObject({ generation });
  expect(exportNotebookMarkdown(restored.document, '课程')).toContain('AI 补充解释 · 个人修订');
  expect((await db.notebookSnapshot.findMany()).some(snapshot => snapshot.content.includes('我的汇率定义修订'))).toBe(true);
});
it('creates a chosen chapter and keeps separate source and supplementary blocks without duplicate adoption', async () => {
  const source = { id: 'source-note', title: '原文知识点', body: '原文内容。', refs: [], generation: { provider: 'DeepSeek' as const, model: 'test', draftId: 'source-draft' } };
  await db.$transaction(transaction => adoptNotebookSections('course', [source], [{ sectionId: source.id, chapterTitle: '金融概念' }], undefined, transaction, true));
  const first = await getNotebook('course'), pageId = first.document.pages[0].id;
  const supplement = { ...source, id: 'concept-note', title: '概念解释', body: '补充内容。', generation: { ...source.generation, draftId: 'concept-draft', contentOrigin: 'ai-supplement' as const } };
  const targets = [{ sectionId: supplement.id, pageId }];
  await db.$transaction(transaction => adoptNotebookSections('course', [supplement], targets, undefined, transaction, true));
  await db.$transaction(transaction => adoptNotebookSections('course', [supplement], targets, undefined, transaction, true));
  const combined = await getNotebook('course');
  expect(combined.document.chapters.map(chapter => chapter.title)).toEqual(['金融概念']);
  expect(combined.document.pages).toHaveLength(1);
  expect(sourceBlocks(combined.document.pages[0].doc)).toHaveLength(2);
  const exported = exportNotebookMarkdown(combined.document, '课程');
  expect(exported).toContain('原文整理'); expect(exported).toContain('AI 补充解释');
});
