import type { Prisma } from '@prisma/client';
import { db } from './db';
import { publicMaterial, publicVersion } from './server';
import { hashContent } from './generation';
import { isExtracting, readExtraction } from './extraction';
import { practiceQuestions, type Question } from './practice';
import { deepSeekConfig } from './deepseek';
import type { Section } from './types';
import type { PracticeSession } from './practice-session';
import type { DailyGroup } from './practice-hub';
import { validateSectionProvenance } from './provenance';

export type PracticeData={scope:string;revision:number;session:PracticeSession|null;questions:Question[];eligibleSections:{id:string;title:string}[];configured:boolean;dailyTaskId?:string;set:{id:string;model:string;reviewed:boolean;stale:boolean;questions:Question[]}|null};
export async function practiceContext(courseId:string,versionId:string,client:Prisma.TransactionClient=db,dailyTaskId?:string) {
  const saved=await client.version.findFirst({where:{courseId},orderBy:{number:'desc'}});
  if(!saved||saved.id!==versionId)throw new Error('复习材料版本已变化，请刷新页面后继续；旧练习记录仍保留。');
  const version=publicVersion(saved),records=await client.material.findMany({where:{courseId}}),materials=records.map(publicMaterial);
  const extractionHashes:Record<string,string|null>={};
  for(const m of materials.filter(m=>!m.fixture)) {
    const extraction=await readExtraction(m.id);
    extractionHashes[m.id]=!isExtracting(m.id)&&extraction?hashContent(JSON.stringify(extraction)):null;
  }
  const candidates=version.sections.filter(s=>!s.needsReview&&s.refs.length&&s.refs.some(r=>materials.find(m=>m.id===r.materialId)?.chapter!=='历年套卷')&&s.refs.every(r=>materials.some(m=>m.id===r.materialId&&!m.excluded&&m.status!=='review'&&(m.fixture||extractionHashes[m.id]))));
  const eligible:Section[]=[];
  for(const section of candidates) {
    try {await validateSectionProvenance(section,saved,records,client);eligible.push(section);}
    catch { /* Missing or stale generation sources must be reviewed again before use. */ }
  }
  const sourceHash=(sections:Section[])=>hashContent(JSON.stringify({sections,materials:materials.filter(m=>sections.some(s=>s.refs.some(r=>r.materialId===m.id))).map(m=>({id:m.id,excluded:m.excluded,status:m.status,extraction:extractionHashes[m.id]??null})).sort((a,b)=>a.id.localeCompare(b.id))}));
  const set=await client.practiceSet.findFirst({where:{courseId,versionId},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const sectionIds:string[]=set?JSON.parse(set.sectionIds):[];
  const selected=eligible.filter(s=>sectionIds.includes(s.id));
  const stale=!!set&&(selected.length!==sectionIds.length||sourceHash(selected)!==set.sourceHash);
  const generated:Question[]=set?JSON.parse(set.questions):[];
  let questions=set?(set.reviewed&&!stale?generated:[]):practiceQuestions(materials,version);
  let scope=hashContent(JSON.stringify([versionId,set?.id??'demo',questions]));
  if(dailyTaskId) {
    const task=await client.dailyPracticeTask.findFirst({where:{id:dailyTaskId,courseId}});
    const group=task?(JSON.parse(task.content).groups as DailyGroup[]).find(g=>g.engine==='generated'&&g.versionId===versionId):undefined;
    if(!group||group.refs.some(ref=>ref.setId!==(set?.id)||!questions.some(q=>q.id===ref.questionId)))throw Error('每日任务题组或来源已变化，旧答案保留，请重新核对来源。');
    scope=hashContent(JSON.stringify([scope,dailyTaskId,group.id]));
    if(group.scope&&group.scope!==scope)throw Error('每日任务的题目已变化，请重新核对来源；旧答案保留。');
    questions=group.refs.map(ref=>questions.find(q=>q.id===ref.questionId)!);
  }
  const record=await client.practiceSession.findUnique({where:{id:scope}});
  const data:PracticeData={scope,revision:record?.revision??0,session:record?JSON.parse(record.content):null,questions,eligibleSections:eligible.filter(s=>s.generation).map(s=>({id:s.id,title:s.title})),configured:deepSeekConfig().configured,...(dailyTaskId?{dailyTaskId}:{}),set:set?{id:set.id,model:set.model,reviewed:set.reviewed,stale,questions:generated}:null};
  return {data,eligible,sourceHash};
}
