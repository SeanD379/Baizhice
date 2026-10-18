import { beforeAll,afterAll,afterEach,expect,it,vi } from 'vitest';
vi.mock('./db',async()=>{
  const {PrismaClient}=await import('@prisma/client'),fs=await import('node:fs/promises'),path=await import('node:path');
  await fs.mkdir(path.resolve('tmp'),{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('tmp/practice-history-'));
  return {dataDir,db:new PrismaClient({datasources:{db:{url:`file:${path.join(dataDir,'test.db').replaceAll('\\','/')}`}}})};
});
import { db } from './db';
import { GET } from '../app/api/practice/history/route';
import { hashContent } from './generation';
import { blankSession } from './practice-session';
import { practiceQuestions } from './practice';
import { publicMaterial,publicVersion } from './server';
const section={id:'conditional',title:'旧知识点',body:'旧材料正文',refs:[{materialId:'m',name:'历史资料.docx',page:2,snippet:'旧引用'}],needsReview:false};
const question={id:'q',kind:'short',topic:'主题',prompt:'旧题干',answer:'旧参考答案',explanation:'旧解析',criteria:['旧评分要点'],reference:section.refs[0]};
const read=(course='course',format='json')=>GET(new Request(`http://127.0.0.1:4173/api/practice/history?courseId=${course}&format=${format}`));
beforeAll(async()=>{
  for(const sql of [
    'CREATE TABLE Course (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE Material (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, folderId TEXT, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL, filePath TEXT NOT NULL, fixture TEXT, chapter TEXT NOT NULL DEFAULT "未分类", status TEXT NOT NULL DEFAULT "stored", excluded BOOLEAN NOT NULL DEFAULT 0, conflictResolution TEXT, conflictFeedbackReason TEXT, conflictFeedbackNote TEXT, conflictResolvedAt DATETIME, origin TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE Version (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, sourceIds TEXT NOT NULL, summary TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(courseId,number))',
    'CREATE TABLE PracticeSet (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, versionId TEXT NOT NULL, questions TEXT NOT NULL, sectionIds TEXT NOT NULL, sourceHash TEXT NOT NULL, model TEXT NOT NULL, reviewed BOOLEAN NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE PracticeRound (id TEXT PRIMARY KEY, scope TEXT NOT NULL, revision INTEGER NOT NULL, courseId TEXT NOT NULL, versionId TEXT NOT NULL, questions TEXT NOT NULL, content TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(scope,revision))',
    'CREATE TABLE PracticeSession (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, versionId TEXT NOT NULL, content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updatedAt DATETIME NOT NULL)',
  ])await db.$executeRawUnsafe(sql);
  await db.course.create({data:{id:'course',name:'测试课程'}});
  await db.course.create({data:{id:'other',name:'其他课程'}});
  await db.material.create({data:{id:'m',courseId:'course',name:'历史资料.docx',mime:'application/pdf',size:100,hash:'hash',filePath:'private-path',origin:'test',status:'ready',fixture:'conditional'}});
  await db.version.create({data:{id:'v',courseId:'course',number:1,title:'旧材料',content:JSON.stringify([section]),sourceIds:'["m"]',summary:'旧快照'}});
});
afterEach(async()=>{await db.practiceRound.deleteMany();await db.practiceSession.deleteMany();await db.practiceSet.deleteMany();await db.version.deleteMany({where:{id:{not:'v'}}});await db.material.update({where:{id:'m'},data:{excluded:false}});});
afterAll(async()=>{await db.$disconnect();});
async function seed(){
  await db.practiceSet.create({data:{id:'set',courseId:'course',versionId:'v',questions:JSON.stringify([question]),sectionIds:'["conditional"]',sourceHash:'old-source-hash',model:'mock',reviewed:false}});
  const id=hashContent(JSON.stringify(['v','set',[question]]));
  const state={...blankSession(),ids:['q'],answers:{q:'当时的回答'},results:{q:{answer:'当时的回答',correct:false}},finished:true,attempts:[{id:'q',correct:false,at:'2026-09-10'}]};
  await db.practiceSession.create({data:{id,courseId:'course',versionId:'v',content:JSON.stringify(state)}});
  return state;
}
it('reads old snapshots and original judgements after source exclusion and a new version without mutation',async()=>{
  const state=await seed();
  await db.material.update({where:{id:'m'},data:{excluded:true}});
  await db.version.create({data:{id:'v2',courseId:'course',number:2,title:'新材料',content:'[]',sourceIds:'[]',summary:'更新'}});
  const before=await db.practiceSession.findMany();
  const response=await read();expect(response.status).toBe(200);
  const data=await response.json();expect(data.entries).toHaveLength(1);
  expect(data.entries[0]).toMatchObject({questions:[question],sourceHash:'old-source-hash',reviewed:false,snapshot:'saved',version:{id:'v',sections:[section]},session:{state}});
  expect(await db.practiceSession.findMany()).toEqual(before);
  expect((await db.practiceSet.findUniqueOrThrow({where:{id:'set'}})).reviewed).toBe(false);
  expect(JSON.stringify(data)).not.toContain('private-path');
});
it('scopes both JSON and export to the course and rejects missing courses',async()=>{
  await seed();expect((await (await read('other')).json()).entries).toEqual([]);
  expect(await (await read('other','markdown')).text()).not.toContain('旧题干');
  expect((await read('missing')).status).toBe(400);expect((await read('')).status).toBe(400);
});
it('exports stored answers, criteria, attempts, source location and material version',async()=>{
  await seed();const response=await read('course','markdown');expect(response.headers.get('Content-Disposition')).toContain('attachment');
  const text=await response.text();for(const value of ['旧题干','旧参考答案','旧评分要点','当时的回答','需要巩固','2026-09-10','第 2 段','旧引用','旧材料正文','版本标识：v','未核对'])expect(text).toContain(value);
});
it('recovers demo sessions only when reconstructed questions exactly match the saved scope',async()=>{
  const material=publicMaterial(await db.material.findUniqueOrThrow({where:{id:'m'}}));
  const version=publicVersion(await db.version.findUniqueOrThrow({where:{id:'v'}}));
  const questions=practiceQuestions([material],version).slice(0,1);
  expect(questions).toHaveLength(1);
  const id=hashContent(JSON.stringify(['v','demo',questions]));
  await db.practiceSession.create({data:{id,courseId:'course',versionId:'v',content:JSON.stringify({...blankSession(),ids:[questions[0].id],answers:{[questions[0].id]:'草稿'}})}});
  await db.material.update({where:{id:'m'},data:{excluded:true}});
  const entry=(await (await read()).json()).entries[0];expect(entry.snapshot).toBe('reconstructed');expect(entry.questions).toEqual(questions);
});
it('keeps unmatched legacy answers readable without inventing question snapshots or regrading',async()=>{
  const state={...blankSession(),ids:['unknown'],answers:{unknown:'保留旧答案'},results:{unknown:{answer:'保留旧答案',correct:true}}};
  await db.practiceSession.create({data:{id:'unmatched',courseId:'course',versionId:'v',content:JSON.stringify(state)}});
  const entry=(await (await read()).json()).entries[0];expect(entry.snapshot).toBe('missing');expect(entry.questions).toEqual([]);expect(entry.session.state).toEqual(state);
});
it('includes previous unattempted sets and never attaches a foreign-version session',async()=>{
  await seed();await db.practiceSet.create({data:{id:'set2',courseId:'course',versionId:'v',questions:JSON.stringify([question]),sectionIds:'[]',sourceHash:'another',model:'mock'}});
  const entries=(await (await read()).json()).entries;expect(entries).toHaveLength(2);expect(entries.find((e:{id:string})=>e.id==='set2').session).toBeNull();
});
it('keeps archived rounds readable after the active session has new answers',async()=>{
  const old=await seed();
  await db.practiceRound.create({data:{scope:'scope',revision:1,courseId:'course',versionId:'v',questions:JSON.stringify([question]),content:JSON.stringify(old)}});
  await db.practiceSession.updateMany({data:{content:JSON.stringify({...blankSession(),ids:['q'],answers:{q:'新一轮草稿'}})}});
  const data=await (await read()).json();
  const archive=data.entries.find((e:{archived?:boolean})=>e.archived);
  expect(archive.session.state.answers.q).toBe('当时的回答');
  expect(await (await read('course','markdown')).text()).toContain('当时的回答');
});
it('withholds current exam answers in history JSON and export until submission',async()=>{
  const material=publicMaterial(await db.material.findUniqueOrThrow({where:{id:'m'}}));
  const version=publicVersion(await db.version.findUniqueOrThrow({where:{id:'v'}}));
  const questions=practiceQuestions([material],version),id=hashContent(JSON.stringify(['v','demo',questions]));
  await db.practiceSession.create({data:{id,courseId:'course',versionId:'v',content:JSON.stringify({...blankSession(),mode:'exam',ids:questions.map(q=>q.id),answers:{[questions[0].id]:'我的答案'}})}});
  const entry=(await (await read()).json()).entries[0];
  expect(entry.withheld).toBe(true);expect(entry.questions).toEqual([]);expect(entry.version.sections).toEqual([]);
  const exported=await (await read('course','markdown')).text();
  expect(exported).toContain('未交卷');expect(exported).not.toContain(questions[0].explanation);
  await db.practiceSession.update({where:{id},data:{content:JSON.stringify({...blankSession(),mode:'exam',submitted:true,ids:questions.map(q=>q.id),answers:{}})}});
  expect((await (await read()).json()).entries[0].questions).toEqual(questions);
});
