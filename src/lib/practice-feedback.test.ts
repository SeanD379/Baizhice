import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./db',()=>({dataDir:'unused',db:{version:{findFirst:vi.fn(),findUnique:vi.fn()},material:{findMany:vi.fn(),findFirst:vi.fn()},practiceSet:{findFirst:vi.fn()},practiceSession:{findUnique:vi.fn()}}}));
vi.mock('./generation-store',async importOriginal=>({...await importOriginal<typeof import('./generation-store')>(),readGeneration:vi.fn()}));
vi.mock('./extraction',()=>({readExtraction:vi.fn(),isExtracting:vi.fn(()=>false)}));
vi.mock('./deepseek',()=>({deepSeekConfig:vi.fn(()=>({configured:true,model:'mock'})),requestStructuredOutput:vi.fn()}));
import { db } from './db';
import { readExtraction, isExtracting } from './extraction';
import { deepSeekConfig, requestStructuredOutput } from './deepseek';
import { practiceContext } from './practice-store';
import { blankSession } from './practice-session';
import { POST } from '../app/api/practice/feedback/route';
import { readGeneration } from './generation-store';
import { hashContent } from './generation';
import { generateSections } from './content';
import { publicMaterial } from './server';

const reference={materialId:'m',name:'资料.pdf',page:1,snippet:'互斥事件的联合概率为零。'};
const section={id:'s',title:'互斥',body:reference.snippet,refs:[reference],needsReview:false};
const question={id:'q',sectionId:'s',kind:'short',topic:'互斥',prompt:'解释互斥。',answer:'联合概率为零。',criteria:['说明联合概率'],explanation:'参考原文',reference};
const input={courseId:'c',versionId:'v',setId:'set',questionId:'q',answer:'联合概率为零',confirmed:true};
const output={strengths:[{text:'提到了联合概率。',evidence:'联合概率为零'}],omissions:[],suggestions:[],uncertainty:['引用匹配不保证反馈正确，请核对原文。']};
const material={id:'m',courseId:'c',name:'资料.pdf',mime:'application/pdf',size:1,hash:'h',filePath:'unused',fixture:null,chapter:'互斥',folderId:null,status:'extracted',excluded:false,conflictResolution:null,conflictFeedbackReason:null,conflictFeedbackNote:null,conflictResolvedAt:null,origin:'test',createdAt:new Date()};
const version={id:'v',courseId:'c',number:1,title:'复习',content:JSON.stringify([section]),sourceIds:'["m"]',summary:'',createdAt:new Date()};
const extraction={state:'complete' as const,pageCount:1,durationMs:1,updatedAt:'original',pages:[{page:1,text:reference.snippet,method:'pdf-text' as const,state:'extracted' as const,warnings:[]}]};
const call=(changes:object={},origin='http://localhost:4173')=>POST(new Request('http://localhost:4173/api/practice/feedback',{method:'POST',headers:{host:'localhost:4173',origin,'Content-Type':'application/json'},body:JSON.stringify({...input,...changes})}));

beforeEach(async()=>{
  vi.resetAllMocks();
  vi.mocked(deepSeekConfig).mockReturnValue({configured:true,model:'mock'});
  vi.mocked(isExtracting).mockReturnValue(false);
  vi.mocked(readExtraction).mockResolvedValue(extraction);
  vi.mocked(db.version.findFirst).mockResolvedValue(version);
  vi.mocked(db.material.findMany).mockResolvedValue([material]);
  vi.mocked(db.material.findFirst).mockResolvedValue(material);
  vi.mocked(db.practiceSet.findFirst).mockResolvedValue(null);
  vi.mocked(db.practiceSession.findUnique).mockResolvedValue(null);
  const context=await practiceContext('c','v');
  vi.mocked(db.practiceSet.findFirst).mockResolvedValue({id:'set',courseId:'c',versionId:'v',questions:JSON.stringify([question]),sectionIds:'["s"]',sourceHash:context.sourceHash([section]),model:'mock',reviewed:true,createdAt:new Date()});
  const {data}=await practiceContext('c','v');
  vi.mocked(db.practiceSession.findUnique).mockResolvedValue({id:data.scope,courseId:'c',versionId:'v',revision:1,updatedAt:new Date(),content:JSON.stringify({...blankSession(),ids:['q'],answers:{q:input.answer},results:{q:{answer:input.answer,correct:null}}})});
  vi.mocked(requestStructuredOutput).mockResolvedValue({output,model:'mock'});
});

it('uses real practice context and saved results, sends only server question/criteria/source, and never writes self-assessment',async()=>{
  const before=await db.practiceSession.findUnique({where:{id:'unused'}});
  const response=await call();expect(response.status).toBe(200);
  expect(await response.json()).toEqual({feedback:output,model:'mock',reference});
  const task=vi.mocked(requestStructuredOutput).mock.calls[0][0];
  expect(JSON.parse(task.input)).toEqual({question:question.prompt,options:[],answer:input.answer,referenceAnswer:question.answer,criteria:question.criteria,reference});
  expect(await db.practiceSession.findUnique({where:{id:'unused'}})).toEqual(before);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});

it.each([{confirmed:false},{confirmed:undefined},{question:{prompt:'injected'}},{criteria:['injected']},{reference},{answer:'different'},{answer:'联合概率为零 '},{answer:'x'.repeat(8001)},{questionId:'foreign'},{versionId:'old'},{setId:'old'},{setId:null}])('rejects invalid or stale client input before model: %j',async changes=>{
  expect((await call(changes)).status).toBe(400);expect(requestStructuredOutput).not.toHaveBeenCalled();
});
it('rejects foreign origin',async()=>{expect((await call({},'https://evil.example')).status).toBe(400);expect(requestStructuredOutput).not.toHaveBeenCalled();});
it('rejects missing sessions, draft-only answers and cross-course records',async()=>{
  const saved=await db.practiceSession.findUnique({where:{id:'unused'}});
  for(const record of [null,{...saved!,content:JSON.stringify({...blankSession(),ids:['q'],answers:{q:input.answer}})},{...saved!,courseId:'other'}]) {
    vi.mocked(db.practiceSession.findUnique).mockResolvedValue(record);
    expect((await call()).status).toBe(400);
  }
  expect(requestStructuredOutput).not.toHaveBeenCalled();
});
it.each(['review','excluded','extracting','changed','unreviewed','forged-ref'])('rejects unavailable source or set: %s',async mode=>{
  if(mode==='review'||mode==='excluded')vi.mocked(db.material.findMany).mockResolvedValue([{...material,status:mode==='review'?'review':'extracted',excluded:mode==='excluded'}]);
  if(mode==='extracting')vi.mocked(isExtracting).mockReturnValue(true);
  if(mode==='changed')vi.mocked(readExtraction).mockResolvedValue({...extraction,updatedAt:'changed'});
  const set=await db.practiceSet.findFirst({});
  if(mode==='unreviewed')vi.mocked(db.practiceSet.findFirst).mockResolvedValue({...set!,reviewed:false});
  if(mode==='forged-ref')vi.mocked(db.practiceSet.findFirst).mockResolvedValue({...set!,questions:JSON.stringify([{...question,reference:{...reference,snippet:'伪造的来源摘录'}}])});
  expect((await call()).status).toBe(400);expect(requestStructuredOutput).not.toHaveBeenCalled();
});
it('verifies reviewed excerpts against extracted page text, even with a matching source hash',async()=>{
  vi.mocked(readExtraction).mockResolvedValue({...extraction,pages:[{...extraction.pages[0],text:'不支持引用的其他文字'}]});
  const context=await practiceContext('c','v'),set=await db.practiceSet.findFirst({});
  vi.mocked(db.practiceSet.findFirst).mockResolvedValue({...set!,sourceHash:context.sourceHash([section])});
  expect((await call()).status).toBe(400);expect(requestStructuredOutput).not.toHaveBeenCalled();
});
it('explains unconfigured state without sending data',async()=>{
  vi.mocked(deepSeekConfig).mockReturnValue({configured:false,model:'mock'});
  const response=await call();expect(response.status).toBe(400);expect((await response.json()).error).toContain('本次答案未发送');expect(requestStructuredOutput).not.toHaveBeenCalled();
});
it.each([{...output,score:100},{...output,strengths:[{text:'编造',evidence:'没有提供的证据'}]},{...output,uncertainty:[]}])('rejects invalid model output %j',async invalid=>{
  vi.mocked(requestStructuredOutput).mockResolvedValue({model:'mock',output:invalid});expect((await call()).status).toBe(400);
});
it.each(['version','source','round','set'])('discards feedback when %s changes during generation',async mode=>{
  const record=await db.practiceSession.findUnique({where:{id:'unused'}}),set=await db.practiceSet.findFirst({});
  vi.mocked(requestStructuredOutput).mockImplementation(async()=>{
    if(mode==='version')vi.mocked(db.version.findFirst).mockResolvedValue({...version,id:'new',number:2});
    if(mode==='source')vi.mocked(readExtraction).mockResolvedValue({...extraction,updatedAt:'changed'});
    if(mode==='round')vi.mocked(db.practiceSession.findUnique).mockResolvedValue({...record!,revision:2,content:JSON.stringify({...JSON.parse(record!.content),roundId:'39865c59-fc04-43d3-a1b1-3e2755d8f9fa'})});
    if(mode==='set')vi.mocked(db.practiceSet.findFirst).mockResolvedValue({...set!,id:'new'});
    return {output,model:'mock'};
  });
  expect((await call()).status).toBe(400);
});
it('keeps feedback valid when only self-assessment is saved while the model is running',async()=>{
  const record=await db.practiceSession.findUnique({where:{id:'unused'}});
  const session=JSON.parse(record!.content);
  vi.mocked(requestStructuredOutput).mockImplementation(async()=>{
    session.results.q.correct=true;
    vi.mocked(db.practiceSession.findUnique).mockResolvedValue({...record!,revision:2,content:JSON.stringify(session)});
    return {output,model:'mock'};
  });
  expect((await call()).status).toBe(200);
});
it('returns recoverable model failures',async()=>{
  vi.mocked(requestStructuredOutput).mockRejectedValue(new Error('模型暂不可用'));
  const response=await call();expect(response.status).toBe(400);expect((await response.json()).error).toBe('模型暂不可用');
});

async function correctedDraft(expectedVersionId:string|null='original') {
  const reviewed={...section,generation:{provider:'OpenAI' as const,model:'mock',draftId:'9db4ef30-2c75-4f49-849e-e51c0e8cd195'}};
  vi.mocked(db.version.findFirst).mockResolvedValue({...version,number:3,content:JSON.stringify([reviewed])});
  vi.mocked(db.version.findUnique).mockImplementation(args=>Promise.resolve(args.where.id==='original'?{...version,id:'original',number:1}:{...version,number:3}) as ReturnType<typeof db.version.findUnique>);
  const raw={...extraction,pages:[{...extraction.pages[0],text:'OCR 错误：互斥事件的联合概串为雾。'}]};
  vi.mocked(readExtraction).mockResolvedValue(raw);
  const page={materialId:'m',name:material.name,page:1,text:reference.snippet,extractionHash:hashContent(JSON.stringify(raw)),method:'pdf-text' as const,warnings:[]};
  const draft={id:'9db4ef30-2c75-4f49-849e-e51c0e8cd195',courseId:'c',expectedVersionId,sections:[reviewed],pages:[page],originalPages:[{...page,text:raw.pages[0].text}],warnings:[],model:'mock',createdAt:'original'};
  vi.mocked(readGeneration).mockResolvedValue(draft);
  const context=await practiceContext('c','v'),set=await db.practiceSet.findFirst({});
  vi.mocked(db.practiceSet.findFirst).mockResolvedValue({...set!,sourceHash:context.sourceHash([reviewed])});
  return draft;
}
it.each(['original',null])('accepts corrected OCR from saved generation with original lineage %s, not raw text',async original=>{
  await correctedDraft(original);
  expect((await call()).status).toBe(200);
  expect(JSON.parse(vi.mocked(requestStructuredOutput).mock.calls[0][0].input).reference.snippet).toBe(reference.snippet);
});
it.each(['course','lineage-course','lineage-future','missing-lineage','hash','text','section','missing-draft'])('rejects invalid corrected provenance: %s',async mode=>{
  const draft=await correctedDraft();
  if(mode.startsWith('lineage-')||mode==='missing-lineage')vi.mocked(db.version.findUnique).mockReset();
  if(mode==='course')draft.courseId='other';
  if(mode==='lineage-course')vi.mocked(db.version.findUnique).mockResolvedValue({...version,courseId:'other'});
  if(mode==='lineage-future')vi.mocked(db.version.findUnique).mockResolvedValue({...version,number:3});
  if(mode==='missing-lineage')vi.mocked(db.version.findUnique).mockResolvedValue(null);
  if(mode==='hash')draft.pages[0].extractionHash='0'.repeat(64);
  if(mode==='text')draft.pages[0].text='不支持引用的其他文字';
  if(mode==='section')draft.sections=[];
  if(mode==='missing-draft')vi.mocked(readGeneration).mockRejectedValue(new Error('生成预览不可用'));
  expect((await call()).status).toBe(400);expect(requestStructuredOutput).not.toHaveBeenCalled();
});
it('discards feedback if corrected generation pages change while model is running',async()=>{
  const draft=await correctedDraft();
  vi.mocked(requestStructuredOutput).mockImplementation(async()=>{draft.pages[0].text+='后续修订';return {output,model:'mock'};});
  expect((await call()).status).toBe(400);
});
it.each(['condition-choice','condition-fill'])('clearly marks actual demo question %s unavailable when its excerpt differs',async questionId=>{
  const demo={...material,fixture:'conditional',status:'ready'};
  const sections=generateSections([publicMaterial(demo)],['m'],['conditional']);
  vi.mocked(db.material.findMany).mockResolvedValue([demo]);
  vi.mocked(db.practiceSet.findFirst).mockResolvedValue(null);
  vi.mocked(db.version.findFirst).mockResolvedValue({...version,content:JSON.stringify(sections)});
  const {data}=await practiceContext('c','v');
  const answer=questionId==='condition-choice'?'P(A)>0':'2/3';
  vi.mocked(db.practiceSession.findUnique).mockResolvedValue({id:data.scope,courseId:'c',versionId:'v',revision:1,updatedAt:new Date(),content:JSON.stringify({...blankSession(),ids:[questionId],answers:{[questionId]:answer},results:{[questionId]:{answer,correct:true}}})});
  const response=await call({setId:null,questionId,answer});expect(response.status).toBe(400);
  expect((await response.json()).error).toContain('部分演示题使用不同摘录');expect(requestStructuredOutput).not.toHaveBeenCalled();
});
