import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adoptMaterialStudy,getMaterialStudyTask,listMaterialStudyTasks,organizeMaterial,reviseMaterialStudy } from './material-study-store';
import { studyEditsSchema,studyPresetSchema } from './material-study';
const id=z.string().min(1).max(300),courseId=z.string().min(1).max(100),revision=z.number().int().positive();
const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('study-organize'),courseId,mode:z.enum(['material','annotations']),preset:studyPresetSchema.optional(),routing:z.literal('auto').optional(),materialIds:z.array(id).max(100).optional(),annotationIds:z.array(id).max(2000).optional(),confirmed:z.literal(true),taskId:z.string().uuid().optional()}),
  z.object({action:z.literal('study-edit'),courseId,taskId:z.string().uuid(),revision,edits:studyEditsSchema.optional(),approveIds:z.array(id).max(2000).optional()}),
  z.object({action:z.literal('study-adopt'),courseId,taskId:z.string().uuid(),revision,chosenIds:z.array(id).min(1).max(2000),notebookRevision:revision.optional(),targets:z.array(z.object({sectionId:id,pageId:id.optional(),chapterId:id.optional(),chapterTitle:z.string().max(80).optional()})).max(2000)}),
]);
export async function materialStudyGet(params:URLSearchParams) {
  const course=courseId.parse(params.get('courseId'));
  if(params.get('action')==='study-list')return NextResponse.json({tasks:await listMaterialStudyTasks(course,params.has('materialId')?id.parse(params.get('materialId')):undefined)},{headers:{'Cache-Control':'no-store'}});
  return NextResponse.json({task:await getMaterialStudyTask(course,z.string().uuid().parse(params.get('taskId')))},{headers:{'Cache-Control':'no-store'}});
}
export async function materialStudyAction(body:unknown) {
  const input=schema.parse(body);
  if(input.action==='study-organize')return NextResponse.json({task:await organizeMaterial(input)},{status:202});
  if(input.action==='study-edit')return NextResponse.json({task:await reviseMaterialStudy(input)});
  return NextResponse.json({task:await adoptMaterialStudy(input)});
}
