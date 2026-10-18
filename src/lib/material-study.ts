import { z } from 'zod';
import type { Reference, Section } from './types';
import { headingKind } from './question-bank';
import type { OriginalQuestion } from './question-bank-types';

export type StudyPreset = 'notes' | 'concepts' | 'compare' | 'qa';
export const studyPresets: Record<StudyPreset, { label: string; description: string }> = {
  notes: { label: '知识点笔记', description: '按知识点归纳概念、适用条件与原文已有例子。' },
  concepts: { label: '补充概念解释', description: '为选中的概念补充解释，标注 AI 补充，审核后再收录。' },
  compare: { label: '对比辨析', description: '依据选中原文，对比概念的相同点、区别与适用条件。' },
  qa: { label: '复习问答', description: '把选中原文整理成复习问题与有出处的答案。' },
};
export const studyPresetSchema = z.enum(['notes', 'concepts', 'compare', 'qa']);
export const studyDestinationSchema=z.enum(['notebook','practice','mistakes','papers']);
export type StudyDestination=z.infer<typeof studyDestinationSchema>;
export const studyDestinationNames:Record<StudyDestination,string>={notebook:'活页笔记',practice:'知识点巩固',mistakes:'错题复盘',papers:'套卷练习'};

export const annotationRectSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).refine(rect => rect.x + rect.width <= 1.001 && rect.y + rect.height <= 1.001, '批注范围超出原文件。');
export const annotationAnchorSchema = z.object({ kind: z.enum(['text', 'region']), page: z.number().int().positive().optional(), displayPage: z.number().int().positive().optional(), quote: z.string().max(16000), prefix: z.string().max(160).default(''), suffix: z.string().max(160).default(''), rects: z.array(annotationRectSchema).max(100).default([]), recognition: z.object({ sourceText: z.string().max(16000), ocrText: z.string().max(16000), confidence: z.number().min(0).max(100) }).optional() });
export type AnnotationAnchor = z.infer<typeof annotationAnchorSchema>;
export type PreviewSelection = AnnotationAnchor & { image?: string };
export type MaterialAnnotation = { id: string; materialId: string; courseId: string; name: string; sourceHash: string; extractionHash: string; anchor: AnnotationAnchor; refs: Reference[]; instruction: string; confirmedText: boolean; revision: number; createdAt: string; updatedAt: string; stale?: boolean; hasImage?: boolean };
export type StudyCandidate = Section & { destination?: StudyDestination; question?: OriginalQuestion; practice?: {materialId:string;questionId:string;section?:'knowledge'|'mistakes'|'papers'}; excluded?: boolean; review: 'pending' | 'approved' | 'adopted'; adopted?: { pageId: string; pageTitle: string; chapterTitle: string }[] };
export const studyDestination=(section:Pick<StudyCandidate,'destination'|'question'>):StudyDestination=>section.destination??(section.question?'practice':'notebook');
export type MaterialStudyTask = { id: string; courseId: string; revision: number; mode: 'material' | 'annotations'; routing?: 'auto'; preset?: StudyPreset; materialIds: string[]; annotationIds: string[]; state: 'queued' | 'running' | 'ready' | 'partial' | 'failed'; done: number; total: number; sections: StudyCandidate[]; warnings: string[]; error: string; createdAt: string; updatedAt: string; stale?: boolean; withheld?: boolean };
export type StudyTarget = { sectionId: string; pageId?: string; chapterId?: string; chapterTitle?: string };
export const studyEditsSchema = z.array(z.object({ id: z.string().min(1), title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(80000), excluded: z.boolean().optional(), destination:studyDestinationSchema.optional(), question:z.object({prompt:z.string().trim().min(1).max(40000),answer:z.string().max(8000),explanation:z.string().max(8000)}).optional() })).min(1).max(2000);
export function studyQuestionBody(question:Pick<OriginalQuestion,'context'|'prompt'|'options'|'answer'|'explanation'>){return [question.context&&`【材料】${question.context}`,`【题目】${question.prompt}`,...question.options.map(option=>`${option.label}. ${option.text}`),`【答案】${question.answer||'原文未提供答案'}`,question.explanation&&`【解析】${question.explanation}`].filter(Boolean).join('\n');}
export const normalizeQuote = (text: string) => text.replace(/\s+/g, '');
export function conceptReferences(title: string, refs: Reference[]): Reference[] {
  const terms = refs.map(ref => {
    if (ref.location === 'image' || /[\n。，；：!?！？【】]/.test(ref.snippet)) return '';
    const term = normalizeQuote(ref.snippet.replace(/^\s*\d+[.．、)）]?\s*/, ''));
    return /^[\p{L}][\p{L}\p{N}（）()\-]{1,39}$/u.test(term) ? term : '';
  });
  const topic = normalizeQuote(title), matches = terms.map(term => !!term && topic.includes(term));
  // Longer explanatory excerpts cannot be attributed by a term alone.
  if (!matches.some(Boolean)) return refs;
  return refs.filter((_, index) => !terms[index] || matches[index]).map(ref => {
    const anchor = ref.anchor, start = anchor?.quote.indexOf(ref.snippet) ?? -1;
    if (ref.location !== 'paragraph' || !anchor || start < 0 || anchor.quote === ref.snippet) return ref;
    return { ...ref, anchor: { ...anchor, quote: ref.snippet, prefix: ((anchor.prefix ?? '') + anchor.quote.slice(0, start)).slice(-160), suffix: (anchor.quote.slice(start + ref.snippet.length) + (anchor.suffix ?? '')).slice(0, 160), rects: [] } };
  });
}
export const supplementOutputSchema = z.object({
  sections: z.array(z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(8000), annotationIds: z.array(z.string().min(1).max(300)).min(1).max(8) })).max(12),
  warnings: z.array(z.string().min(1).max(1000)).max(20),
});
export function validateSupplementOutput(input: unknown, annotations: { id: string; refs: Reference[] }[], model: string, draftId: string, concepts = false): { sections: Section[]; warnings: string[] } {
  const parsed = supplementOutputSchema.safeParse(input);
  if (!parsed.success) throw new Error('补充解释格式不完整，未保存，请重试。');
  const available = new Map(annotations.map(annotation => [annotation.id, annotation])), seen = new Set<string>();
  const sections = parsed.data.sections.map((section, index): Section => {
    if (new Set(section.annotationIds).size !== section.annotationIds.length || section.annotationIds.some(id => !available.get(id)?.refs.length)) throw new Error('补充解释引用了未选中的批注，未保存，请重新选择。');
    const key = JSON.stringify([section.title, [...section.annotationIds].sort()]);
    if (seen.has(key)) throw new Error('补充解释包含重复段落，未保存，请重试。');
    seen.add(key);
    const refs = [...new Map(section.annotationIds.flatMap(id => available.get(id)!.refs).map(ref => [JSON.stringify(ref), ref])).values()];
    return { id: `supplement-${index}`, title: section.title, body: section.body, refs: concepts ? conceptReferences(section.title, refs) : refs, needsReview: true, generation: { provider: 'DeepSeek', model, draftId, contentOrigin: 'ai-supplement' } };
  });
  return { sections, warnings: parsed.data.warnings };
}
export function questionOnlyContent(pages: {page:number;text:string}[], questions: OriginalQuestion[]) {
  if (!questions.length || questions.some(question => question.explanation.trim())) return false;
  return pages.every(page => {
    if (headingKind(page.text.trim())) return true;
    let remaining = normalizeQuote(page.text);
    const snippets = questions.flatMap(question => question.sources.filter(source => source.page === page.page).map(source => normalizeQuote(source.snippet))).sort((a,b) => b.length-a.length);
    for (const snippet of snippets) remaining = remaining.replace(snippet, '');
    return remaining.replace(/[\d\s.,，。．、:：;；()（）\[\]【】\-—]/g, '').length < 8;
  });
}

export function knowledgeBatches<T extends { text: string }>(pages: T[]): T[][] {
  const batches: T[][] = []; let batch: T[] = [], length = 0;
  const complete = pages.flatMap(page => {
    if (page.text.length <= 40000) return [page];
    const parts: T[] = []; let remaining = page.text;
    while (remaining.length > 40000) {
      const boundary = Math.max(remaining.lastIndexOf('\n', 39999), remaining.lastIndexOf('。', 39999));
      const end = boundary >= 20000 ? boundary + 1 : 40000;
      parts.push({ ...page, text: remaining.slice(0, end) }); remaining = remaining.slice(end);
    }
    if (remaining) parts.push({ ...page, text: remaining });
    return parts;
  });
  for (const page of complete) {
    if (batch.length && (batch.length >= 20 || length + page.text.length > 40000)) { batches.push(batch); batch = []; length = 0; }
    batch.push(page); length += page.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function mergeStudyCandidates(current: StudyCandidate[], incoming: (Section & Partial<StudyCandidate>)[]): StudyCandidate[] {
  const next = current.map(section => ({ ...section, refs: [...section.refs] }));
  for (const section of incoming) {
    const same = next.find(item => item.destination===section.destination&&normalizeQuote(item.title) === normalizeQuote(section.title) && normalizeQuote(item.body) === normalizeQuote(section.body) && item.review !== 'adopted');
    if (same) { same.refs = [...new Map([...same.refs, ...section.refs].map(ref => [`${ref.materialId}:${ref.page}:${ref.snippet}:${JSON.stringify(ref.anchor??null)}`, ref])).values()]; same.review = 'pending'; }
    else next.push({ ...section, review: 'pending' });
  }
  return next;
}
