import { requirePrivateAccess } from '@/lib/private-access';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { emptyExamRecord, examRecordSchema } from '@/lib/exam-record';
import { checkOrigin, errorResponse } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ids = z.object({ courseId: z.string().min(1).max(100), materialId: z.string().min(1).max(100) });
const saveSchema = ids.extend({ revision: z.number().int().nonnegative(), record: examRecordSchema });

async function examMaterial(courseId: string, materialId: string) {
  const material = await db.material.findFirst({ where: { id: materialId, courseId } });
  if (!material || material.chapter !== '历年套卷' || material.mime !== 'application/pdf') throw new Error('这份套卷不存在或已移出套卷分类。');
  return material;
}

export async function GET(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const input = ids.parse(Object.fromEntries(new URL(request.url).searchParams));
    await examMaterial(input.courseId, input.materialId);
    const saved = await db.examRecord.findUnique({ where: { materialId: input.materialId } });
    return NextResponse.json({ revision: saved?.revision ?? 0, record: saved ? examRecordSchema.parse(JSON.parse(saved.content)) : emptyExamRecord() });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const input = saveSchema.parse(await request.json());
    if (JSON.stringify(input.record).length > 600000) throw new Error('这份试卷的批注已经太多，请先擦除不需要的笔画再继续保存。');
    await examMaterial(input.courseId, input.materialId);
    if (input.revision === 0) {
      const existing = await db.examRecord.findUnique({ where: { materialId: input.materialId } });
      if (existing) throw new Error('另一页面已保存作答，请刷新后继续。');
      await db.examRecord.create({ data: { materialId: input.materialId, content: JSON.stringify(input.record) } });
    } else {
      const result = await db.examRecord.updateMany({ where: { materialId: input.materialId, revision: input.revision }, data: { content: JSON.stringify(input.record), revision: { increment: 1 } } });
      if (result.count !== 1) throw new Error('另一页面已保存作答，请刷新后继续。');
    }
    return NextResponse.json({ revision: input.revision + 1 });
  } catch (error) { return errorResponse(error); }
}
