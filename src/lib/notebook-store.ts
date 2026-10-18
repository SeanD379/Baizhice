import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { publicVersion } from './server';
import { appendDocument, bulletListStyles, contentOriginLabel, emptyDocument, notebookFromVersion, orderedListStyles, sourceBlocks, sourceDocument, type NotebookData, type NotebookDocument, type NotebookOrigin, type RichNode } from './notebook';
import type { Section } from './types';

const richNode: z.ZodType<RichNode> = z.lazy(() => z.object({
  type: z.enum(['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule', 'image', 'inlineMath', 'blockMath', 'sourceBlock', 'table', 'tableRow', 'tableCell', 'tableHeader']),
  text: z.string().max(100000).optional(), attrs: z.record(z.string(), z.unknown()).optional(),
  marks: z.array(z.object({ type: z.enum(['bold', 'italic', 'strike', 'underline', 'code', 'link']), attrs: z.record(z.string(), z.unknown()).optional() })).max(8).optional(),
  content: z.array(richNode).max(5000).optional(),
}));
const page = z.object({ id: z.string().min(1).max(100), title: z.string().trim().min(1).max(120), chapterId: z.string().nullable(), doc: richNode });
export const notebookSchema = z.object({
  paperType: z.enum(['blank', 'ruled', 'grid']).optional(),
  chapters: z.array(z.object({ id: z.string().min(1).max(100), title: z.string().trim().min(1).max(80) })).max(300),
  pages: z.array(page).max(2000),
  inbox: z.array(z.object({ id: z.string().min(1).max(100), title: z.string().max(120), doc: richNode, createdAt: z.string() })).max(2000),
  trash: z.array(page.extend({ deletedAt: z.string() })).max(2000),
});
export function validateNotebook(input: unknown): NotebookDocument {
  const document = notebookSchema.parse(input);
  const ids = [...document.pages, ...document.trash, ...document.inbox].map(page => page.id);
  if (new Set(ids).size !== ids.length || new Set(document.chapters.map(chapter => chapter.id)).size !== document.chapters.length || new Set(document.inbox.map(note => note.id)).size !== document.inbox.length) throw new Error('笔记包含重复位置，请保留草稿并重试。');
  const chapters = new Set(document.chapters.map(chapter => chapter.id));
  if (document.pages.some(page => page.chapterId && !chapters.has(page.chapterId))) throw new Error('知识点所属章节不存在。');
  let count = 0;
  const check = (node: RichNode, depth = 0) => {
    if (depth > 30 || ++count > 50000) throw new Error('笔记内容过长，请拆分知识点。');
    if (node.type === 'image' && !/^\/api\/notebook-assets\/[a-f0-9-]+\.(png|jpg|webp)$/.test(String(node.attrs?.src))) throw new Error('请上传图片后再加入笔记。');
    if (node.type === 'sourceBlock') z.object({ id: z.string().min(1).max(250), origin: z.object({ kind: z.enum(['material', 'ai', 'chat', 'practice', 'manual']), label: z.string().min(1).max(120), refs: z.array(z.object({ materialId: z.string().max(100), name: z.string().max(300), page: z.number().int().positive(), snippet: z.string().max(60000) })).max(50) }).passthrough() }).parse(node.attrs);
    if (['doc', 'sourceBlock', 'blockquote', 'listItem', 'tableCell', 'tableHeader'].includes(node.type) && node.content?.some(child => ['text', 'hardBreak', 'inlineMath', 'listItem', 'doc', 'tableRow', 'tableCell', 'tableHeader'].includes(child.type))) throw new Error('笔记段落结构不完整，请保留草稿后重新整理。');
    if (node.type === 'table') {
      if (!node.content?.length || node.content.some(child => child.type !== 'tableRow')) throw new Error('表格行结构不完整。');
      const spans: number[] = []; let width = 0;
      node.content.forEach((row, index) => {
        let column = 0;
        for (const cell of row.content ?? []) {
          const colspan = cell.attrs?.colspan ?? 1, rowspan = cell.attrs?.rowspan ?? 1;
          if (typeof colspan !== 'number' || typeof rowspan !== 'number' || !Number.isInteger(colspan) || !Number.isInteger(rowspan) || colspan < 1 || colspan > 1000 || rowspan < 1 || rowspan > 1000 || index + rowspan > node.content!.length) throw new Error('表格合并范围不完整。');
          while ((spans[column] ?? 0) > index) column++;
          for (let offset = 0; offset < colspan; offset++) { if ((spans[column + offset] ?? 0) > index) throw new Error('表格合并范围重叠。'); spans[column + offset] = index + rowspan; }
          column += colspan;
        }
        const occupied = spans.map(end => end > index), rowWidth = occupied.findLastIndex(Boolean) + 1;
        if (!index) width = rowWidth;
        if (!width || rowWidth !== width || occupied.slice(0, width).some(value => !value)) throw new Error('表格行列结构不完整。');
      });
    }
    if (node.type === 'tableRow' && node.content?.some(child => !['tableCell', 'tableHeader'].includes(child.type))) throw new Error('表格单元格结构不完整。');
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      if (!node.content?.length) throw new Error('表格单元格需要保留正文段落。');
      z.object({ colspan: z.number().int().min(1).max(1000).optional(), rowspan: z.number().int().min(1).max(1000).optional(), colwidth: z.array(z.number().int().min(1).max(10000)).max(1000).nullable().optional(), align: z.enum(['left', 'center', 'right']).nullable().optional() }).parse(node.attrs ?? {});
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') z.object({ listStyleType: z.enum(node.type === 'bulletList' ? bulletListStyles : orderedListStyles).nullable().optional() }).parse(node.attrs ?? {});
    if (['paragraph', 'heading'].includes(node.type) && node.content?.some(child => !['text', 'hardBreak', 'inlineMath'].includes(child.type))) throw new Error('正文中的图片或段落位置不可用。');
    if (node.type === 'inlineMath' || node.type === 'blockMath') { if (typeof node.attrs?.latex !== 'string') throw new Error('公式内容不完整。'); }
    for (const mark of node.marks ?? []) if (mark.type === 'link' && !/^(https?:\/\/|mailto:|\/api\/)/i.test(String(mark.attrs?.href))) throw new Error('链接地址不可用。');
    for (const child of node.content ?? []) check(child, depth + 1);
  };
  for (const item of [...document.pages, ...document.inbox, ...document.trash]) { if (item.doc.type !== 'doc') throw new Error('笔记正文格式不完整。'); check(item.doc); }
  return document;
}
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function result(record: { courseId: string; content: string; revision: number; updatedAt: Date }): NotebookData {
  return { courseId: record.courseId, revision: record.revision, document: JSON.parse(record.content), updatedAt: record.updatedAt.toISOString() };
}
export async function ensureNotebook(courseId: string, client: Prisma.TransactionClient = db) {
  const saved = await client.notebook.findUnique({ where: { courseId } });
  if (saved) return saved;
  if (!await client.course.findUnique({ where: { id: courseId } })) throw new Error('课程不存在。');
  const version = await client.version.findFirst({ where: { courseId }, orderBy: { number: 'desc' } });
  const sources: string[] = version ? JSON.parse(version.sourceIds) : [];
  const materials = sources.length ? await client.material.findMany({ where: { courseId, id: { in: sources } } }) : [];
  const examOnly = sources.length > 0 && sources.every(id => materials.some(material => material.id === id && material.chapter === '历年套卷'));
  return client.notebook.upsert({ where: { courseId }, update: {}, create: { courseId, content: JSON.stringify(notebookFromVersion(version ? publicVersion(version) : undefined, examOnly)) } });
}
export async function getNotebook(courseId: string) { return result(await ensureNotebook(courseId)); }
export async function checkpointNotebook(courseId: string, summary: string, client: Prisma.TransactionClient = db) {
  const notebook = await ensureNotebook(courseId, client);
  const latest = await client.notebookSnapshot.findFirst({ where: { courseId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  if (latest?.content === notebook.content) return latest;
  return client.notebookSnapshot.create({ data: { courseId, content: notebook.content, summary } });
}
export class NotebookConflict extends Error {
  constructor(public current: NotebookData) { super('另一台设备已有更新。你的草稿已保留，请对照后继续。'); }
}
export async function saveNotebook(courseId: string, document: NotebookDocument, revision: number, requestId: string, checkpoint?: string) {
  const checked = validateNotebook(document);
  return db.$transaction(async client => {
    const notebook = await ensureNotebook(courseId, client);
    const hash = fingerprint(checked);
    const previous = await client.notebookMutation.findUnique({ where: { courseId_requestId: { courseId, requestId } } });
    if (previous) {
      if (previous.fingerprint !== hash) throw new Error('重试请求与原草稿不同，请重新保存。');
      return result(notebook);
    }
    if (notebook.revision !== revision) throw new NotebookConflict(result(notebook));
    const stored: NotebookDocument = JSON.parse(notebook.content), origins = new Map([...stored.pages, ...stored.inbox, ...stored.trash].flatMap(page => sourceBlocks(page.doc)).map(block => [String(block.attrs?.id), block.attrs?.origin as NotebookOrigin]));
    for (const block of [...checked.pages, ...checked.inbox, ...checked.trash].flatMap(page => sourceBlocks(page.doc))) {
      const previousOrigin = origins.get(String(block.attrs?.id)), origin = block.attrs?.origin as NotebookOrigin;
      if (previousOrigin?.generation) block.attrs!.origin = { ...origin, generation: previousOrigin.generation };
    }
    const content = JSON.stringify(checked);
    if (notebook.content !== content) {
      const updated = await client.notebook.updateMany({ where: { courseId, revision }, data: { content, revision: { increment: 1 } } });
      if (!updated.count) throw new NotebookConflict(result((await client.notebook.findUnique({ where: { courseId } }))!));
    }
    const saved = (await client.notebook.findUnique({ where: { courseId } }))!;
    await client.notebookMutation.create({ data: { courseId, requestId, fingerprint: hash, revision: saved.revision } });
    if (checkpoint) await checkpointNotebook(courseId, checkpoint, client);
    return result(saved);
  });
}
export type AdoptTarget = { sectionId: string; pageId?: string; chapterId?: string; chapterTitle?: string };
export async function adoptNotebookSections(courseId: string, sections: Section[], targets: AdoptTarget[], expectedRevision: number | undefined, client: Prisma.TransactionClient, reviewed = false) {
  const notebook = await ensureNotebook(courseId, client);
  if (expectedRevision !== undefined && notebook.revision !== expectedRevision) throw new NotebookConflict(result(notebook));
  const document: NotebookDocument = JSON.parse(notebook.content);
  for (const section of sections) {
    const blockId = `ai-${section.generation?.draftId ?? 'legacy'}-${section.id}`;
    if (JSON.stringify(document).includes(`"id":"${blockId}"`)) continue;
    const target = targets.find(target => target.sectionId === section.id);
    let page = target?.pageId ? document.pages.find(page => page.id === target.pageId) : undefined;
    if (target?.pageId && !page) throw new Error('目标知识点已变化，请重新选择采用位置。');
    if (!page) {
      let chapterId = target?.chapterId ?? null;
      if (target?.chapterTitle) {
        let chapter = document.chapters.find(chapter => chapter.title === target.chapterTitle);
        if (!chapter) { chapter = { id: crypto.randomUUID(), title: target.chapterTitle }; document.chapters.push(chapter); }
        chapterId = chapter.id;
      }
      if (chapterId && !document.chapters.some(chapter => chapter.id === chapterId)) throw new Error('目标章节已变化，请重新选择。');
      page = { id: crypto.randomUUID(), title: section.title, chapterId, doc: emptyDocument() };
      document.pages.push(page);
    }
    const origin: NotebookOrigin = { kind: 'ai', label: `${contentOriginLabel(section.generation)}${section.edited ? ' · 个人修订' : ''}`, refs: section.refs, generation: section.generation, sectionId: section.id, needsReview: !reviewed };
    page.doc = appendDocument(page.doc, sourceDocument(section.body, origin, blockId));
  }
  await client.notebook.update({ where: { courseId }, data: { content: JSON.stringify(document), revision: { increment: 1 } } });
  await checkpointNotebook(courseId, '采用 AI 整理的知识点', client);
  return (await client.notebook.findUnique({ where: { courseId } }))!;
}
