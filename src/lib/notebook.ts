import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import type { Reference, Section, Version } from './types';

export type RichNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: RichNode[] };
export const bulletListStyles = ['disc', 'circle', 'square'] as const;
export const orderedListStyles = ['decimal', 'lower-alpha', 'lower-roman'] as const;
export function notebookListStyle(node: Pick<RichNode, 'type' | 'attrs'>): string {
  const styles: readonly string[] = node.type === 'bulletList' ? bulletListStyles : orderedListStyles;
  return styles.includes(String(node.attrs?.listStyleType)) ? String(node.attrs?.listStyleType) : styles[0];
}
export type NotebookOrigin = { kind: 'material' | 'ai' | 'chat' | 'practice' | 'manual'; label: string; refs: Reference[]; courseId?: string; conversationId?: string; messageId?: string; questionId?: string; exam?: { materialId: string; question: number }; generation?: Section['generation']; sectionId?: string; needsReview?: boolean };
export function contentOriginLabel(generation: Section['generation']): string { return generation?.contentOrigin === 'ai-supplement' ? 'AI 补充解释' : '原文整理'; }
export function referenceOriginLabel(generation: Section['generation']): string { return generation?.contentOrigin === 'ai-supplement' ? '提问出处，非答案依据' : '来源'; }
export function notebookOriginLabel(origin: NotebookOrigin): string { return origin.kind === 'ai' || origin.generation ? `${contentOriginLabel(origin.generation)}${origin.label.includes('个人修订') ? ' · 个人修订' : ''}` : origin.label; }
export type KnowledgePage = { id: string; title: string; chapterId: string | null; doc: RichNode };
export type CapturedNote = { id: string; title: string; doc: RichNode; createdAt: string };
export type NotebookDocument = { paperType?: 'blank' | 'ruled' | 'grid'; chapters: { id: string; title: string }[]; pages: KnowledgePage[]; inbox: CapturedNote[]; trash: (KnowledgePage & { deletedAt: string })[] };
export type NotebookData = { courseId: string; revision: number; document: NotebookDocument; updatedAt: string };
export type NotebookHistory = { id: string; summary: string; createdAt: string };
export const emptyNotebook = (): NotebookDocument => ({ chapters: [], pages: [], inbox: [], trash: [] });
export const emptyDocument = (): RichNode => ({ type: 'doc', content: [{ type: 'paragraph' }] });
export function equalContent(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalContent(value, right[index]));
  const first = left as Record<string, unknown>, second = right as Record<string, unknown>, keys = Object.keys(first).filter(key => first[key] !== undefined);
  return keys.length === Object.keys(second).filter(key => second[key] !== undefined).length && keys.every(key => equalContent(first[key], second[key]));
}

type MarkdownNode = { type: string; value?: string; depth?: number; ordered?: boolean; start?: number; url?: string; alt?: string; children?: MarkdownNode[] };
function fromMarkdown(node: MarkdownNode): RichNode[] {
  const children = () => (node.children ?? []).flatMap(fromMarkdown);
  if (node.type === 'root') return [{ type: 'doc', content: children().map(child => child.type === 'text' ? { type: 'paragraph', content: [child] } : child) }];
  if (node.type === 'text') return [{ type: 'text', text: node.value ?? '' }];
  if (node.type === 'inlineMath') return [{ type: 'inlineMath', attrs: { latex: node.value ?? '' } }];
  if (node.type === 'math') return [{ type: 'blockMath', attrs: { latex: node.value ?? '' } }];
  if (node.type === 'image') return /^\/api\/notebook-assets\//.test(node.url ?? '') ? [{ type: 'image', attrs: { src: node.url, alt: node.alt ?? '' } }] : [{ type: 'text', text: `![${node.alt ?? ''}](${node.url ?? ''})` }];
  if (node.type === 'break') return [{ type: 'hardBreak' }];
  if (node.type === 'thematicBreak') return [{ type: 'horizontalRule' }];
  if (node.type === 'inlineCode') return [{ type: 'text', text: node.value ?? '', marks: [{ type: 'code' }] }];
  if (node.type === 'code') return [{ type: 'codeBlock', content: node.value ? [{ type: 'text', text: node.value }] : [] }];
  if (['strong', 'emphasis', 'link', 'delete'].includes(node.type)) {
    const mark = { type: ({ strong: 'bold', emphasis: 'italic', link: 'link', delete: 'strike' } as Record<string, string>)[node.type], ...(node.type === 'link' ? { attrs: { href: node.url } } : {}) };
    return children().map(child => ({ ...child, marks: [...(child.marks ?? []), mark] }));
  }
  const type = ({ paragraph: 'paragraph', heading: 'heading', blockquote: 'blockquote', listItem: 'listItem' } as Record<string, string>)[node.type];
  if (type === 'paragraph') {
    const result: RichNode[] = [], inline: RichNode[] = [];
    for (const child of children()) { if (child.type === 'image') { if (inline.length) result.push({ type, content: inline.splice(0) }); result.push(child); } else inline.push(child); }
    if (inline.length) result.push({ type, content: inline }); return result.length ? result : [{ type }];
  }
  if (type) return [{ type, ...(node.depth ? { attrs: { level: node.depth } } : {}), content: children() }];
  if (node.type === 'list') return [{ type: node.ordered ? 'orderedList' : 'bulletList', attrs: node.ordered ? { start: node.start ?? 1 } : {}, content: children() }];
  // Preserve unsupported Markdown/HTML as text instead of losing source content.
  return node.value ? [{ type: 'text', text: node.value }] : children();
}
export function markdownDocument(body: string): RichNode {
  const result = fromMarkdown(unified().use(remarkParse).use(remarkMath).parse(body) as MarkdownNode)[0];
  return result.content?.length ? result : emptyDocument();
}
export function richText(node: RichNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'inlineMath' || node.type === 'blockMath') return String(node.attrs?.latex ?? '');
  if (node.type === 'image') return String(node.attrs?.alt ?? '图片');
  return (node.content ?? []).map(richText).join(node.type === 'tableRow' ? '\t' : ['doc', 'sourceBlock', 'bulletList', 'orderedList', 'listItem', 'table', 'tableCell', 'tableHeader'].includes(node.type) ? '\n' : '');
}
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
function tableHtml(node: RichNode): string {
  const content = (node.content ?? []).map(tableHtml).join('');
  if (node.type === 'text') {
    let text = escapeHtml(node.text ?? '');
    for (const mark of node.marks ?? []) {
      const tag = ({ bold: 'strong', italic: 'em', strike: 's', underline: 'u', code: 'code' } as Record<string, string>)[mark.type];
      if (tag) text = `<${tag}>${text}</${tag}>`;
      if (mark.type === 'link' && /^(https?:\/\/|mailto:|\/api\/)/i.test(String(mark.attrs?.href ?? ''))) text = `<a href="${escapeHtml(String(mark.attrs?.href))}">${text}</a>`;
    }
    return text;
  }
  if (node.type === 'table') return `<table><tbody>${content}</tbody></table>`;
  if (node.type === 'tableRow') return `<tr>${content}</tr>`;
  if (node.type === 'tableCell' || node.type === 'tableHeader') {
    const tag = node.type === 'tableHeader' ? 'th' : 'td';
    const spans = ['colspan', 'rowspan'].map(attribute => { const value = Number(node.attrs?.[attribute]); return Number.isSafeInteger(value) && value > 1 ? ` ${attribute}="${value}"` : ''; }).join('');
    const align = ['left', 'center', 'right'].includes(String(node.attrs?.align)) ? ` style="text-align: ${node.attrs?.align}"` : '';
    return `<${tag}${spans}${align}>${content}</${tag}>`;
  }
  if (node.type === 'image') {
    const src = String(node.attrs?.src ?? '');
    return /^\/api\/notebook-assets\/[a-f0-9-]+\.(png|jpg|webp)$/.test(src) ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(String(node.attrs?.alt ?? '图片'))}">` : escapeHtml(String(node.attrs?.alt ?? '图片'));
  }
  if (node.type === 'inlineMath' || node.type === 'blockMath') return escapeHtml(richMarkdown(node));
  if (node.type === 'hardBreak') return '<br>';
  if (node.type === 'horizontalRule') return '<hr>';
  const tag = node.type === 'heading' ? `h${Math.min(6, Math.max(1, Number(node.attrs?.level) || 2))}` : ({ paragraph: 'p', bulletList: 'ul', orderedList: 'ol', listItem: 'li', blockquote: 'blockquote', codeBlock: 'pre' } as Record<string, string>)[node.type];
  const listStyle = ['bulletList', 'orderedList'].includes(node.type) ? ` style="list-style-type: ${notebookListStyle(node)}"` : '';
  return tag ? `<${tag}${node.type === 'orderedList' ? ` start="${Number(node.attrs?.start) || 1}"` : ''}${listStyle}>${content}</${tag}>` : content;
}
export function richMarkdown(node: RichNode): string {
  if (node.type === 'table') return tableHtml(node);
  if (['bulletList', 'orderedList'].includes(node.type) && notebookListStyle(node) !== (node.type === 'bulletList' ? 'disc' : 'decimal')) return tableHtml(node);
  if (node.type === 'text') {
    let text = node.text ?? '';
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `**${text}**`;
      if (mark.type === 'italic') text = `*${text}*`;
      if (mark.type === 'strike') text = `~~${text}~~`;
      if (mark.type === 'code') text = `\`${text}\``;
      if (mark.type === 'link') text = `[${text}](${String(mark.attrs?.href ?? '')})`;
    }
    return text;
  }
  if (node.type === 'inlineMath') return `$${String(node.attrs?.latex ?? '')}$`;
  if (node.type === 'blockMath') return `$$\n${String(node.attrs?.latex ?? '')}\n$$`;
  if (node.type === 'image') return `![${String(node.attrs?.alt ?? '图片')}](${String(node.attrs?.src ?? '')})`;
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'horizontalRule') return '---';
  const content = (node.content ?? []).map(richMarkdown).join(['paragraph', 'heading'].includes(node.type) ? '' : '\n\n');
  if (node.type === 'heading') return `${'#'.repeat(Number(node.attrs?.level ?? 2))} ${content}`;
  if (node.type === 'blockquote') return content.split('\n').map(line => `> ${line}`).join('\n');
  if (node.type === 'codeBlock') return `\`\`\`\n${content}\n\`\`\``;
  if (node.type === 'bulletList' || node.type === 'orderedList') return (node.content ?? []).map((child, index) => `${node.type === 'bulletList' ? '-' : `${Number(node.attrs?.start ?? 1) + index}.`} ${richMarkdown(child).replace(/\n/g, '\n  ')}`).join('\n');
  return content;
}
export function sourceDocument(body: string, origin: NotebookOrigin, id: string): RichNode {
  return formatGeneratedNotebook({ type: 'doc', content: [{ type: 'sourceBlock', attrs: { id, origin }, content: markdownDocument(body).content }] });
}
function formatNoteParagraph(node: RichNode): RichNode[] {
  const segments = (node.content ?? []).map(child => ({ node: child, text: child.type === 'text' && !child.marks?.some(mark => mark.type === 'code') ? child.text ?? '' : '\ufffc' }));
  const text = segments.map(segment => segment.text).join('');
  if (!/^\s*【[^】\n]{1,30}】/.test(text)) return [node];
  const markers = [...text.matchAll(/【[^】\n]{1,30}】|[①-⑳]/gu)];
  function slice(start: number, end: number): RichNode[] {
    let offset = 0;
    const content = segments.flatMap(segment => {
      const left = Math.max(0, start - offset), right = Math.min(segment.text.length, end - offset); offset += segment.text.length;
      if (left >= right) return [];
      return [segment.text === '\ufffc' ? segment.node : { ...segment.node, text: segment.text.slice(left, right) }];
    });
    if (content[0]?.type === 'text') content[0] = { ...content[0], text: content[0].text?.trimStart() };
    const last = content.length - 1;
    if (content[last]?.type === 'text') content[last] = { ...content[last], text: content[last].text?.trimEnd() };
    return content.filter(child => child.type !== 'text' || child.text);
  }
  const result: RichNode[] = [];
  markers.forEach((marker, index) => {
    const start = marker.index!, content = slice(start + marker[0].length, markers[index + 1]?.index ?? text.length);
    if (marker[0].startsWith('【')) {
      result.push({ type: 'heading', attrs: { level: 3 }, content: slice(start + 1, start + marker[0].length - 1) });
      if (content.length) result.push({ ...node, content });
    } else {
      const number = marker[0].codePointAt(0)! - '①'.codePointAt(0)! + 1;
      let list = result[result.length - 1];
      if (list?.type !== 'orderedList' || Number(list.attrs?.start) + (list.content?.length ?? 0) !== number) {
        list = { type: 'orderedList', attrs: { start: number }, content: [] }; result.push(list);
      }
      list.content!.push({ type: 'listItem', content: [{ ...node, content }] });
    }
  });
  return result;
}
export function formatGeneratedNotebook(doc: RichNode): RichNode {
  function visit(node: RichNode, generated = false): RichNode {
    const origin = node.type === 'sourceBlock' ? node.attrs?.origin as NotebookOrigin | undefined : undefined;
    const ai = generated || origin?.kind === 'ai' || !!origin?.generation;
    return node.content ? { ...node, content: node.content.flatMap(child => ai && child.type === 'paragraph' ? formatNoteParagraph(child) : [visit(child, ai)]) } : node;
  }
  return visit(doc);
}
export function notebookFromVersion(version?: Version, examOnly = false): NotebookDocument {
  const document = emptyNotebook();
  if (!version || examOnly) return document;
  document.chapters.push({ id: 'imported', title: '已有知识点' });
  document.pages = version.sections.map(section => ({ id: section.id, chapterId: 'imported', title: section.title, doc: sourceDocument(section.body, { kind: section.generation ? 'ai' : 'material', label: section.generation ? `${contentOriginLabel(section.generation)}${section.edited ? ' · 个人修订' : ''}` : '已有提纲', refs: section.refs, generation: section.generation, sectionId: section.id, needsReview: section.needsReview }, `source-${section.id}`) }));
  return document;
}
export function sourceBlocks(doc: RichNode): RichNode[] {
  return doc.type === 'sourceBlock' ? [doc] : (doc.content ?? []).flatMap(sourceBlocks);
}
export function exportNotebookMarkdown(document: NotebookDocument, courseName: string): string {
  return `# ${courseName} · 我的活页笔记\n\n` + document.pages.map(page => `## ${page.title}\n\n${richMarkdown(formatGeneratedNotebook(page.doc))}\n\n` + sourceBlocks(page.doc).map(block => {
    const origin = block.attrs?.origin as NotebookOrigin;
    return `${notebookOriginLabel(origin)}${origin.needsReview ? ' · 待核对' : ''}\n${referenceOriginLabel(origin.generation)}：\n` + origin.refs.map(ref => `- ${ref.name} · 第 ${ref.page} 页\n  > ${ref.snippet}`).join('\n');
  }).join('\n\n')).join('\n\n');
}
export function appendDocument(target: RichNode, addition: RichNode): RichNode {
  const content = target.content?.filter(node => !(node.type === 'paragraph' && !node.content?.length)) ?? [];
  return { type: 'doc', content: [...content, ...(addition.content ?? [])] };
}
export function markChangedSources(previous: RichNode, next: RichNode): RichNode {
  const old = new Map(sourceBlocks(previous).map(block => [String(block.attrs?.id), block]));
  const visit = (node: RichNode): RichNode => {
    const original = old.get(String(node.attrs?.id));
    const incoming = node.attrs?.origin as NotebookOrigin | undefined, generation = (original?.attrs?.origin as NotebookOrigin | undefined)?.generation;
    const origin = incoming && generation ? { ...incoming, generation } : incoming;
    const attrs = node.type === 'sourceBlock' && original && origin?.refs.length && ((original.attrs?.origin as NotebookOrigin)?.needsReview || richMarkdown(formatGeneratedNotebook(original)) !== richMarkdown(formatGeneratedNotebook(node)))
      ? { ...node.attrs, origin: { ...origin, needsReview: true } } : origin !== incoming ? { ...node.attrs, origin } : node.attrs;
    return { ...node, ...(attrs ? { attrs } : {}), ...(node.content ? { content: node.content.map(visit) } : {}) };
  };
  return visit(next);
}
export function searchNotebook(document: NotebookDocument, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return document.pages.flatMap(page => {
    const text = richText(page.doc), position = text.toLocaleLowerCase().indexOf(needle);
    if (!page.title.toLocaleLowerCase().includes(needle) && position < 0) return [];
    return [{ page, chapter: document.chapters.find(chapter => chapter.id === page.chapterId)?.title ?? '未分类', snippet: text.slice(Math.max(0, position - 24), Math.max(0, position - 24) + 100) }];
  });
}
