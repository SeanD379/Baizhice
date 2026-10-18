import { requirePrivateAccess } from '@/lib/private-access';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { applyEdits, generateSections, mergeAdditions, topicsForCourse } from '@/lib/content';
import { checkOrigin, errorResponse, publicMaterial, publicVersion } from '@/lib/server';
import type { Section } from '@/lib/types';

const base = { courseId: z.string(), expectedVersionId: z.string().nullable() };
const schema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('generate'), materialIds: z.array(z.string()).min(1).max(100), topics: z.array(z.enum(['conditional','independence'])).min(1) }),
  z.object({ ...base, action: z.literal('save'), edits: z.array(z.object({ id: z.string(), body: z.string().trim().min(1).max(100000) })).min(1).max(30) }),
  z.object({ ...base, action: z.literal('update'), chosenIds: z.array(z.string()).min(1).max(20) }),
  z.object({ ...base, action: z.literal('confirm-refs'), sectionId: z.string() }),
]);
export async function POST(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const input = schema.parse(await request.json());
    const saved = await db.$transaction(async tx => {
      const latest = await tx.version.findFirst({ where: { courseId: input.courseId }, orderBy: { number: 'desc' } });
      if ((latest?.id ?? null) !== input.expectedVersionId) throw new Error('已有更新版本。请刷新并对照最新内容后重试，当前编辑不会被覆盖。');
      const materials = (await tx.material.findMany({ where: { courseId: input.courseId } })).map(publicMaterial);
      let sections: Section[], summary: string;
      if (input.action === 'generate') {
        if (latest) throw new Error('该课程已有复习提纲。请在原提纲上编辑或采用新增内容。');
        if (input.topics.some(topic => !topicsForCourse(input.courseId, materials).includes(topic))) throw new Error('复习章节与当前课程不匹配。');
        sections = generateSections(materials, input.materialIds, input.topics);
        summary = '根据所选中文演示资料创建提纲';
      } else {
        if (!latest) throw new Error('请先生成复习提纲。');
        const existing = JSON.parse(latest.content) as Section[];
        if (input.action === 'save') {
          sections = applyEdits(existing, input.edits); summary = '保存个人编辑，引用等待重新核对';
        } else if (input.action === 'confirm-refs') {
          if (!existing.some(s => s.id === input.sectionId && s.needsReview)) throw new Error('该段落无需重新核对。');
          sections = existing.map(s => s.id === input.sectionId ? { ...s, needsReview: false } : s);
          summary = '用户确认已重新核对修改段落的引用';
        } else {
          const eligible = materials.filter(m => !m.excluded && m.status === 'ready' && m.fixture);
          const candidates = generateSections(eligible, eligible.map(m => m.id), topicsForCourse(input.courseId, materials));
          sections = mergeAdditions(existing, candidates, input.chosenIds);
          summary = `新增 ${sections.length - existing.length} 个知识点或例题，保留现有编辑`;
        }
      }
      const sourceIds = [...new Set(sections.flatMap(s => s.refs.map(r => r.materialId)))];
      return tx.version.create({ data: { courseId: input.courseId, number: (latest?.number ?? 0) + 1, title: topicsForCourse(input.courseId, materials).includes('conditional') ? '期末复习提纲' : '学习之道 · 复习提纲', content: JSON.stringify(sections), sourceIds: JSON.stringify(sourceIds), summary } });
    });
    return NextResponse.json(publicVersion(saved));
  } catch (error) { return errorResponse(error); }
}
