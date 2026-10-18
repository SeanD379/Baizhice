import { requirePrivateAccess } from '@/lib/private-access';
import { privateCloudEnabled } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db, dataDir } from '@/lib/db';
import { extractMaterial } from '@/lib/extraction';
import { checkOrigin, digest, errorResponse, publicMaterial, publicVersion, sampleBytes } from '@/lib/server';
import { chineseDemoCourseId, chineseExamInfo, sampleInfo, type ChineseExamKey, type SampleKey } from '@/lib/content';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    await db.course.upsert({ where: { id: 'probability' }, create: { id: 'probability', name: '概率论与数理统计' }, update: {} });
    await db.course.upsert({ where: { id: chineseDemoCourseId }, create: { id: chineseDemoCourseId, name: '高中语文 · 学习之道' }, update: {} });
    const [courses, materials, folders, versions] = await Promise.all([
      db.course.findMany({ orderBy: { createdAt: 'asc' } }),
      db.material.findMany({ orderBy: { createdAt: 'asc' } }),
      db.folder.findMany({ orderBy: { createdAt: 'asc' } }),
      db.version.findMany({ orderBy: { createdAt: 'desc' } }),
    ]);
    return NextResponse.json({ courses, materials: materials.map(publicMaterial), folders, versions: versions.map(publicVersion), privateCloud: privateCloudEnabled() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create-course'), name: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal('import-samples'), courseId: z.string(), group: z.enum(['core', 'supplement']) }),
]);
export async function POST(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const input = schema.parse(await request.json());
    if (input.action === 'create-course') return NextResponse.json(await db.course.create({ data: { name: input.name } }));
    if (!await db.course.findUnique({ where: { id: input.courseId } })) throw new Error('课程不存在。');
    const chinese = input.courseId === chineseDemoCourseId;
    const keys = chinese
      ? input.group === 'core' ? ['2023-new-i', '2024-new-i', '2024-new-ii'] : []
      : input.group === 'core' ? ['conditional', 'independence', 'note'] : ['exercises'];
    let imported = 0;
    for (const key of keys) {
      const bytes = chinese
        ? await readFile(path.join(process.cwd(), 'assets', 'exams', `${key}.pdf`))
        : await sampleBytes(key as SampleKey);
      const hash = digest(bytes);
      if (await db.material.findUnique({ where: { courseId_hash: { courseId: input.courseId, hash } } })) continue;
      const filePath = path.join(dataDir, 'uploads', `${hash}.pdf`);
      await writeFile(filePath, bytes);
      const data = chinese
        ? { name: chineseExamInfo[key as ChineseExamKey].name, chapter: chineseExamInfo[key as ChineseExamKey].chapter, status: 'stored', fixture: null, origin: `高考真题 · 来源：${chineseExamInfo[key as ChineseExamKey].source}` }
        : { ...sampleInfo[key as SampleKey], fixture: key, origin: '自编中文演示资料 · 样例导入' };
      const material = await db.material.create({ data: { courseId: input.courseId, ...data, filePath, hash, mime: 'application/pdf', size: bytes.length } });
      if (chinese) await extractMaterial(material);
      imported++;
    }
    return NextResponse.json({ imported, message: imported ? chinese ? `已导入 ${imported} 份高考真题资料。` : `已导入 ${imported} 份演示资料，分类结果为预设演示。` : '这些资料已在课程中，无需重复导入。' });
  } catch (error) { return errorResponse(error); }
}
