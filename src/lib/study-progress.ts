import type { PracticeSession } from './practice-session';

const day = 24 * 60 * 60 * 1000;
export function studyProgress(session: PracticeSession | null, questionIds: string[], now: number) {
  const available = new Set(questionIds);
  const latest = new Map<string, { id: string; correct: boolean; at: string }>();
  for (const attempt of session?.attempts ?? []) {
    const time = Date.parse(attempt.at);
    if (!available.has(attempt.id) || !Number.isFinite(time) || time > now) continue;
    const previous = latest.get(attempt.id);
    if (!previous || time >= Date.parse(previous.at)) latest.set(attempt.id, attempt);
  }
  const reviews = [...latest.values()].map(a => ({ ...a, dueAt: Date.parse(a.at) + (a.correct ? 3 : 1) * day })).sort((a, b) => a.dueAt - b.dueAt);
  const recent = [...latest.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const continuing = !!session && !session.finished && !!session.ids.length && available.has(session.ids[session.index]);
  return { attempted: latest.size, reviews, due: reviews.filter(a => a.dueAt <= now), recent, continuing };
}
