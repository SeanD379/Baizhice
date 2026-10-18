import { beforeAll,afterAll,afterEach,expect,it,vi } from 'vitest';
import { mkdir,writeFile,unlink } from 'node:fs/promises';
import path from 'node:path';
vi.mock('./db',async()=>{
  const {PrismaClient}=await import('@prisma/client'),fs=await import('node:fs/promises'),path=await import('node:path');
  await fs.mkdir(path.resolve('tmp'),{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('tmp/practice-api-'));
  return {dataDir,db:new PrismaClient({datasources:{db:{url:`file:${path.join(dataDir,'test.db').replaceAll('\\','/')}`}}})};
});
vi.mock('./deepseek',async importOriginal=>({...await importOriginal<typeof import('./deepseek')>(),requestStructuredOutput:vi.fn()}));
import { db,dataDir } from './db';
import { GET,POST } from '../app/api/practice/route';
import { requestStructuredOutput } from './deepseek';
import { blankSession } from './practice-session';
import { hashContent } from './generation';
const draftId='05bc0062-78ad-43bf-af90-d4df6b04a9d6';
const section={id:'real-section',title:'平均值',body:'1、2、3 的平均值是 2。',refs:[{materialId:'m',name:'资料.pdf',page:1,snippet:'1、2、3 的平均值是 2。'}],needsReview:false,generation:{provider:'OpenAI',model:'mock',draftId}};
const extracted={state:'complete',pageCount:1,durationMs:1,updatedAt:'original',pages:[{page:1,text:section.body,method:'pdf-text',state:'extracted',warnings:[]}]};
const sourcePage={materialId:'m',name:'资料.pdf',page:1,text:section.body,extractionHash:hashContent(JSON.stringify(extracted)),method:'pdf-text',warnings:[]};
const draft={id:draftId,courseId:'course',expectedVersionId:null,sections:[section],pages:[sourcePage],originalPages:[sourcePage],warnings:[],model:'mock',createdAt:'2026-09-11T00:00:00Z'};
const saveDraft=(changes:object={})=>writeFile(path.join(dataDir,'generations',`${draftId}.json`),JSON.stringify({...draft,...changes}));
const call=(body:object)=>POST(new Request('http://127.0.0.1:4173/api/practice',{method:'POST',headers:{'Content-Type':'application/json',host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173'},body:JSON.stringify({courseId:'course',versionId:'v',...body})}));
const read=async()=>{const response=await GET(new Request('http://127.0.0.1:4173/api/practice?courseId=course&versionId=v'));expect(response.status).toBe(200);return response.json();};
async function generate(){
  vi.mocked(requestStructuredOutput).mockResolvedValue({model:'mock-model',output:{questions:[{sectionId:section.id,kind:'choice',prompt:'三个数的平均值？',options:['1','2','3'],answer:'2',explanation:'三数之和为 6，除以 3。',criteria:[],reference:{materialId:'m',page:1,snippet:section.body}}]}});
  const response=await call({action:'generate',sectionIds:[section.id],confirmed:true});expect(response.status).toBe(200);return response.json();
}
beforeAll(async()=>{
  for(const sql of [
    'CREATE TABLE Course (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE Material (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, folderId TEXT, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL, filePath TEXT NOT NULL, fixture TEXT, chapter TEXT NOT NULL DEFAULT "未分类", status TEXT NOT NULL DEFAULT "stored", excluded BOOLEAN NOT NULL DEFAULT 0, conflictResolution TEXT, conflictFeedbackReason TEXT, conflictFeedbackNote TEXT, conflictResolvedAt DATETIME, origin TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE Version (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, sourceIds TEXT NOT NULL, summary TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(courseId,number))',
    'CREATE TABLE PracticeSet (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, versionId TEXT NOT NULL, questions TEXT NOT NULL, sectionIds TEXT NOT NULL, sourceHash TEXT NOT NULL, model TEXT NOT NULL, reviewed BOOLEAN NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE PracticeSession (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, versionId TEXT NOT NULL, content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updatedAt DATETIME NOT NULL)',
    'CREATE TABLE PracticeRound (id TEXT PRIMARY KEY, scope TEXT NOT NULL, revision INTEGER NOT NULL, courseId TEXT NOT NULL, versionId TEXT NOT NULL, questions TEXT NOT NULL, content TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(scope,revision))',
  ])await db.$executeRawUnsafe(sql);
  await db.course.create({data:{id:'course',name:'测试课程'}});
  await db.material.create({data:{id:'m',courseId:'course',name:'资料.pdf',mime:'application/pdf',size:100,hash:'hash',filePath:'unused',origin:'test',status:'extracted'}});
  await db.version.create({data:{id:'v',courseId:'course',number:1,title:'材料',content:JSON.stringify([section]),sourceIds:'["m"]',summary:'测试'}});
  await mkdir(path.join(dataDir,'extractions'));await writeFile(path.join(dataDir,'extractions','m.json'),JSON.stringify(extracted));
  await mkdir(path.join(dataDir,'generations'));await saveDraft();
});
afterEach(async()=>{
  vi.clearAllMocks();await db.practiceRound.deleteMany();await db.practiceSession.deleteMany();await db.practiceSet.deleteMany();await db.version.deleteMany({where:{id:{not:'v'}}});
  await db.version.update({where:{id:'v'},data:{content:JSON.stringify([section])}});await db.material.update({where:{id:'m'},data:{excluded:false}});
  await writeFile(path.join(dataDir,'extractions','m.json'),JSON.stringify(extracted));
  await saveDraft();
});
afterAll(async()=>{await db.$disconnect();});
it('requires source and answer review before enabling model questions',async()=>{
  const draft=await generate();expect(draft.questions).toHaveLength(0);expect(draft.set.reviewed).toBe(false);
  expect((await call({action:'review',setId:draft.set.id})).status).toBe(200);expect((await read()).questions).toHaveLength(1);
});
it('persists drafts/results in SQLite and refuses stale writers without losing current progress',async()=>{
  const draft=await generate();await call({action:'review',setId:draft.set.id});const data=await read(),id=data.questions[0].id;
  const session={...blankSession(),ids:[id],answers:{[id]:'1'},results:{[id]:{answer:'1',correct:false}},attempts:[{id,correct:false,at:new Date().toISOString()}],finished:true};
  const body={action:'save',scope:data.scope,revision:0,session};expect((await call(body)).status).toBe(200);
  expect((await read()).session).toEqual(session);expect((await call({...body,session:{...session,answers:{[id]:'2'},results:{[id]:{answer:'2',correct:true}}}})).status).toBe(400);
  expect((await read()).session.results[id].correct).toBe(false);
});
it('disables a reviewed question set after exclusion or re-extraction, keeping saved history',async()=>{
  const draft=await generate();await call({action:'review',setId:draft.set.id});const data=await read(),id=data.questions[0].id;
  await call({action:'save',scope:data.scope,revision:0,session:{...blankSession(),ids:[id],answers:{[id]:'未完成草稿'}}});
  await db.material.update({where:{id:'m'},data:{excluded:true}});expect((await read()).set.stale).toBe(true);expect((await read()).questions).toHaveLength(0);
  await db.material.update({where:{id:'m'},data:{excluded:false}});await writeFile(path.join(dataDir,'extractions','m.json'),JSON.stringify({...extracted,updatedAt:'changed'}));
  expect((await read()).set.stale).toBe(true);expect(await db.practiceSession.count()).toBe(1);
});
it('refuses unreviewed or foreign sections before invoking a model',async()=>{
  await db.version.update({where:{id:'v'},data:{content:JSON.stringify([{...section,needsReview:true}])}});
  expect((await call({action:'generate',sectionIds:[section.id],confirmed:true})).status).toBe(400);
  expect((await call({action:'generate',sectionIds:['foreign'],confirmed:true})).status).toBe(400);expect(requestStructuredOutput).not.toHaveBeenCalled();
});
it('does not write a question set when the material version changes during generation',async()=>{
  await generate();const result=vi.mocked(requestStructuredOutput).mock.results[0].value;await db.practiceSet.deleteMany();
  vi.mocked(requestStructuredOutput).mockImplementation(async()=>{await db.version.create({data:{id:'v2',courseId:'course',number:2,title:'新材料',content:JSON.stringify([section]),sourceIds:'["m"]',summary:'更新'}});return result;});
  expect((await call({action:'generate',sectionIds:[section.id],confirmed:true})).status).toBe(400);expect(await db.practiceSet.count()).toBe(0);
});

it('archives completed answers before starting a new round without changing the save revision contract',async()=>{
  const generated=await generate();await call({action:'review',setId:generated.set.id});const data=await read(),id=data.questions[0].id;
  const completed={...blankSession(),roundId:'dcbacda3-ed98-4c1a-995e-e42f88539626',ids:[id],answers:{[id]:'2'},results:{[id]:{answer:'2',correct:true}},finished:true,attempts:[{id,correct:true,at:'2026-09-11T00:00:00Z'}]};
  expect(await (await call({action:'save',scope:data.scope,revision:0,session:completed})).json()).toEqual({revision:1});
  const next={...blankSession(),roundId:'0423a4d7-6c4a-4696-9b27-3ba686787003',ids:[id],attempts:completed.attempts};
  expect(await (await call({action:'save',scope:data.scope,revision:1,session:next})).json()).toEqual({revision:2});
  const rounds=await db.practiceRound.findMany();expect(rounds).toHaveLength(1);
  expect(JSON.parse(rounds[0].content)).toEqual(completed);expect(JSON.parse(rounds[0].questions)).toEqual(data.questions);expect((await read()).session).toEqual(next);
  expect((await call({action:'save',scope:data.scope,revision:1,session:next})).status).toBe(400);expect(await db.practiceRound.count()).toBe(1);
});

it.each(['missing','course','id','lineage','future','section','text','hash'])('rejects invalid stored provenance before model invocation: %s',async mode=>{
  if(mode==='missing')await unlink(path.join(dataDir,'generations',`${draftId}.json`));
  if(mode==='course')await saveDraft({courseId:'foreign'});
  if(mode==='id')await saveDraft({id:'3022d849-2a8f-4dfe-8c8c-8d61f7884657'});
  if(mode==='lineage')await saveDraft({expectedVersionId:'missing-version'});
  if(mode==='future')await saveDraft({expectedVersionId:'v'});
  if(mode==='section')await saveDraft({sections:[]});
  if(mode==='text')await saveDraft({pages:[{...sourcePage,text:'不支持摘录的文字'}]});
  if(mode==='hash')await saveDraft({pages:[{...sourcePage,extractionHash:'0'.repeat(64)}]});
  expect((await read()).eligibleSections).toEqual([]);
  expect((await call({action:'generate',sectionIds:[section.id],confirmed:true})).status).toBe(400);expect(requestStructuredOutput).not.toHaveBeenCalled();
});

it('refuses regeneration and review after re-extraction rather than rebasing old excerpts onto the new hash',async()=>{
  const generated=await generate();vi.mocked(requestStructuredOutput).mockClear();
  await writeFile(path.join(dataDir,'extractions','m.json'),JSON.stringify({...extracted,updatedAt:'changed'}));
  expect((await read()).eligibleSections).toEqual([]);
  expect((await call({action:'generate',sectionIds:[section.id],confirmed:true})).status).toBe(400);
  expect((await call({action:'review',setId:generated.set.id})).status).toBe(400);expect(requestStructuredOutput).not.toHaveBeenCalled();
  expect(await db.practiceSet.count()).toBe(1);
});

it('accepts corrected OCR from a valid saved draft and retains valid prior-version lineage',async()=>{
  const raw={...extracted,pages:[{...extracted.pages[0],text:'OCR 错字：平钧值'}]};
  await writeFile(path.join(dataDir,'extractions','m.json'),JSON.stringify(raw));
  await db.version.create({data:{id:'original',courseId:'course',number:0,title:'原版本',content:'[]',sourceIds:'[]',summary:'原版本'}});
  await saveDraft({expectedVersionId:'original',pages:[{...sourcePage,extractionHash:hashContent(JSON.stringify(raw))}],originalPages:[{...sourcePage,text:raw.pages[0].text,extractionHash:hashContent(JSON.stringify(raw))}]});
  expect((await read()).eligibleSections).toHaveLength(1);expect((await generate()).set).not.toBeNull();
});

it('checks every referenced page rather than only the first valid excerpt',async()=>{
  const multiple={...section,refs:[...section.refs,{...section.refs[0],page:2}]};
  await db.version.update({where:{id:'v'},data:{content:JSON.stringify([multiple])}});
  await saveDraft({sections:[multiple]});
  expect((await read()).eligibleSections).toEqual([]);
  expect((await call({action:'generate',sectionIds:[section.id],confirmed:true})).status).toBe(400);expect(requestStructuredOutput).not.toHaveBeenCalled();
});
