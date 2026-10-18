import { requirePrivateAccess } from '@/lib/private-access';
import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { checkOrigin, errorResponse, publicVersion } from '@/lib/server';
import { mergeAdditions } from '@/lib/content';
import { pageSchema, validatePages, validateOutput } from '@/lib/generation';
import { generationSources, listGenerations, recoverGeneration, readGeneration, saveGeneration } from '@/lib/generation-store';
import { generateWithDeepSeek } from '@/lib/deepseek';
import type { Section } from '@/lib/types';
import { adoptNotebookSections, NotebookConflict } from '@/lib/notebook-store';
import { materialStudyAction, materialStudyGet } from '@/lib/material-study-api';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const base={courseId:z.string().min(1).max(100),expectedVersionId:z.string().nullable()};
const schema=z.discriminatedUnion('action',[
  z.object({...base,action:z.literal('preview'),pages:z.array(pageSchema).min(1).max(20),confirmed:z.literal(true)}),
  z.object({...base,action:z.literal('adopt'),draftId:z.string().uuid(),chosenIds:z.array(z.string()).min(1).max(12),notebookRevision:z.number().int().positive().optional(),targets:z.array(z.object({sectionId:z.string(),pageId:z.string().optional(),chapterId:z.string().optional(),chapterTitle:z.string().max(80).optional()})).max(12).optional()}),
]);
const activeCourses=new Set<string>();
const staleMessage='已有更新版本，请重新打开生成窗口；原有内容和个人编辑未被覆盖。';

export async function GET(request:Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const params=new URL(request.url).searchParams;
    if(params.get('action')?.startsWith('study-'))return await materialStudyGet(params);
    const courseId=z.string().min(1).max(100).parse(params.get('courseId'));
    const action=z.enum(['sources','list','restore']).parse(params.get('action')??'sources');
    const sources=await generationSources(courseId);
    if(action==='sources')return NextResponse.json(sources);
    const latest=await db.version.findFirst({where:{courseId},orderBy:{number:'desc'}});
    const expectedVersionId=latest?.id??null;
    if(!params.has('expectedVersionId')||(params.get('expectedVersionId')||null)!==expectedVersionId)throw new Error(staleMessage);
    if(action==='list')return NextResponse.json({previews:await listGenerations(courseId,expectedVersionId,sources.pages)});
    const draft=await readGeneration(z.string().uuid().parse(params.get('draftId')));
    return NextResponse.json(recoverGeneration(draft,courseId,expectedVersionId,sources.pages));
  }
  catch(error){return errorResponse(error);}
}
export async function POST(request:Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  let activeCourse:string|undefined;
  try {
    checkOrigin(request);
    const body=await request.json();
    if(typeof body.action==='string'&&body.action.startsWith('study-'))return await materialStudyAction(body);
    const input=schema.parse(body);
    if(input.action==='preview') {
      if(activeCourses.has(input.courseId))throw new Error('这门课正在生成，请等待当前请求完成。');
      if(activeCourses.size>=2)throw new Error('当前已有两项生成任务，请稍后重试。');
      activeCourse=input.courseId;activeCourses.add(activeCourse);
      const latest=await db.version.findFirst({where:{courseId:input.courseId},orderBy:{number:'desc'}});
      if((latest?.id??null)!==input.expectedVersionId)throw new Error(staleMessage);
      const available=await generationSources(input.courseId),pages=validatePages(input.pages,available.pages);
      const result=await generateWithDeepSeek(pages),id=randomUUID();
      const checked=validateOutput(result.output,pages,result.model,id);
      validatePages(pages,(await generationSources(input.courseId)).pages);
      const existing:Section[]=latest?JSON.parse(latest.content):[];
      const sections=checked.sections.filter(s=>!existing.some(old=>old.id===s.id));
      const preview={id,courseId:input.courseId,expectedVersionId:input.expectedVersionId,sections,warnings:checked.warnings,model:result.model,createdAt:new Date().toISOString()};
      if(sections.length!==checked.sections.length)preview.warnings.push('已有同来源同标题段落未重复添加；其他候选是否重复仍请核对。');
      await saveGeneration({...preview,pages,originalPages:available.pages.filter(p=>pages.some(selected=>selected.materialId===p.materialId&&selected.page===p.page))});
      return NextResponse.json(preview);
    }
    const draft=await readGeneration(input.draftId);
    if(draft.courseId!==input.courseId||draft.expectedVersionId!==input.expectedVersionId)throw new Error('生成预览与当前课程或版本不匹配，请重新生成。');
    if(new Set(input.chosenIds).size!==input.chosenIds.length||input.chosenIds.some(id=>!draft.sections.some(s=>s.id===id)))throw new Error('所选候选内容不存在，请重新选择。');
    const saved=await db.$transaction(async tx=>{
      const requestId=`adopt:${input.draftId}`,fingerprint=createHash('sha256').update(JSON.stringify({chosenIds:input.chosenIds,targets:input.targets??[]})).digest('hex');
      const duplicate=await tx.notebookMutation.findUnique({where:{courseId_requestId:{courseId:input.courseId,requestId}}});
      if(duplicate){if(duplicate.fingerprint!==fingerprint)throw new Error('这份草稿已采用，请生成新的草稿后继续追加。');const existing=await tx.version.findFirst({where:{courseId:input.courseId},orderBy:{number:'desc'}});if(!existing)throw new Error('已采用版本不可用。');return existing;}
      const latest=await tx.version.findFirst({where:{courseId:input.courseId},orderBy:{number:'desc'}});
      if((latest?.id??null)!==input.expectedVersionId)throw new Error(staleMessage);
      const courseMaterials=await tx.material.findMany({where:{courseId:input.courseId}});
      // Recheck current source eligibility and extraction snapshots before committing the append.
      const current=await generationSources(input.courseId,courseMaterials.filter(material=>!material.excluded));
      validatePages(draft.pages,current.pages);
      const oldSourceIds:string[]=latest?JSON.parse(latest.sourceIds):[];
      const oldExamOnly=oldSourceIds.length>0&&oldSourceIds.every(id=>courseMaterials.some(material=>material.id===id&&material.chapter==='历年套卷'));
      const newKnowledge=input.chosenIds.some(id=>draft.sections.find(section=>section.id===id)?.refs.some(ref=>courseMaterials.some(material=>material.id===ref.materialId&&material.chapter!=='历年套卷')));
      const replaceOldExamSummary=oldExamOnly&&newKnowledge;
      const existing:Section[]=latest&&!replaceOldExamSummary?JSON.parse(latest.content):[];
      const sections=mergeAdditions(existing,draft.sections,input.chosenIds);
      if(input.targets?.some(target=>!input.chosenIds.includes(target.sectionId))||new Set(input.targets?.map(target=>target.sectionId)).size!==(input.targets?.length??0))throw new Error('草稿归入位置不匹配。');
      const notebook=await adoptNotebookSections(input.courseId,draft.sections.filter(section=>input.chosenIds.includes(section.id)),input.targets??[],input.notebookRevision,tx);
      await tx.notebookMutation.create({data:{courseId:input.courseId,requestId,fingerprint,revision:notebook.revision}});
      const sourceIds=[...new Set(sections.flatMap(s=>s.refs.map(r=>r.materialId)))];
      return tx.version.create({data:{courseId:input.courseId,number:(latest?.number??0)+1,title:'期末复习提纲',content:JSON.stringify(sections),sourceIds:JSON.stringify(sourceIds),summary:replaceOldExamSummary?'从所选资料建立知识点复习材料；旧套卷摘要保留在历史版本':`采用 AI 助手生成的 ${sections.length-existing.length} 段内容，引用待核对；保留原有编辑`}});
    });
    return NextResponse.json(publicVersion(saved));
  } catch(error){if(error instanceof NotebookConflict)return NextResponse.json({error:'笔记已在另一处更新，请重新打开草稿窗口。现有内容已保留。',current:error.current},{status:409});return errorResponse(error);}
  finally {if(activeCourse)activeCourses.delete(activeCourse);}
}

export async function PATCH(request:Request) {
  const denied=await requirePrivateAccess(request);if(denied)return denied;
  try {checkOrigin(request);return await materialStudyAction(await request.json());}
  catch(error){if(error instanceof NotebookConflict)return NextResponse.json({error:'活页已更新，请刷新并重新选择位置；当前草稿保留。',current:error.current},{status:409});return errorResponse(error);}
}
