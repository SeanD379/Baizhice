import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePrivateAccess } from '@/lib/private-access';
import { db } from '@/lib/db';
import { checkOrigin, errorResponse } from '@/lib/server';
import { deepSeekConfig } from '@/lib/deepseek';
import { generateOriginalVariants, listQuestionBanks, prepareQuestionBanks, reviseBankQuestion, splitOrMergeQuestion, startBankAnalysis, supplementQuestionAnswers } from '@/lib/question-bank-store';
import { ensureOriginalAnswer } from '@/lib/question-bank-store';
import { queueMaterialImport,questionImportReports } from '@/lib/material-auto-import';
import { generateKnowledgePractice, reviewKnowledgePractice } from '@/lib/knowledge-practice-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const id = z.string().min(1).max(300), course = z.string().min(1).max(100);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare'), courseId: course, materialIds: z.array(id).min(1).max(100) }),
  z.object({ action: z.literal('analyze'), courseId: course, materialIds: z.array(id).min(1).max(100), questionIds: z.array(id).max(5000).optional(), confirmed: z.literal(true) }),
  z.object({ action: z.literal('variants'), courseId: course, bankId: id, questionId: id, count: z.number().int().min(1).max(5).optional(), confirmed: z.literal(true) }),
  z.object({ action: z.literal('supplement'), courseId: course, bankId: id, answerMaterialId: id }),
  z.object({ action: z.literal('auto-import'), courseId: course, materialIds:z.array(id).min(1).max(100), read:z.boolean().optional() }),
  z.object({ action: z.literal('ensure-answer'), courseId:course,bankId:id,questionId:id,confirmed:z.literal(true),retry:z.boolean().optional() }),
  z.object({ action: z.literal('generate-knowledge'), courseId: course, materialId: id, pageIds: z.array(id).min(1).max(12), count: z.number().int().min(1).max(5).default(5), confirmed: z.literal(true) }),
  z.object({ action: z.literal('review-knowledge'), courseId: course, bankId: id, revision: z.number().int().positive(), questionIds: z.array(id).min(1).max(5) }),
]);
const changes = z.object({ prompt: z.string().min(1).max(8000).optional(), context: z.string().max(40000).optional(), kind: z.enum(['single', 'multiple', 'judge', 'fill', 'term', 'short', 'calculation', 'essay', 'unknown']).optional(), options: z.array(z.object({ label: z.string().regex(/^[A-H]$/), text: z.string().max(4000) })).max(8).optional(), topics: z.array(z.string().min(1).max(80)).max(6).optional(), answer: z.string().max(8000).optional(), explanation: z.string().max(8000).optional(), criteria: z.array(z.string().max(1000)).max(12).optional() });
export async function GET(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try { checkOrigin(request); const courseId = course.parse(new URL(request.url).searchParams.get('courseId')); return NextResponse.json({ banks: await listQuestionBanks(courseId),imports:await questionImportReports(courseId), ...deepSeekConfig() },{headers:{'Cache-Control':'no-store'}}); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request); const input = schema.parse(await request.json());
    if (input.action === 'generate-knowledge') return NextResponse.json(await generateKnowledgePractice(input.courseId, input.materialId, input.pageIds, input.count));
    if (input.action === 'review-knowledge') return NextResponse.json({ bank: await reviewKnowledgePractice(input.courseId, input.bankId, input.revision, input.questionIds) });
    if(input.action==='auto-import'){const materials=await db.material.findMany({where:{courseId:input.courseId,id:{in:input.materialIds},excluded:false,status:{not:'review'},conflictResolution:null}});if(materials.length!==new Set(input.materialIds).size)throw new Error('所选资料不可用于导入。');for(const material of materials)queueMaterialImport(material.id,input.read);return NextResponse.json({status:'processing',imports:await questionImportReports(input.courseId)},{status:202});}
    if(input.action==='ensure-answer')return NextResponse.json({bank:await ensureOriginalAnswer(input.courseId,input.bankId,input.questionId,input.retry),...deepSeekConfig()},{status:202});
    if (input.action === 'prepare') return NextResponse.json({ banks: await prepareQuestionBanks(input.courseId, input.materialIds), ...deepSeekConfig() });
    if (input.action === 'analyze') { const banks = await listQuestionBanks(input.courseId); if (input.materialIds.some(id => !banks.some(bank => bank.materialId === id && !bank.stale))) throw new Error('请先读取所选资料的完整原题。'); if (!deepSeekConfig().configured) throw new Error('尚未配置 AI 助手。'); startBankAnalysis(input.courseId, input.materialIds, input.questionIds); return NextResponse.json({ status: 'processing', banks: banks.map(bank => input.materialIds.includes(bank.materialId) ? { ...bank, state: 'processing' } : bank), ...deepSeekConfig() }); }
    if (input.action === 'supplement') return NextResponse.json({ bank: await supplementQuestionAnswers(input.courseId, input.bankId, input.answerMaterialId) });
    return NextResponse.json({ bank: await generateOriginalVariants(input.courseId, input.bankId, input.questionId, input.count) });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const input = z.object({ courseId: course, bankId: id, revision: z.number().int().positive(), questionId: id, action: z.enum(['edit', 'merge', 'split']).default('edit'), changes: changes.optional(), parts: z.array(z.string().min(1).max(8000)).min(2).max(10).optional() }).parse(await request.json());
    const bank = input.action === 'edit' ? await reviseBankQuestion(input.courseId, input.bankId, input.revision, input.questionId, input.changes ?? {}) : await splitOrMergeQuestion(input.courseId, input.bankId, input.revision, input.questionId, input.action, input.parts);
    return NextResponse.json({ bank });
  } catch (error) { return errorResponse(error); }
}
