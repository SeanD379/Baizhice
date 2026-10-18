import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db, dataDir } from './db';
import { digest, identifySample, publicMaterial } from './server';
import { sampleInfo } from './content';
import { identifyUpload } from './upload-format';

export async function storeMaterial(bytes: Buffer, name: string, courseId: string) {
  if (!await db.course.findUnique({ where: { id: courseId } })) throw new Error('课程不存在。');
  const { mime, extension } = identifyUpload(bytes, name);
  const hash = digest(bytes);
  const existing = await db.material.findUnique({ where: { courseId_hash: { courseId, hash } } });
  if (existing) return { duplicate: true, material: publicMaterial(existing) };
  const fixture = await identifySample(hash), filePath = path.join(dataDir, 'uploads', `${hash}${extension}`);
  await writeFile(filePath, bytes);
  const material = await db.material.create({ data: { courseId, name: name.replace(/[\x00-\x1f]/g, '').slice(0, 200), mime, size: bytes.length, hash, filePath, fixture, chapter: fixture ? sampleInfo[fixture].chapter : '未分类', status: fixture ? sampleInfo[fixture].status : 'stored', origin: fixture ? '自编中文演示资料 · 手动上传' : '本机上传 · 作者与年份未核实' } });
  if(!fixture)void import('./material-auto-import').then(module=>module.queueMaterialImport(material.id,true)).catch(()=>{});
  return { duplicate: false, material: publicMaterial(material) };
}
