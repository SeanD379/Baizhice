import type { PracticeHistoryData } from './practice-history';
import type { Question } from './practice';

export type KnowledgeMistake = { question: Question; at: string; versionNumber: number };

export function knowledgeMistakes(history: PracticeHistoryData): KnowledgeMistake[] {
  const latest = new Map<string, KnowledgeMistake & { correct: boolean }>();
  for (const entry of history.entries) {
    if (entry.withheld || entry.snapshot === 'missing' || !entry.session) continue;
    const questions = new Map(entry.questions.map(question => [question.id, question]));
    for (const attempt of entry.session.state.attempts) {
      const question = questions.get(attempt.id);
      if (!question || (latest.get(question.id)?.at ?? '') >= attempt.at) continue;
      latest.set(question.id, { question, at: attempt.at, correct: attempt.correct, versionNumber: entry.version.number });
    }
  }
  return [...latest.values()].filter(item => !item.correct).sort((a, b) => b.at.localeCompare(a.at));
}
