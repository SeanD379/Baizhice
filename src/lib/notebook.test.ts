import { expect, it } from 'vitest';
import { appendDocument, contentOriginLabel, emptyNotebook, equalContent, exportNotebookMarkdown, formatGeneratedNotebook, markChangedSources, markdownDocument, notebookFromVersion, notebookOriginLabel, referenceOriginLabel, richMarkdown, richText, searchNotebook, sourceBlocks, sourceDocument } from './notebook';
import { buildLeafSheets, readingPieces } from './notebook-pages';
import { validateNotebook } from './notebook-store';
import type { Version } from './types';
import type { RichNode } from './notebook';
const origin = { kind: 'material' as const, label: '讲义摘录', refs: [{ materialId: 'source', name: '讲义.pdf', page: 2, snippet: '原文' }], needsReview: false };
const table: RichNode = { type: 'table', content: ['tableHeader', 'tableCell'].map(type => ({ type: 'tableRow', content: ['概念', '理解'].map(text => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }] })) })) };
it('formats existing AI note sections and numbered points without changing source identity or marking layout as a content edit', () => {
  const aiOrigin = { ...origin, kind: 'ai' as const, label: 'AI 补充解释', generation: { provider: 'DeepSeek' as const, model: 'test', draftId: 'draft', contentOrigin: 'ai-supplement' as const } };
  const body = '【定义】约定未来交易。 【要点】①条款由双方协商；②到期交割。 【示例（AI 补充）】支付 $P$，保留 **重点**。 【需核对】对照教材。';
  const legacy: RichNode = { type: 'doc', content: [{ type: 'sourceBlock', attrs: { id: 'stable', origin: aiOrigin }, content: markdownDocument(body).content }] };
  const before = structuredClone(legacy), formatted = formatGeneratedNotebook(legacy), block = sourceBlocks(formatted)[0];
  expect(legacy).toEqual(before); expect(block.attrs).toEqual(legacy.content![0].attrs);
  expect(block.content?.filter(node => node.type === 'heading').map(richText)).toEqual(['定义', '要点', '示例（AI 补充）', '需核对']);
  expect(block.content?.find(node => node.type === 'orderedList')?.content).toHaveLength(2);
  expect(richMarkdown(formatted)).toContain('$P$'); expect(richMarkdown(formatted)).toContain('**重点**');
  expect(richText(formatted)).toContain('对照教材。'); expect(formatGeneratedNotebook(formatted)).toEqual(formatted);
  expect(sourceBlocks(markChangedSources(legacy, formatted))[0].attrs?.origin).toMatchObject({ needsReview: false });
  const pieces = readingPieces({ id: 'legacy', title: '概念', chapterId: null, doc: legacy });
  expect(pieces.filter(piece => piece.origin)).toHaveLength(1); expect(pieces.some(piece => piece.node.type === 'heading')).toBe(true);
  expect(exportNotebookMarkdown({ ...emptyNotebook(), pages: [{ id: 'p', title: '概念', chapterId: null, doc: legacy }] }, '课程')).toContain('### 定义');
});
it('leaves personal notes, existing rich structure and code markers intact', () => {
  const body = '【定义】个人写的内容。 【要点】①保留原样。';
  const personal = sourceDocument(body, origin, 'personal'); expect(richMarkdown(personal)).toBe(body);
  const aiOrigin = { ...origin, kind: 'ai' as const };
  const generated = sourceDocument('【定义】符号 $①$ 与 `【保留】①`。 【要点】①步骤。', aiOrigin, 'math');
  expect(richMarkdown(generated)).toContain('$①$'); expect(richMarkdown(generated)).toContain('`【保留】①`');
  const structured = sourceDocument('### 定义\n\n正文。\n\n1. 步骤。', aiOrigin, 'structured');
  expect(formatGeneratedNotebook(structured)).toEqual(structured);
});
it('keeps section headings with their following text when a notebook page continues', () => {
  const doc = markdownDocument('正文。\n\n### 要点\n\n第一条解释。'), page = { id: 'p', title: '概念', chapterId: null, doc };
  const sheets = buildLeafSheets({ ...emptyNotebook(), pages: [page] }, 340, { 'p:0': 430, 'p:1': 40, 'p:2': 80 }, 520);
  expect(sheets).toHaveLength(2); expect(sheets[1].pieces.map(piece => piece.node.type)).toEqual(['heading', 'paragraph']);
});
it('accepts legacy notebooks and preserves each supported paper choice', () => {
  expect(validateNotebook(emptyNotebook()).paperType).toBeUndefined();
  for (const paperType of ['blank', 'ruled', 'grid'] as const) expect(validateNotebook({ ...emptyNotebook(), paperType }).paperType).toBe(paperType);
  expect(() => validateNotebook({ ...emptyNotebook(), paperType: 'unknown' })).toThrow();
});
it('preserves table structure, search text, safe export and source identity', () => {
  const document = { ...emptyNotebook(), pages: [{ id: 'table-page', title: '比较', chapterId: null, doc: { type: 'doc', content: [{ type: 'sourceBlock', attrs: { id: 'table-source', origin }, content: [table] }] } as RichNode }] };
  expect(validateNotebook(document)).toEqual(document);
  expect(richText(table)).toBe('概念\t理解\n概念\t理解');
  expect(searchNotebook(document, '理解')).toHaveLength(1);
  expect(richMarkdown(table)).toContain('<th><p><strong>概念</strong></p></th>');
  const hostile = structuredClone(table); hostile.content![1].content![0].content![0].content![0].text = '<script>&"';
  expect(richMarkdown(hostile)).toContain('&lt;script&gt;&amp;&quot;');
  const changed = structuredClone(document); changed.pages[0].doc.content![0].content![0] = hostile;
  expect(sourceBlocks(markChangedSources(document.pages[0].doc, changed.pages[0].doc))[0].attrs).toMatchObject({ id: 'table-source', origin: { needsReview: true } });
  const sheets = buildLeafSheets(document, 340, { 'table-page:0': 900 });
  expect(sheets).toHaveLength(1); expect(sheets[0].pieces[0].node).toEqual(table);
  const preceding = structuredClone(document); preceding.pages[0].doc.content!.unshift({ type: 'paragraph', content: [{ type: 'text', text: '表格之前的正文' }] });
  const continued = buildLeafSheets(preceding, 340, { 'table-page:0': 80, 'table-page:1': 900 });
  expect(continued).toHaveLength(2); expect(continued[1].pieces[0].node).toEqual(table);
});
it('rejects malformed table rows, cells and span attributes', () => {
  const validate = (node: RichNode) => validateNotebook({ ...emptyNotebook(), pages: [{ id: 'p', title: 't', chapterId: null, doc: { type: 'doc', content: [node] } }] });
  expect(() => validate({ type: 'table', content: [{ type: 'paragraph' }] })).toThrow('表格');
  expect(() => validate({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'text', text: 'x' }] }] })).toThrow('表格');
  const bad = structuredClone(table); bad.content![0].content![0].attrs!.colspan = -1;
  expect(() => validate(bad)).toThrow();
});
it('keeps all list styles through save, pagination and safe formatted export', () => {
  for (const [type, styles] of [['bulletList', ['disc', 'circle', 'square']], ['orderedList', ['decimal', 'lower-alpha', 'lower-roman']]] as const) for (const listStyleType of styles) {
    const list: RichNode = { type, attrs: { listStyleType, ...(type === 'orderedList' ? { start: 7 } : {}) }, content: ['第一条', '第二条'].map(text => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) };
    const page = { id: 'list', title: '列表', chapterId: null, doc: { type: 'doc', content: [list] } };
    expect(validateNotebook({ ...emptyNotebook(), pages: [page] }).pages[0].doc.content![0]).toEqual(list);
    const pieces = readingPieces(page); expect(pieces.every(piece => piece.node.attrs?.listStyleType === listStyleType)).toBe(true);
    if (type === 'orderedList') expect(pieces.map(piece => piece.node.attrs?.start)).toEqual([7, 8]);
    const exported = richMarkdown(list);
    if (listStyleType === 'disc') expect(exported).toBe('- 第一条\n- 第二条');
    else if (listStyleType === 'decimal') expect(exported).toBe('7. 第一条\n8. 第二条');
    else expect(exported).toContain(`style="list-style-type: ${listStyleType}"`);
  }
});
it('preserves merged cell alignment and rejects unsafe style values', () => {
  const merged = structuredClone(table); merged.content![0].content![0].attrs = { colspan: 2, rowspan: 2, align: 'center' }; merged.content![0].content![0].content![0] = { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] }; merged.content![0].content = [merged.content![0].content![0]]; merged.content![1] = { type: 'tableRow' };
  const document = { ...emptyNotebook(), pages: [{ id: 'p', title: 't', chapterId: null, doc: { type: 'doc', content: [merged] } }] };
  expect(validateNotebook(document)).toEqual(document);
  expect(richMarkdown(merged)).toContain('<th colspan="2" rowspan="2" style="text-align: center"><h1>标题</h1></th>');
  merged.content![0].content![0].attrs!.align = 'center; color: red'; expect(() => validateNotebook(document)).toThrow();
  expect(richMarkdown(merged)).not.toContain('color: red');
  document.pages[0].doc.content = [{ type: 'bulletList', attrs: { listStyleType: 'url(evil)' }, content: [] }]; expect(() => validateNotebook(document)).toThrow();
});
it('rejects incomplete rows and overlapping or out of bounds table merges', () => {
  const validate = (node: RichNode) => validateNotebook({ ...emptyNotebook(), pages: [{ id: 'p', title: 't', chapterId: null, doc: { type: 'doc', content: [node] } }] });
  const missing = structuredClone(table); missing.content![1].content!.pop(); expect(() => validate(missing)).toThrow('表格');
  const overflow = structuredClone(table); overflow.content![0].content![0].attrs!.rowspan = 3; expect(() => validate(overflow)).toThrow('表格');
  const overlap = structuredClone(table); overlap.content![0].content![1].attrs!.rowspan = 2; overlap.content![1].content![0].attrs!.colspan = 2; expect(() => validate(overlap)).toThrow('表格');
});
it('treats Tiptap and validated JSON property ordering as the same saved content', () => {
  expect(equalContent({ type: 'text', marks: [{ type: 'bold' }], text: '重点' }, { type: 'text', text: '重点', marks: [{ type: 'bold' }] })).toBe(true);
  expect(equalContent({ text: '我的修改' }, { text: '云端修改' })).toBe(false);
});

it('preserves long Unicode paragraphs and formulas across continuation pages', () => {
  const body = '理解🙂'.repeat(1200) + ' $P(A \\cap B)$ 终点';
  const doc = sourceDocument(body, origin, 'stable-source'), page = { id: 'stable-point', title: '条件概率', chapterId: null, doc };
  const pieces = readingPieces(page);
  expect(pieces.map(piece => richText(piece.node)).join('')).toBe(richText(doc));
  expect(pieces.filter(piece => piece.origin)).toHaveLength(1);
  const sheets = buildLeafSheets({ ...emptyNotebook(), pages: [page] }, 340, {});
  expect(sheets.length).toBeGreaterThan(2);
  expect(sheets.every(sheet => sheet.page.id === 'stable-point')).toBe(true);
  expect(sheets.flatMap(sheet => sheet.pieces).map(piece => richText(piece.node)).join('')).toContain('终点');
  expect(richMarkdown(doc)).toContain('$P(A \\cap B)$');
});
it('keeps Markdown formatting and treats unsupported HTML as text', () => {
  const doc = markdownDocument('# 标题\n\n**加粗**\n\n- 列表\n\n> 引用\n\n$$\nx^2\n$$\n\n<script>内容</script>');
  expect(richMarkdown(doc)).toContain('**加粗**'); expect(richText(doc)).toContain('<script>内容</script>');
  expect(validateNotebook({ ...emptyNotebook(), pages: [{ id: 'p', title: 't', chapterId: null, doc }] }).pages).toHaveLength(1);
});
it('continues long numbered lists with their numbering and source intact', () => {
  const body = Array.from({ length: 25 }, (_, index) => `${index + 7}. 第 ${index + 7} 条知识点。`).join('\n');
  const page = { id: 'list', title: '答题步骤', chapterId: null, doc: sourceDocument(body, origin, 'list-source') };
  const pieces = readingPieces(page);
  expect(pieces.map(piece => piece.node.attrs?.start)).toEqual(Array.from({ length: 25 }, (_, index) => index + 7));
  expect(pieces.filter(piece => piece.origin)).toHaveLength(1);
  expect(buildLeafSheets({ ...emptyNotebook(), pages: [page] }, 340, {}).length).toBeGreaterThan(1);
  expect(richMarkdown(page.doc)).toContain('31. 第 31 条');
});
it('imports legacy knowledge and keeps exam-only summaries in history', () => {
  const version: Version = { id: 'v', courseId: 'course', number: 1, title: '旧提纲', summary: '', createdAt: '', sourceIds: ['source'], sections: [{ id: 'stable-id', title: '已编辑知识点', body: '我的修改 $x$。', refs: origin.refs, edited: true }] };
  expect(notebookFromVersion(version).pages[0].id).toBe('stable-id');
  expect(richMarkdown(notebookFromVersion(version).pages[0].doc)).toBe(version.sections[0].body);
  expect(notebookFromVersion(version, true).pages).toEqual([]);
});
it('keeps AI supplementation distinguishable when importing reviewed and personally edited versions', () => {
  const generation = { provider: 'DeepSeek' as const, model: 'test', draftId: 'concepts-draft', contentOrigin: 'ai-supplement' as const };
  const version: Version = { id: 'v', courseId: 'course', number: 1, title: '概念解释', summary: '', createdAt: '', sourceIds: ['source'], sections: [{ id: 'supplement', title: '汇率', body: 'AI 补充的定义。', refs: origin.refs, generation, edited: true, needsReview: false }] };
  const document = notebookFromVersion(version), imported = sourceBlocks(document.pages[0].doc)[0].attrs?.origin;
  expect(imported).toMatchObject({ generation, needsReview: false, label: 'AI 补充解释 · 个人修订' });
  const exported = exportNotebookMarkdown(validateNotebook(document), '课程');
  expect(exported).toContain('AI 补充解释 · 个人修订');
  expect(exported).toContain('提问出处，非答案依据：');
  expect(exported).toContain('讲义.pdf · 第 2 页');
  expect(exported).toContain('AI 补充的定义。');
  expect(richMarkdown(document.pages[0].doc)).toBe('AI 补充的定义。');
});
it('defaults legacy AI content to source organization while keeping other note origins intact', () => {
  const generation = { provider: 'DeepSeek' as const, model: 'test', draftId: 'legacy' };
  expect(contentOriginLabel(generation)).toBe('原文整理');
  expect(referenceOriginLabel(generation)).toBe('来源');
  expect(notebookOriginLabel({ ...origin, kind: 'ai', label: 'AI 整理 · 个人修订', generation })).toBe('原文整理 · 个人修订');
  expect(notebookOriginLabel(origin)).toBe('讲义摘录');
});
it('retains the server content origin through personal source edits and renewed review', () => {
  const generation = { provider: 'DeepSeek' as const, model: 'test', draftId: 'd', contentOrigin: 'ai-supplement' as const };
  const previous = sourceDocument('AI 的解释。', { ...origin, kind: 'ai', label: 'AI 补充解释', generation }, 'supplement');
  const changed = sourceDocument('我修订的解释。', { ...origin, kind: 'ai', label: '个人内容' }, 'supplement');
  const revised = markChangedSources(previous, changed), revisedOrigin = sourceBlocks(revised)[0].attrs?.origin;
  expect(revisedOrigin).toMatchObject({ generation, needsReview: true });
  expect(exportNotebookMarkdown({ ...emptyNotebook(), pages: [{ id: 'p', title: '概念', chapterId: null, doc: revised }] }, '课程')).toContain('AI 补充解释 · 待核对');
});
it('preserves personal additions and the separate provenance of each batch', () => {
  const first = sourceDocument('第一份资料', origin, 'batch-one'), second = sourceDocument('第二份资料', { ...origin, label: '第二批 AI 整理' }, 'batch-two');
  const combined = appendDocument(appendDocument(first, markdownDocument('我的理解')), second);
  expect(richText(combined)).toContain('我的理解');
  expect(sourceBlocks(combined).map(block => block.attrs?.id)).toEqual(['batch-one', 'batch-two']);
  const changed = structuredClone(combined); changed.content![0].content![0].content![0].text = '修订原资料';
  const checked = markChangedSources(combined, changed);
  expect(sourceBlocks(checked)[0].attrs?.origin).toMatchObject({ needsReview: true });
  expect(sourceBlocks(checked)[1].attrs?.origin).toMatchObject({ needsReview: false });
  expect(sourceBlocks(markChangedSources(checked, changed))[0].attrs?.origin).toMatchObject({ needsReview: true });
});
it('searches the body with its chapter path and matching snippet', () => {
  const document = { ...emptyNotebook(), chapters: [{ id: 'c', title: '现代文阅读' }], pages: [{ id: 'p', title: '论证方法', chapterId: 'c', doc: markdownDocument('一段正文里有类比论证这一知识点。') }] };
  const [result] = searchNotebook(document, '类比');
  expect(result.chapter).toBe('现代文阅读'); expect(result.snippet).toContain('类比论证'); expect(result.page.id).toBe('p');
});
it('rejects duplicate page IDs, missing chapters and unsafe image paths', () => {
  const page = { id: 'p', title: 't', chapterId: null, doc: markdownDocument('内容') };
  expect(() => validateNotebook({ ...emptyNotebook(), pages: [page, page] })).toThrow('重复');
  expect(() => validateNotebook({ ...emptyNotebook(), pages: [{ ...page, chapterId: 'missing' }] })).toThrow('章节');
  expect(() => validateNotebook({ ...emptyNotebook(), pages: [{ ...page, doc: { type: 'doc', content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }] } }] })).toThrow('图片');
});
