import type { Prisma } from '@prisma/client';
import { db } from './db';

type OriginalRow = { content: string };
type GeneratedRow = { content: string; versionId: string };
type VersionRow = { id: string; sourceIds: string };
const inExam = (session: { mode?: string; submitted?: boolean; finished?: boolean }) => session.mode === 'exam' && !session.submitted && !session.finished;

export function examProtection(original: OriginalRow[], generated: GeneratedRow[], versions: VersionRow[]) {
  const withheldVersions = [...new Set(generated.filter(row => inExam(JSON.parse(row.content))).map(row => row.versionId))];
  const withheldMaterials = [...new Set([
    ...original.flatMap(row => { const saved = JSON.parse(row.content) as { session: { mode?: string; submitted?: boolean; finished?: boolean }; questions: { materialId: string }[] }; return inExam(saved.session) ? saved.questions.map(question => question.materialId) : []; }),
    ...versions.filter(version => withheldVersions.includes(version.id)).flatMap(version => JSON.parse(version.sourceIds) as string[]),
  ])];
  return { withheldMaterials, withheldVersions };
}

export async function readExamProtection(courseId: string, client: Pick<Prisma.TransactionClient, 'originalPracticeSession' | 'practiceSession' | 'version'> = db) {
  const [original, generated, versions] = await Promise.all([
    client.originalPracticeSession.findMany({ where: { courseId }, select: { content: true } }),
    client.practiceSession.findMany({ where: { courseId }, select: { content: true, versionId: true } }),
    client.version.findMany({ where: { courseId }, select: { id: true, sourceIds: true } }),
  ]);
  return examProtection(original, generated, versions);
}
