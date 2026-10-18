import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

vi.mock('./db',async()=>{
  const { PrismaClient }=await import('@prisma/client');
  const { mkdtemp,mkdir }=await import('node:fs/promises');
  const path=await import('node:path');
  const directory=path.resolve('tmp');await mkdir(directory,{recursive:true});
  const dataDir=await mkdtemp(path.join(directory,'generation-api-'));
  return {dataDir,db:new PrismaClient({datasources:{db:{url:`file:${path.join(dataDir,'test.db').replaceAll('\\','/')}`}}})};
});
vi.mock('./deepseek',async importOriginal=>({...await importOriginal<typeof import('./deepseek')>(),generateWithDeepSeek:vi.fn()}));
import { db, dataDir } from './db';
import { generateWithDeepSeek } from './deepseek';
import { GET, POST } from '../app/api/generation/route';

const extracted={state:'complete',pageCount:2,durationMs:1,updatedAt:'2026-09-10',pages:[{page:1,text:'',method:'pdf-text',state:'empty',warnings:['空页']},{page:2,text:'条件概率的使用前提是 P(A)>0。',method:'pdf-text',state:'extracted',warnings:[]}]};
const generated=(title='条件概率')=>({model:'mock-openai',output:{sections:[{title,body:'条件概率要求 $P(A)>0$。',refs:[{materialId:'real',page:2,snippet:'使用前提是 P(A)>0。'}]}],warnings:[]}});
const call=(body:unknown)=>POST(new Request('http://127.0.0.1:4173/api/generation',{method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','Content-Type':'application/json'},body:JSON.stringify(body)}));
async function getPages(){const response=await GET(new Request('http://127.0.0.1:4173/api/generation?courseId=course'));expect(response.status).toBe(200);return (await response.json()).pages;}
async function preview(expectedVersionId:string|null,title='条件概率'){
  vi.mocked(generateWithDeepSeek).mockResolvedValue(generated(title));
  const response=await call({action:'preview',courseId:'course',expectedVersionId,pages:await getPages(),confirmed:true});
  expect(response.status).toBe(200);return response.json();
}
beforeAll(async()=>{
  await db.$executeRawUnsafe('CREATE TABLE Course (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await db.$executeRawUnsafe('CREATE TABLE Material (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, folderId TEXT, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL, filePath TEXT NOT NULL, fixture TEXT, chapter TEXT NOT NULL DEFAULT "未分类", status TEXT NOT NULL DEFAULT "stored", excluded BOOLEAN NOT NULL DEFAULT 0, conflictResolution TEXT, conflictFeedbackReason TEXT, conflictFeedbackNote TEXT, conflictResolvedAt DATETIME, origin TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await db.$executeRawUnsafe('CREATE TABLE Version (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, sourceIds TEXT NOT NULL, summary TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(courseId,number))');
  await db.$executeRawUnsafe('CREATE TABLE Notebook (courseId TEXT PRIMARY KEY, content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updatedAt DATETIME NOT NULL)');
  await db.$executeRawUnsafe('CREATE TABLE NotebookSnapshot (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, content TEXT NOT NULL, summary TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await db.$executeRawUnsafe('CREATE TABLE NotebookMutation (courseId TEXT NOT NULL, requestId TEXT NOT NULL, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(courseId,requestId))');
  await db.course.create({data:{id:'course',name:'测试课程'}});
  await db.material.create({data:{id:'real',courseId:'course',name:'真实文字测试.pdf',mime:'application/pdf',size:100,hash:'hash',filePath:'unused',origin:'test',status:'extracted'}});
  await mkdir(path.join(dataDir,'extractions'));await writeFile(path.join(dataDir,'extractions','real.json'),JSON.stringify(extracted));
});
afterEach(async()=>{vi.clearAllMocks();await db.notebookMutation.deleteMany();await db.notebookSnapshot.deleteMany();await db.notebook.deleteMany();await db.version.deleteMany();await db.material.deleteMany({where:{id:'exam'}});await db.material.update({where:{id:'real'},data:{excluded:false,status:'extracted',conflictResolution:null}});await writeFile(path.join(dataDir,'extractions','real.json'),JSON.stringify(extracted));for(const file of await readdir(path.join(dataDir,'generations')).catch(()=>[]))await unlink(path.join(dataDir,'generations',file));});
afterAll(async()=>{await db.$disconnect();});

it('returns only extracted pages and flags the empty page',async()=>{
  const result=await (await GET(new Request('http://127.0.0.1:4173/api/generation?courseId=course'))).json();
  expect(result.pages.map((p:{page:number})=>p.page)).toEqual([2]);expect(result.unavailable[0]).toContain('第 1 页');
});
it('previews without writing a version, adopts selected content once, and preserves personal edits',async()=>{
  const draft=await preview(null);expect(await db.version.count()).toBe(0);
  const adoption={action:'adopt',courseId:'course',expectedVersionId:null,draftId:draft.id,chosenIds:[draft.sections[0].id]};
  const first=await (await call(adoption)).json();expect(first.number).toBe(1);
  const edited={...first.sections[0],body:'我的个人理解',edited:true};
  const existing=await db.version.create({data:{courseId:'course',number:2,title:'提纲',content:JSON.stringify([edited]),sourceIds:'["real"]',summary:'个人编辑'}});
  const next=await preview(existing.id,'补充知识点');
  const result=await call({action:'adopt',courseId:'course',expectedVersionId:existing.id,draftId:next.id,chosenIds:[next.sections[0].id]});
  expect(result.status).toBe(200);expect((await result.json()).sections[0]).toEqual(edited);
  expect((await call(adoption)).status).toBe(200);expect(await db.version.count()).toBe(3);
  expect(JSON.parse((await db.version.findUniqueOrThrow({where:{id:first.id}})).content)[0].body).not.toBe('我的个人理解');
});
it('keeps an old exam-only summary in history when starting knowledge review from notes',async()=>{
  await db.material.create({data:{id:'exam',courseId:'course',name:'旧套卷.pdf',mime:'application/pdf',size:100,hash:'exam-hash',filePath:'unused',origin:'test',chapter:'历年套卷',status:'extracted'}});
  const oldSection={id:'old-exam-summary',title:'旧题干摘要',body:'缺少完整题目和作答位置。',refs:[]};
  const old=await db.version.create({data:{courseId:'course',number:1,title:'旧套卷摘要',content:JSON.stringify([oldSection]),sourceIds:'["exam"]',summary:'旧摘要'}});
  const draft=await preview(old.id,'新知识点');
  const adopted=await call({action:'adopt',courseId:'course',expectedVersionId:old.id,draftId:draft.id,chosenIds:[draft.sections[0].id]});
  expect(adopted.status).toBe(200);
  expect((await adopted.json()).sections.map((section:{title:string})=>section.title)).toEqual(['新知识点']);
  expect(JSON.parse((await db.version.findUniqueOrThrow({where:{id:old.id}})).content)).toEqual([oldSection]);
});
it('rejects excluded sources and changed extraction when adopting a preview',async()=>{
  const draft=await preview(null),body={action:'adopt',courseId:'course',expectedVersionId:null,draftId:draft.id,chosenIds:[draft.sections[0].id]};
  await db.material.update({where:{id:'real'},data:{excluded:true}});expect((await call(body)).status).toBe(400);
  await db.material.update({where:{id:'real'},data:{excluded:false}});
  await writeFile(path.join(dataDir,'extractions','real.json'),JSON.stringify({...extracted,updatedAt:'changed'}));
  expect((await call(body)).status).toBe(400);expect(await db.version.count()).toBe(0);
});
it('rejects foreign sources and missing consent before model invocation',async()=>{
  const pages=await getPages();
  for(const body of [{action:'preview',courseId:'course',expectedVersionId:null,pages,confirmed:false},{action:'preview',courseId:'course',expectedVersionId:null,pages:[{...pages[0],materialId:'foreign'}],confirmed:true}])expect((await call(body)).status).toBe(400);
  expect(generateWithDeepSeek).not.toHaveBeenCalled();
});
it('rejects forged model citations and drops results if a source is excluded during generation',async()=>{
  const pages=await getPages(),body={action:'preview',courseId:'course',expectedVersionId:null,pages,confirmed:true};
  const fake=generated();fake.output.sections[0].refs[0].page=1;
  vi.mocked(generateWithDeepSeek).mockResolvedValue(fake);expect((await call(body)).status).toBe(400);
  vi.mocked(generateWithDeepSeek).mockImplementation(async()=>{await db.material.update({where:{id:'real'},data:{excluded:true}});return generated();});
  expect((await call(body)).status).toBe(400);expect(await db.version.count()).toBe(0);
});

const recoverRequest=(action:'list'|'restore',draftId='',courseId='course',version='')=>GET(new Request(`http://127.0.0.1:4173/api/generation?courseId=${courseId}&expectedVersionId=${version}&action=${action}&draftId=${draftId}`));
it('lists and restores reviewed selected text without exposing originals or invoking the model again',async()=>{
  await writeFile(path.join(dataDir,'extractions','real.json'),JSON.stringify({...extracted,pages:[{...extracted.pages[1],page:1,text:'未选择的私有内容'},extracted.pages[1]]}));
  const pages=await getPages();
  vi.mocked(generateWithDeepSeek).mockResolvedValue(generated());
  const result=await call({action:'preview',courseId:'course',expectedVersionId:null,pages:[{...pages[1],text:'已核对：使用前提是 P(A)>0。'}],confirmed:true});
  expect(result.status).toBe(200);const draft=await result.json();
  expect(vi.mocked(generateWithDeepSeek).mock.calls[0][0].map(p=>p.text)).toEqual(['已核对：使用前提是 P(A)>0。']);
  const listing=await (await recoverRequest('list')).json();
  expect(listing.previews).toEqual([{id:draft.id,createdAt:draft.createdAt,model:draft.model,sectionCount:1}]);
  const restored=await recoverRequest('restore',draft.id);expect(restored.status).toBe(200);
  const data=await restored.json();expect(data.pages.map((p:{text:string})=>p.text)).toEqual(['已核对：使用前提是 P(A)>0。']);
  expect(data.originalPages).toBeUndefined();expect(JSON.stringify(data)).not.toContain('未选择的私有内容');
  expect(generateWithDeepSeek).toHaveBeenCalledTimes(1);expect(await db.version.count()).toBe(0);
  expect((await call({action:'adopt',courseId:'course',expectedVersionId:null,draftId:data.id,chosenIds:[data.sections[0].id]})).status).toBe(200);
});
it('hides and rejects previews after adoption or a version change, including stale callers',async()=>{
  const draft=await preview(null);
  const version=await db.version.create({data:{courseId:'course',number:1,title:'新版本',content:'[]',sourceIds:'[]',summary:'更新'}});
  expect((await recoverRequest('list')).status).toBe(400);
  expect((await (await recoverRequest('list','','course',version.id)).json()).previews).toEqual([]);
  expect((await recoverRequest('restore',draft.id,'course',version.id)).status).toBe(400);
});
it('rejects foreign-course and missing previews and skips corrupt local records',async()=>{
  const draft=await preview(null);
  await db.course.upsert({where:{id:'other'},create:{id:'other',name:'其他课程'},update:{}});
  expect((await (await recoverRequest('list','','other')).json()).previews).toEqual([]);
  expect((await recoverRequest('restore',draft.id,'other')).status).toBe(400);
  expect((await recoverRequest('restore','00000000-0000-4000-8000-000000000000')).status).toBe(400);
  await writeFile(path.join(dataDir,'generations','00000000-0000-4000-8000-000000000000.json'),'{broken');
  expect((await (await recoverRequest('list')).json()).previews).toHaveLength(1);
});
it('revalidates excluded, conflicted, paused and re-extracted sources for listing and recovery',async()=>{
  const draft=await preview(null);
  for(const change of ['excluded','review','paused','extraction']) {
    await db.material.update({where:{id:'real'},data:{excluded:change==='excluded',status:change==='review'?'review':'extracted',conflictResolution:change==='paused'?'paused':null}});
    if(change==='extraction')await writeFile(path.join(dataDir,'extractions','real.json'),JSON.stringify({...extracted,updatedAt:'changed'}));
    expect((await (await recoverRequest('list')).json()).previews).toEqual([]);
    expect((await recoverRequest('restore',draft.id)).status).toBe(400);
  }
  expect(generateWithDeepSeek).toHaveBeenCalledTimes(1);
});
