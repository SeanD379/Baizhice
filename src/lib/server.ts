import { NextResponse } from 'next/server';
import { aiAssistantText } from './ai-assistant';
import type { Material as DbMaterial, Version as DbVersion } from '@prisma/client';
import { ZodError } from 'zod';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Material, Section, Version } from './types';
import { sampleInfo, type SampleKey } from './content';

type PublicMaterialInput = Omit<DbMaterial, 'conflictResolution' | 'conflictFeedbackReason' | 'conflictFeedbackNote' | 'conflictResolvedAt'> & Partial<Pick<DbMaterial, 'conflictResolution' | 'conflictFeedbackReason' | 'conflictFeedbackNote' | 'conflictResolvedAt'>>;
export function publicMaterial(m: PublicMaterialInput): Material {
  const { filePath: _path, hash: _hash, ...rest } = m;
  return { ...rest, conflictResolution: m.conflictResolution ?? null, conflictFeedbackReason: m.conflictFeedbackReason ?? null, conflictFeedbackNote: m.conflictFeedbackNote ?? null, createdAt: m.createdAt.toISOString(), conflictResolvedAt: m.conflictResolvedAt?.toISOString() ?? null };
}
export function publicVersion(v: DbVersion): Version {
  const { content, sourceIds, ...rest } = v;
  return { ...rest, summary:aiAssistantText(rest.summary), sections: JSON.parse(content) as Section[], sourceIds: JSON.parse(sourceIds), createdAt: v.createdAt.toISOString() };
}
export function errorResponse(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: '提交内容不完整或格式不正确，请检查后重试。' }, { status: 400 });
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2002') return NextResponse.json({ error: '数据已变化或资料重复，请刷新后重试。' }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: '数据保存失败，请保留当前编辑并重试。' }, { status: 500 });
  }
  return NextResponse.json({ error: error instanceof Error ? aiAssistantText(error.message) : '操作失败，请重试。' }, { status: 400 });
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin) {
    const source = new URL(origin);
    const allowed = process.env.APP_URL ? source.origin === new URL(process.env.APP_URL).origin : ['127.0.0.1', 'localhost'].includes(source.hostname) && source.host === request.headers.get('host');
    if (!allowed) throw new Error('请求来源不匹配，请从你的学习空间入口重试。');
  }
}
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function sampleBytes(key: SampleKey) { return readFile(path.join(process.cwd(), 'assets', 'samples', `${key}.pdf`)); }
export async function identifySample(hash: string): Promise<SampleKey | null> {
  for (const key of Object.keys(sampleInfo) as SampleKey[]) if (digest(await sampleBytes(key)) === hash) return key;
  return null;
}
