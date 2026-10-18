export type PracticeArea = 'knowledge' | 'mistakes' | 'papers';
export type PracticeBackAction = { label:string; onClick:()=>void };
export type PracticeActivity = 'sources' | 'file' | 'organize' | 'practice' | 'ai' | 'favorites' | 'mistakes' | 'history' | 'daily' | 'notes' | 'analysis' | 'variants' | 'generated';
export type QuestionRef = { engine: 'original' | 'generated' | 'pdf'; questionId: string; materialId?: string; versionId?: string; setId?: string };
export type QuestionStudyState = { ref: QuestionRef; key: string; revision: number; favorite: boolean; manualWrong: boolean; tags: string[]; note: string; consolidatedAt: string | null };
export type StudyAttempt = { correct: boolean; at: string };
export type StudyQuestion = {
  ref: QuestionRef; key: string; prompt: string; topic: string; sourceName: string; sourceMaterialId?: string; number?: string;
  section: 'knowledge' | 'papers'; origin: 'original' | 'ai' | 'pdf'; available: boolean;
  favorite: boolean; manualWrong: boolean; mistake: boolean; consolidated: boolean; tags: string[]; note: string;
  lastAttempt?: StudyAttempt; dueAt?: string; revision?: number; sourceHash?: string; collected?: boolean; needsAnswer?: boolean; needsReview?: boolean;
};
export type HubMaterial = { id: string; name: string; mime?: string; chapter: string; status: string; available: boolean; questions: number; year: string; answered: number; finished: boolean; stale: boolean; sourceHash?: string; paper?:boolean };
export type HubKnowledge = { id: string; title: string; chapter: string; needsReview: boolean; materialIds?: string[] };
export type HubRecord = { id: string; engine: QuestionRef['engine']; title: string; at: string; section: 'knowledge' | 'papers'; total: number; answered: number; finished: boolean; materialId?: string; versionId?: string; setId?: string; taskId?: string };
export type DailyGroup = { id: string; engine: QuestionRef['engine']; refs: QuestionRef[]; title: string; context: 'knowledge' | 'paper'; materialId?: string; versionId?: string; scope?: string; roundId?: string; finished?: boolean; sourceHash?: string };
export type DailyTask = { id: string; courseId: string; section: PracticeArea; day: string; groups: DailyGroup[]; createdAt: string };
export type PracticeHubSummary = { courseId: string; courseName: string; section: PracticeArea; day: string; configured: boolean; materials: HubMaterial[]; knowledge: HubKnowledge[]; catalog: StudyQuestion[]; records: HubRecord[]; daily: DailyTask | null; dailyCount: number; recommendation: string | null; withheldMaterials?: string[]; withheldVersions?: string[] };
export type PracticeLocation = { section: PracticeArea | 'overview'; activity: PracticeActivity | null; materialId?: string; question?: string; legacy?: boolean; variant?: boolean; scope?: string; task?: string; versionId?: string; setId?: string; pageId?: string; fromFile?: boolean };

const activities: PracticeActivity[] = ['sources', 'file', 'organize', 'practice', 'ai', 'favorites', 'mistakes', 'history', 'daily', 'notes', 'analysis', 'variants', 'generated'];
export function parsePracticeLocation(params: URLSearchParams): PracticeLocation {
  const raw = params.get('section'), section = params.get('view') === 'exam' ? 'papers' : raw === 'knowledge' || raw === 'mistakes' || raw === 'papers' ? raw : 'overview';
  const activity = params.get('activity');
  const location: PracticeLocation = { section, activity: activities.includes(activity as PracticeActivity) ? activity as PracticeActivity : params.has('paper') ? 'practice' : null };
  for (const [key, value] of [['materialId', 'paper'], ['question', 'question'], ['scope', 'scope'], ['task', 'task'], ['versionId', 'version'], ['setId', 'set'], ['pageId', 'page']] as const) {
    const item = params.get(value); if (item) location[key] = item;
  }
  if (params.get('legacy') === '1') location.legacy = true;
  if (params.get('variant') === '1') location.variant = true;
  if (params.get('from') === 'file') location.fromFile = true;
  return location;
}
export function practiceLocation(courseId: string, location: PracticeLocation): string {
  const params = new URLSearchParams({ course: courseId, view: 'practice' });
  if (location.section !== 'overview') params.set('section', location.section);
  if (location.activity) params.set('activity', location.activity);
  for (const [key, value] of [['materialId', 'paper'], ['question', 'question'], ['scope', 'scope'], ['task', 'task'], ['versionId', 'version'], ['setId', 'set'], ['pageId', 'page']] as const) if (location[key]) params.set(value, location[key]!);
  if (location.legacy) params.set('legacy', '1');
  if (location.variant) params.set('variant', '1');
  if (location.fromFile) params.set('from', 'file');
  return '/?' + params.toString();
}
export const questionRefKey = (ref: QuestionRef): string => JSON.stringify([ref.engine, ref.questionId, ref.materialId || '', ref.versionId || '', ref.setId || '']);
export function mistakeFiles(catalog: StudyQuestion[], materials: HubMaterial[]) {
  const groups = new Map<string, { id: string; materialId?: string; name: string; questions: StudyQuestion[] }>();
  for (const question of catalog.filter(question => question.mistake || question.consolidated)) {
    const matching = materials.filter(material => material.name === question.sourceName);
    const materialId = question.ref.materialId ?? question.sourceMaterialId ?? (matching.length === 1 ? matching[0].id : undefined);
    const id = materialId ?? `source:${question.sourceName}`;
    let group = groups.get(id);
    if (!group) { group = { id, materialId, name: materials.find(material => material.id === materialId)?.name ?? question.sourceName, questions: [] }; groups.set(id, group); }
    group.questions.push(question);
  }
  return [...groups.values()];
}
export function collectedPracticeFiles(summary: PracticeHubSummary) {
  return summary.materials.filter(material => material.available && material.status !== 'conflict').map(material => ({
    material,
    knowledge: summary.knowledge.filter(page => !page.needsReview && page.materialIds?.includes(material.id)),
    questions: summary.catalog.filter(question => question.ref.engine === 'original' && question.ref.materialId === material.id && question.section === 'knowledge' && question.available && question.collected && !question.needsReview),
  })).filter(file => file.knowledge.length || file.questions.length);
}
export function beijingDay(now = new Date()): string { return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
export function studyStatus(state: Pick<QuestionStudyState, 'favorite' | 'manualWrong' | 'tags' | 'note' | 'consolidatedAt'> | undefined, attempt: StudyAttempt | undefined, now: string) {
  const consolidated = !!state?.consolidatedAt && (!attempt || attempt.correct || state.consolidatedAt >= attempt.at);
  const mistake = !consolidated && (!!state?.manualWrong || attempt?.correct === false);
  const dueAt = state?.manualWrong && !consolidated ? now : attempt ? new Date(new Date(attempt.at).getTime() + (attempt.correct ? 3 : 1) * 86400000).toISOString() : undefined;
  return { favorite: state?.favorite ?? false, manualWrong: state?.manualWrong ?? false, tags: state?.tags ?? [], note: state?.note ?? '', mistake, consolidated, ...(attempt ? { lastAttempt: attempt } : {}), ...(dueAt ? { dueAt } : {}) };
}
export function selectDailyQuestions(pool: StudyQuestion[], section: Exclude<PracticeArea, 'papers'>, now = new Date()): StudyQuestion[] {
  const eligible = pool.filter(q => q.available && (section === 'knowledge' ? q.section === 'knowledge' : q.mistake));
  const due = eligible.filter(q => q.dueAt && q.dueAt <= now.toISOString()).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  const unpracticed = eligible.filter(q => !q.lastAttempt && !due.includes(q));
  return [...due, ...unpracticed].slice(0, 5);
}
