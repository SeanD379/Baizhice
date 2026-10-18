import { NextResponse } from 'next/server';
import { z } from 'zod';
import { appendOriginalQuestions, loadOriginalSession, originalFeedback, originalPracticeHistory, originalStateSchema, restartOriginalSession, resumeOriginalSession, saveOriginalSession, switchOriginalMode,refreshOriginalSessionAnswers } from './original-practice-store';
const id = z.string().min(1).max(300), course = z.string().min(1).max(100), revision = z.number().int().positive();
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('original-load'), courseId: course, context: z.enum(['paper', 'knowledge']), questionIds: z.array(id).max(5000), mode: z.enum(['practice', 'exam', 'memorize']), newRound: z.boolean().optional(), scope: id.optional(), readyOnly: z.boolean().optional() }),
  z.object({ action: z.literal('original-save'), courseId: course, scope: id, revision, session: originalStateSchema }),
  z.object({ action: z.literal('original-restart'), courseId: course, scope: id, revision, mode: z.enum(['practice', 'exam', 'memorize']) }),
  z.object({ action: z.literal('original-mode'), courseId: course, scope: id, revision, mode: z.enum(['practice', 'exam', 'memorize']) }),
  z.object({ action: z.literal('original-append'), courseId: course, scope: id, revision, questionIds: z.array(id).min(1).max(5) }),
  z.object({ action: z.literal('original-feedback'), courseId: course, scope: id, revision, questionId: id, confirmed: z.literal(true) }),
  z.object({action:z.literal('original-refresh-answers'),courseId:course,scope:id,revision,session:originalStateSchema.optional()}),
]);
export async function originalPracticeAction(body: unknown) {
  const input = schema.parse(body);
  if (input.action === 'original-load') return NextResponse.json(input.scope ? await resumeOriginalSession(input.courseId, input.scope) : await loadOriginalSession(input.courseId, input.context, input.questionIds, input.mode, input.newRound, undefined, input.readyOnly));
  if (input.action === 'original-save') return NextResponse.json(await saveOriginalSession(input.courseId, input.scope, input.revision, input.session));
  if (input.action === 'original-restart') return NextResponse.json(await restartOriginalSession(input.courseId, input.scope, input.revision, input.mode));
  if (input.action === 'original-mode') return NextResponse.json(await switchOriginalMode(input.courseId, input.scope, input.revision, input.mode));
  if (input.action === 'original-append') return NextResponse.json(await appendOriginalQuestions(input.courseId, input.scope, input.revision, input.questionIds));
  if(input.action==='original-refresh-answers')return NextResponse.json(await refreshOriginalSessionAnswers(input.courseId,input.scope,input.revision,input.session));
  return NextResponse.json(await originalFeedback(input.courseId, input.scope, input.revision, input.questionId));
}
export async function originalPracticeGet(courseId: string) { return NextResponse.json(await originalPracticeHistory(course.parse(courseId))); }
