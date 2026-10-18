import { hashContent } from './generation';
import type { NotebookDocument } from './notebook';
import type { OriginalQuestion } from './question-bank-types';

export function knowledgePracticeSourceMatches(question: OriginalQuestion, document: NotebookDocument | null) {
  if (!question.knowledgeSource) return true;
  const pages = question.knowledgeSource.pageIds.map(id => document?.pages.find(page => page.id === id));
  return pages.every(Boolean) && hashContent(JSON.stringify(pages)) === question.knowledgeSource.fingerprint;
}
