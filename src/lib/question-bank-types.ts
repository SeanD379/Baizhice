import type { Reference } from './types';
export type OriginalKind = 'single' | 'multiple' | 'judge' | 'fill' | 'term' | 'short' | 'calculation' | 'essay' | 'unknown';
export type AnswerSource = 'original' | 'supplement' | 'manual' | 'ai' | 'none';
export type OriginalMode = 'practice' | 'exam' | 'memorize';
export type OriginalSource = { page: number; name: string; snippet: string; location: 'page' | 'paragraph' | 'slide' };
export type OriginalQuestion = {
  id: string; materialId: string; number: string; section: string; kind: OriginalKind;
  prompt: string; context: string; options: { label: string; text: string }[];
  sources: OriginalSource[]; topics: string[]; answer: string; answerSource: AnswerSource;
  explanation: string; criteria: string[]; warnings: string[]; origin: 'original' | 'variant';
  explanationSource?: 'ai';
  media?: { url: string; label: string }[];
  answerRefs?: Reference[];
  answerGeneration?: { state: 'queued' | 'running' | 'ready' | 'failed'; error?: string };
  practiceArea?: 'knowledge'|'papers';
  practiceReview?: 'pending'|'approved';
  knowledgeSource?: { pageIds: string[]; fingerprint: string };
  knowledgeSourceStale?: boolean;
};
export type QuestionBankData = {
  id: string; materialId: string; name: string; sourceHash: string; revision: number; materialHash?:string;
  state: 'raw' | 'processing' | 'ready' | 'partial'; questions: OriginalQuestion[];
  progress: { done: number; total: number }; error: string; updatedAt: string; stale?: boolean;
};
export type OriginalResult = { answer: string; correct: boolean | null; source: AnswerSource | 'self'; judgedAt?: string; feedback?: { strengths: string[]; omissions: string[]; suggestions: string[]; uncertainty: string[] } };
export type OriginalSessionState = {
  roundId: string; mode: OriginalMode; ids: string[]; index: number;
  answers: Record<string, string>; results: Record<string, OriginalResult>;
  submitted: boolean; finished: boolean;
};
export type OriginalSessionData = {
  scope: string; revision: number; context: 'knowledge' | 'paper';
  questions: OriginalQuestion[]; session: OriginalSessionState;
  rounds: { id: string; createdAt: string; questions: OriginalQuestion[]; session: OriginalSessionState }[];
};
export const originalKindNames: Record<OriginalKind, string> = { single: '单选题', multiple: '多选题', judge: '判断题', fill: '填空题', term: '名词解释', short: '简答题', calculation: '计算题', essay: '写作', unknown: '待确认题型' };
