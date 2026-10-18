import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Material } from '@prisma/client';
import { db, dataDir } from './db';
import { isExtracting, readExtraction } from './extraction';
import { hashContent, validatePages, type GenerationPreview, type SourcePage } from './generation';
import { deepSeekConfig } from './deepseek';
import { sourceLocation } from './document-labels';

export type StoredGeneration=GenerationPreview&{pages:SourcePage[];originalPages:SourcePage[]};
export async function generationSources(courseId:string,currentMaterials?:Material[]) {
  if(!currentMaterials&&!await db.course.findUnique({where:{id:courseId}}))throw new Error('课程不存在。');
  const materials=currentMaterials??await db.material.findMany({where:{courseId,excluded:false,conflictResolution:null}});
  const pages:SourcePage[]=[],unavailable:string[]=[];
  for(const material of materials) {
    if(material.courseId!==courseId||material.excluded||material.conflictResolution)continue;
    if(material.status==='review'){unavailable.push(`${material.name}：存在未处理冲突，未纳入。`);continue;}
    if(isExtracting(material.id)){unavailable.push(`${material.name}：正在重新识别，请稍后重新打开。`);continue;}
    const extraction=await readExtraction(material.id);
    if(!extraction){unavailable.push(`${material.name}：请先在资料详情提取文字。`);continue;}
    if(extraction.state==='partial')unavailable.push(`${material.name}：提取不完整，请检查未识别位置或长度限制提示，不代表已经覆盖全部资料。`);
    const extractionHash=hashContent(JSON.stringify(extraction));
    for(const p of extraction.pages) {
      if(p.state!=='extracted'||!p.text.trim()){if(p.state!=='empty'||!['docx-text','text'].includes(p.method))unavailable.push(`${material.name} ${sourceLocation(material.name,p.page)}：未提取出文字，未纳入。`);continue;}
      pages.push({materialId:material.id,name:material.name,page:p.page,text:p.text,extractionHash,method:p.method,warnings:p.warnings,chapter:material.chapter});
    }
  }
  return {...deepSeekConfig(),pages,unavailable};
}
export async function saveGeneration(draft:StoredGeneration) {
  const directory=path.join(dataDir,'generations');await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,`${draft.id}.json`),JSON.stringify(draft),'utf8');
}
export async function readGeneration(id:string):Promise<StoredGeneration> {
  if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('生成预览不存在。');
  try {return JSON.parse(await readFile(path.join(dataDir,'generations',`${id}.json`),'utf8'));}
  catch {throw new Error('生成预览不可用，请重新生成。');}
}

export function recoverGeneration(draft:StoredGeneration,courseId:string,expectedVersionId:string|null,pages:SourcePage[]) {
  if(draft.courseId!==courseId||draft.expectedVersionId!==expectedVersionId)throw new Error('生成预览已过期或不属于当前课程，请重新生成。');
  const reviewedPages=validatePages(draft.pages,pages);
  // Only return the selected, reviewed text; original extraction snapshots stay on disk.
  return {id:draft.id,courseId:draft.courseId,expectedVersionId:draft.expectedVersionId,sections:draft.sections,warnings:draft.warnings,model:draft.model,createdAt:draft.createdAt,pages:reviewedPages};
}
export async function listGenerations(courseId:string,expectedVersionId:string|null,pages:SourcePage[]) {
  let files:string[];
  try {files=await readdir(path.join(dataDir,'generations'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  const previews=[];
  for(const file of files) {
    if(!/^[a-f0-9-]{36}\.json$/.test(file))continue;
    try {
      const draft=recoverGeneration(await readGeneration(file.slice(0,-5)),courseId,expectedVersionId,pages);
      if(draft.sections.length)previews.push({id:draft.id,createdAt:draft.createdAt,model:draft.model,sectionCount:draft.sections.length});
    } catch { /* Invalid or superseded previews are not recoverable. */ }
  }
  return previews.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
