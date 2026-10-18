import { formatGeneratedNotebook, richText, type KnowledgePage, type NotebookDocument, type NotebookOrigin, type RichNode } from './notebook';
export type ReadingPiece = { node: RichNode; origin?: NotebookOrigin; sourceId?: string; index: number; generated?: boolean };
export type LeafSheet = { id: string; page: KnowledgePage; pieces: ReadingPiece[]; continuation: number };
function splitParagraph(node: RichNode): RichNode[] {
  if (node.type === 'bulletList' || node.type === 'orderedList') return (node.content ?? []).map((item, index) => ({ ...node, ...(node.type === 'orderedList' ? { attrs: { ...node.attrs, start: Number(node.attrs?.start ?? 1) + index } } : {}), content: [item] }));
  if (node.type === 'blockquote') return (node.content ?? []).flatMap(splitParagraph).map(part => ({ ...node, content: [part] }));
  if (node.type !== 'paragraph' || richText(node).length < 480) return [node];
  const pieces: RichNode[] = [], children: RichNode[] = [];
  let length = 0;
  const flush = () => { if (children.length) { pieces.push({ ...node, content: children.splice(0) }); length = 0; } };
  for (const child of node.content ?? []) {
    if (child.type !== 'text') { children.push(child); length += richText(child).length; continue; }
    let characters = Array.from(child.text ?? '');
    while (characters.length) {
      if (length >= 400) flush();
      const chunk = characters.splice(0, Math.max(1, 400 - length));
      children.push({ ...child, text: chunk.join('') }); length += chunk.length;
      if (characters.length) flush();
    }
  }
  flush(); return pieces.length ? pieces : [node];
}
export function readingPieces(page: KnowledgePage): ReadingPiece[] {
  const result: Omit<ReadingPiece, 'index'>[] = [];
  for (const node of formatGeneratedNotebook(page.doc).content ?? []) {
    if (node.type === 'sourceBlock') {
      const origin = node.attrs?.origin as NotebookOrigin | undefined;
      const content = (node.content ?? []).flatMap(splitParagraph);
      content.forEach((part, index) => result.push({ node: part, ...(origin?.kind === 'ai' || origin?.generation ? { generated: true } : {}), ...(index === content.length - 1 ? { origin, sourceId: String(node.attrs?.id ?? '') } : {}) }));
    } else result.push(...splitParagraph(node).map(node => ({ node })));
  }
  return result.map((piece, index) => ({ ...piece, index }));
}
export function buildLeafSheets(document: NotebookDocument, width: number, heights: Record<string, number>, height = 520): LeafSheet[] {
  const sheets: LeafSheet[] = [];
  for (const page of document.pages) {
    const pieces = readingPieces(page); let current: ReadingPiece[] = [], used = 0, continuation = 0;
    const flush = () => { sheets.push({ id: `${page.id}:${current[0]?.index ?? 0}`, page, pieces: current, continuation: continuation++ }); current = []; used = 0; };
    const sizes = pieces.map(piece => heights[`${page.id}:${piece.index}`] ?? (32 + Math.ceil(richText(piece.node).length / Math.max(12, Math.floor(width / 16))) * 27 + (piece.origin ? 70 : 0)));
    for (const [index, piece] of pieces.entries()) {
      const size = sizes[index], following = piece.node.type === 'heading' ? sizes[index + 1] ?? 0 : 0;
      if (current.length && used + size + following > height && current[current.length - 1].node.type !== 'heading') flush();
      current.push(piece); used += size;
    }
    if (current.length || !pieces.length) flush();
  }
  return sheets;
}
