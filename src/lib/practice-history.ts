import { db } from './db';
import { hashContent } from './generation';
import { practiceQuestions, type Question } from './practice';
import { sessionSchema, type PracticeSession } from './practice-session';
import { publicMaterial, publicVersion } from './server';
import { sourceLocation } from './document-labels';
import type { Version } from './types';
import { practiceContext } from './practice-store';

export type PracticeHistoryEntry={
  id:string;version:Version;createdAt:string;model:string|null;reviewed:boolean|null;
  sourceHash:string|null;questions:Question[];snapshot:'saved'|'reconstructed'|'missing';
  session:{id:string;updatedAt:string;state:PracticeSession}|null;
  archived?:boolean;withheld?:boolean;
};
export type PracticeHistoryData={courseName:string;entries:PracticeHistoryEntry[]};

export async function practiceHistory(courseId:string):Promise<PracticeHistoryData> {
  const course=await db.course.findUnique({where:{id:courseId}});
  if(!course)throw new Error('课程不存在。');
  const [versions,sets,sessions,materials,rounds]=await Promise.all([
    db.version.findMany({where:{courseId},orderBy:{number:'desc'}}),
    db.practiceSet.findMany({where:{courseId},orderBy:{createdAt:'desc'}}),
    db.practiceSession.findMany({where:{courseId},orderBy:{updatedAt:'desc'}}),
    db.material.findMany({where:{courseId}}),
    db.practiceRound.findMany({where:{courseId},orderBy:{createdAt:'desc'}}),
  ]);
  const versionMap=new Map(versions.map(v=>[v.id,publicVersion(v)]));
  const remaining=new Map(sessions.map(s=>[s.id,s]));
  const entries:PracticeHistoryEntry[]=[];
  for(const round of rounds) {
    const version=versionMap.get(round.versionId);if(!version)continue;
    entries.push({id:round.id,version,createdAt:round.createdAt.toISOString(),model:null,reviewed:null,sourceHash:null,questions:JSON.parse(round.questions),snapshot:'saved',archived:true,session:{id:round.scope,updatedAt:round.createdAt.toISOString(),state:sessionSchema.parse(JSON.parse(round.content))}});
  }
  for(const set of sets) {
    const version=versionMap.get(set.versionId);if(!version)continue;
    const questions:Question[]=JSON.parse(set.questions);
    const scope=hashContent(JSON.stringify([set.versionId,set.id,questions]));
    const record=remaining.get(scope);
    const session=record?.versionId===set.versionId?record:undefined;
    if(session)remaining.delete(session.id);
    entries.push({id:set.id,version,createdAt:set.createdAt.toISOString(),model:set.model,reviewed:set.reviewed,sourceHash:set.sourceHash,questions,snapshot:'saved',session:session?{id:session.id,updatedAt:session.updatedAt.toISOString(),state:sessionSchema.parse(JSON.parse(session.content))}:null});
  }
  for(const record of remaining.values()) {
    const version=versionMap.get(record.versionId);if(!version)continue;
    // Legacy demo sessions have no question snapshot. Reconstruct only on an exact scope match.
    const historicalMaterials=materials.map(m=>({...publicMaterial(m),name:version.sections.flatMap(s=>s.refs).find(r=>r.materialId===m.id)?.name??m.name,status:'ready',excluded:false}));
    const candidates=practiceQuestions(historicalMaterials,version);
    let questions:Question[]=[];let matched=false;
    for(let mask=0;mask<2**candidates.length;mask++) {
      const subset=candidates.filter((_,i)=>mask&(1<<i));
      if(hashContent(JSON.stringify([version.id,'demo',subset]))===record.id){questions=subset;matched=true;break;}
    }
    entries.push({id:record.id,version,createdAt:record.updatedAt.toISOString(),model:null,reviewed:null,sourceHash:null,questions,snapshot:matched?'reconstructed':'missing',session:{id:record.id,updatedAt:record.updatedAt.toISOString(),state:sessionSchema.parse(JSON.parse(record.content))}});
  }
  if(versions[0]) {
    const {data}=await practiceContext(courseId,versions[0].id);
    if(data.questions.length&&data.session?.mode==='exam'&&!data.session.submitted&&!data.session.finished) {
      for(const entry of entries.filter(e=>e.version.id===versions[0].id)) {
        entry.withheld=true;entry.questions=[];entry.version={...entry.version,sections:[]};
        if(entry.session)entry.session={...entry.session,state:{...entry.session.state,results:{},attempts:[]}};
      }
    }
  }
  return {courseName:course.name,entries:entries.sort((a,b)=>(b.session?.updatedAt??b.createdAt).localeCompare(a.session?.updatedAt??a.createdAt))};
}

export function historyMarkdown(data:PracticeHistoryData) {
  const lines=[`# ${data.courseName} · 练习历史`,'','只读历史。保留原作答与原判定，不表示当前来源仍然有效。原文件/OCR 的完整历史版本未单独保存；以下保留材料版本、题目引用摘录及已存来源摘要。',''];
  for(const entry of data.entries) {
    if(entry.withheld){lines.push(`## 材料版本 ${entry.version.number}`,'本版本有未交卷自测，交卷后可回看题目、参考答案与完整历史。','');continue;}
    lines.push(`## 材料版本 ${entry.version.number} · ${entry.model??'历史作答'}`,`版本标识：${entry.version.id}`,`记录时间：${entry.session?.updatedAt??entry.createdAt}`,`题目快照：${entry.snapshot==='saved'?'已保存':entry.snapshot==='reconstructed'?'演示题重建，原范围哈希匹配':'缺失，不能可靠恢复题干与参考答案'}`,`题组核对：${entry.reviewed===null?'无独立核对记录':entry.reviewed?'已核对':'未核对'}`,`来源摘要：${entry.sourceHash??'未保存'}`,'');
    for(const q of entry.questions) {
      lines.push(`### ${q.prompt}`,...(q.options??[]).map(o=>`- ${o}`),'',`参考答案：${q.answer}`,`解析：${q.explanation}`,...(q.criteria??[]).map(c=>`- 评分要点：${c}`),`出处：${q.reference.name} · ${sourceLocation(q.reference.name,q.reference.page)}`,`资料标识：${q.reference.materialId}`,`引用摘录：${q.reference.snippet}`,'');
    }
    if(entry.session) {
      lines.push(entry.session.state.finished?'作答状态：本组已完成':'作答状态：草稿或未完成','');
      for(const [id,answer] of Object.entries(entry.session.state.answers)) {
        const result=entry.session.state.results[id];
        lines.push(`### 作答：${entry.questions.find(q=>q.id===id)?.prompt??id}`,answer,`原记录判定：${result?.correct===true?'答对 / 自评掌握':result?.correct===false?'需要巩固':result?'待自评':'未提交'}`,'');
      }
      lines.push('### 保留的尝试记录',...entry.session.state.attempts.map(a=>`- ${a.at} · ${entry.questions.find(q=>q.id===a.id)?.topic??a.id} · ${a.correct?'答对 / 自评掌握':'需要巩固'}`),'');
    } else lines.push('暂无保存的作答。','');
    lines.push('### 当时的复习材料','',...entry.version.sections.flatMap(s=>[`#### ${s.title}`,s.body,...s.refs.map(r=>`出处：${r.name} · ${sourceLocation(r.name,r.page)} — ${r.snippet}`),'']));
  }
  return lines.join('\n');
}
