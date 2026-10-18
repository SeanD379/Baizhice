import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
vi.mock('./db', async () => {
  const {PrismaClient}=await import('@prisma/client'),fs=await import('node:fs/promises'),path=await import('node:path');
  await fs.mkdir('tmp',{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('tmp/material-study-'));
  return {dataDir,db:new PrismaClient({datasources:{db:{url:`file:${path.join(dataDir,'test.db').replaceAll('\\','/')}`}}})};
});
vi.mock('./deepseek',()=>({deepSeekConfig:()=>({configured:true,model:'test'}),generateWithDeepSeek:vi.fn()}));
import { db, dataDir } from './db';
import { generateWithDeepSeek } from './deepseek';
import { saveMaterialAnnotation, selectedReferences, listMaterialAnnotations, readAnnotationImage, deleteMaterialAnnotation } from './material-annotation-store';
import { organizeMaterial, getMaterialStudyTask, listMaterialStudyTasks, reviseMaterialStudy, adoptMaterialStudy } from './material-study-store';
import { annotationAnchorSchema, knowledgeBatches, mergeStudyCandidates, validateSupplementOutput } from './material-study';
import { getNotebook, saveNotebook } from './notebook-store';
import { emptyNotebook, markdownDocument, richText, sourceBlocks } from './notebook';
import type { SourcePage } from './generation';
import type { MaterialStudyTask } from './material-study';
import type { OriginalQuestion } from './question-bank-types';
import { examProtection } from './exam-protection';
import { materialStudyGet } from './material-study-api';
import { questionRefKey } from './practice-hub';
import { materialStudyAction } from './material-study-api';
import { prepareQuestionBanks, reviseBankQuestion } from './question-bank-store';

const tables=[
  'CREATE TABLE PracticeQuestionState (id TEXT PRIMARY KEY,courseId TEXT NOT NULL,refKey TEXT NOT NULL,ref TEXT NOT NULL,favorite BOOLEAN NOT NULL DEFAULT 0,manualWrong BOOLEAN NOT NULL DEFAULT 0,tags TEXT NOT NULL DEFAULT "[]",note TEXT NOT NULL DEFAULT "",consolidatedAt DATETIME,revision INTEGER NOT NULL DEFAULT 1,updatedAt DATETIME NOT NULL,UNIQUE(courseId,refKey))',
  'CREATE TABLE Course (id TEXT PRIMARY KEY,name TEXT NOT NULL,createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
  'CREATE TABLE Material (id TEXT PRIMARY KEY,courseId TEXT NOT NULL,folderId TEXT,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,hash TEXT NOT NULL,filePath TEXT NOT NULL,fixture TEXT,chapter TEXT NOT NULL DEFAULT "未分类",status TEXT NOT NULL DEFAULT "stored",excluded BOOLEAN NOT NULL DEFAULT 0,conflictResolution TEXT,conflictFeedbackReason TEXT,conflictFeedbackNote TEXT,conflictResolvedAt DATETIME,origin TEXT NOT NULL,createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
  'CREATE TABLE MaterialAnnotation (id TEXT PRIMARY KEY,courseId TEXT NOT NULL,materialId TEXT NOT NULL,sourceHash TEXT NOT NULL,content TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,updatedAt DATETIME NOT NULL)',
  'CREATE TABLE MaterialStudyTask (id TEXT PRIMARY KEY,courseId TEXT NOT NULL,fingerprint TEXT NOT NULL,content TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,updatedAt DATETIME NOT NULL,UNIQUE(courseId,fingerprint))',
  'CREATE TABLE Version (id TEXT PRIMARY KEY,courseId TEXT NOT NULL,number INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,sourceIds TEXT NOT NULL,summary TEXT NOT NULL,createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
  'CREATE TABLE Notebook (courseId TEXT PRIMARY KEY,content TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updatedAt DATETIME NOT NULL)',
  'CREATE TABLE NotebookSnapshot (id TEXT PRIMARY KEY,courseId TEXT NOT NULL,content TEXT NOT NULL,summary TEXT NOT NULL,createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
  'CREATE TABLE NotebookMutation (courseId TEXT NOT NULL,requestId TEXT NOT NULL,fingerprint TEXT NOT NULL,revision INTEGER NOT NULL,createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(courseId,requestId))',
  'CREATE TABLE OriginalPracticeSession (id TEXT PRIMARY KEY,courseId TEXT NOT NULL,context TEXT NOT NULL,content TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updatedAt DATETIME NOT NULL)',
  'CREATE TABLE PracticeSession (id TEXT PRIMARY KEY,courseId TEXT NOT NULL,versionId TEXT NOT NULL,content TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updatedAt DATETIME NOT NULL)',
  'CREATE TABLE OriginalQuestionBank (id TEXT PRIMARY KEY,courseId TEXT NOT NULL,materialId TEXT NOT NULL,sourceHash TEXT NOT NULL,content TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,updatedAt DATETIME NOT NULL,UNIQUE(materialId,sourceHash))',
];
beforeAll(async()=>{for(const sql of tables)await db.$executeRawUnsafe(sql);await db.course.create({data:{id:'c',name:'学习整理测试'}});await mkdir(path.join(dataDir,'extractions'),{recursive:true});});
afterAll(async()=>db.$disconnect());
async function material(id='m',texts=['条件成立时，概念甲可用于解释关系乙。']) {
  const saved=await db.material.create({data:{id,courseId:'c',name:`${id}.docx`,mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:1,hash:id.repeat(64).slice(0,64),filePath:'unused',origin:'test',status:'extracted'}});
  await writeFile(path.join(dataDir,'extractions',`${id}.json`),JSON.stringify({state:'complete',pageCount:texts.length,sourceCount:texts.length,continuation:{startSource:1,hasMore:false},durationMs:1,updatedAt:'2026-10-04',pages:texts.map((text,index)=>({page:index+1,text,method:'docx-text',state:'extracted',warnings:[]}))}));
  return saved;
}
beforeEach(async()=>{await db.practiceQuestionState.deleteMany();await db.originalPracticeSession.deleteMany();await db.practiceSession.deleteMany();await db.originalQuestionBank.deleteMany();await db.materialStudyTask.deleteMany();await db.materialAnnotation.deleteMany();await db.notebookMutation.deleteMany();await db.notebookSnapshot.deleteMany();await db.notebook.deleteMany();await db.version.deleteMany();await db.material.deleteMany();vi.clearAllMocks();await material();vi.mocked(generateWithDeepSeek).mockImplementation(async pages=>({model:'test',output:{sections:[{title:'概念甲的条件',body:'条件成立时可用概念甲解释关系乙。',refs:[{materialId:pages[0].materialId,page:pages[0].page,snippet:pages[0].text.slice(0,100)}]}],warnings:[]}}));});
async function finished(task:MaterialStudyTask){await vi.waitFor(async()=>{const row=await db.materialStudyTask.findUniqueOrThrow({where:{id:task.id}});expect(['queued','running']).not.toContain(JSON.parse(row.content).state);},{timeout:5000});return getMaterialStudyTask('c',task.id);}
const anchor=(quote='条件成立时，概念甲可用于解释关系乙。')=>annotationAnchorSchema.parse({kind:'text',quote,displayPage:1,rects:[]});
it.each(['notebook','mistakes','papers'] as const)('persists and adopts a reviewed question into %s without creating practice attempts',async destination=>{
  await db.material.deleteMany();await material('m',['名词解释','1.汇率']);
  vi.mocked(generateWithDeepSeek).mockImplementation(async(_pages,_annotations,_preset,questions=[])=>({model:'test',output:{sections:[],questionIds:questions.map(question=>question.id),warnings:[]}}));
  const task=await finished(await organizeMaterial({courseId:'c',mode:'material',routing:'auto',materialIds:['m'],confirmed:true}));
  const candidate=task.sections[0];
  const editedResponse=await materialStudyAction({action:'study-edit',courseId:'c',taskId:task.id,revision:task.revision,edits:[{id:candidate.id,title:candidate.title,body:candidate.body,destination}]});
  const edited=(await editedResponse.json()).task as MaterialStudyTask;expect(edited.sections[0].destination).toBe(destination);expect(edited.sections[0].review).toBe('pending');
  const approved=await reviseMaterialStudy({courseId:'c',taskId:task.id,revision:edited.revision,approveIds:[candidate.id]});
  if(destination==='mistakes'){const ref={engine:'original' as const,materialId:candidate.question!.materialId,questionId:candidate.question!.id};await db.practiceQuestionState.create({data:{courseId:'c',refKey:questionRefKey(ref),ref:JSON.stringify(ref),favorite:true,tags:'["保留标签"]',note:'个人笔记',consolidatedAt:new Date()}});}
  const notebook=destination==='notebook'?await getNotebook('c'):undefined;
  const saved=await adoptMaterialStudy({courseId:'c',taskId:task.id,revision:approved.revision,chosenIds:[candidate.id],targets:destination==='notebook'?[{sectionId:candidate.id,chapterTitle:'题目笔记'}]:[],...(notebook?{notebookRevision:notebook.revision}:{})});
  expect(saved.sections[0].review).toBe('adopted');expect(await db.originalPracticeSession.count()).toBe(0);
  if(destination==='notebook'){expect(await db.originalQuestionBank.count()).toBe(0);expect((await getNotebook('c')).document.pages.some(page=>JSON.stringify(page.doc).includes('汇率'))).toBe(true);}
  else{const bank=JSON.parse((await db.originalQuestionBank.findFirstOrThrow()).content);expect(bank.questions[0].practiceArea).toBe(destination==='papers'?'papers':'knowledge');expect(saved.sections[0].practice).toMatchObject({section:destination});if(destination==='mistakes')expect(await db.practiceQuestionState.findFirst()).toMatchObject({manualWrong:true,favorite:true,tags:'["保留标签"]',note:'个人笔记',consolidatedAt:null});expect(await db.notebook.count()).toBe(0);}
});
it('rejects sending knowledge without a question to a practice destination',async()=>{
  const task=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true}));const candidate=task.sections[0];
  await expect(materialStudyAction({action:'study-edit',courseId:'c',taskId:task.id,revision:task.revision,edits:[{id:candidate.id,title:candidate.title,body:candidate.body,destination:'papers'}]})).rejects.toThrow('只有题目草稿可以收录到练习中心');
});
it('returns only the requested material drafts without rewriting other tasks',async()=>{
  await material('other');
  const first=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true}));
  const other=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['other'],confirmed:true}));
  const response=await materialStudyGet(new URLSearchParams({action:'study-list',courseId:'c',materialId:'m'}));
  expect((await response.json()).tasks.map((task:MaterialStudyTask)=>task.id)).toEqual([first.id]);
  expect(await db.materialStudyTask.count()).toBe(2);expect((await getMaterialStudyTask('c',other.id)).sections).toHaveLength(1);
});
it('sanitizes stored model errors when reading a draft without modifying saved metadata',async()=>{
  vi.mocked(generateWithDeepSeek).mockRejectedValue(new Error('DeepSeek 返回了无法读取的内容，没有创建新版本，请重试。'));
  const task=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true}));
  expect(task.error).toBe('AI 助手返回的整理结果格式有误，已完成的草稿已保留，请重试本批次。');
  expect(JSON.parse((await db.materialStudyTask.findUniqueOrThrow({where:{id:task.id}})).content).error).toContain('DeepSeek');
});

it('stages detected questions for review and adopts only approved questions into knowledge practice',async()=>{
  await db.material.deleteMany();await material('m',['名词解释','1.金融远期','2.保本基金']);
  vi.mocked(generateWithDeepSeek).mockImplementation(async(_pages,_annotations,_preset,questions=[])=>({model:'test',output:{sections:[],questionIds:questions.map(question=>question.id),warnings:[]}}));
  const input={courseId:'c',mode:'material' as const,routing:'auto' as const,materialIds:['m'],confirmed:true};
  const launched=await materialStudyAction({action:'study-organize',...input}),task=await finished((await launched.json()).task);
  expect(task.state).toBe('ready');expect(task.sections).toHaveLength(2);expect(task.sections.every(section=>section.destination==='practice'&&section.review==='pending')).toBe(true);
  expect(task.sections[0].question).toMatchObject({prompt:'金融远期',answer:'',answerSource:'none'});expect(task.sections[0].refs[0].snippet).toBe('金融远期');
  expect(await db.originalQuestionBank.count()).toBe(0);expect(await db.notebook.count()).toBe(0);
  expect((await organizeMaterial(input)).id).toBe(task.id);
  await expect(adoptMaterialStudy({courseId:'c',taskId:task.id,revision:task.revision,chosenIds:[task.sections[0].id],targets:[]})).rejects.toThrow(/审核/);
  const edited=await reviseMaterialStudy({courseId:'c',taskId:task.id,revision:task.revision,edits:[{id:task.sections[0].id,title:task.sections[0].title,body:task.sections[0].body,question:{prompt:'金融远期',answer:'用户核对后的参考答案。',explanation:'用户核对后的解析。'}}]});
  const approved=await reviseMaterialStudy({courseId:'c',taskId:task.id,revision:edited.revision,approveIds:[task.sections[0].id]});
  const savedResponse=await materialStudyAction({action:'study-adopt',courseId:'c',taskId:task.id,revision:approved.revision,chosenIds:[task.sections[0].id],targets:[]}),adopted=(await savedResponse.json()).task as MaterialStudyTask;
  expect(adopted.sections[0]).toMatchObject({review:'adopted',practice:{materialId:'m',questionId:task.sections[0].question!.id}});expect(adopted.sections[1].review).toBe('pending');
  const bank=await db.originalQuestionBank.findFirstOrThrow();const saved=JSON.parse(bank.content).questions as OriginalQuestion[];
  expect(saved).toHaveLength(1);expect(saved[0]).toMatchObject({prompt:'金融远期',answer:'用户核对后的参考答案。',answerSource:'manual',practiceArea:'knowledge'});
  expect(await db.notebook.count()).toBe(0);expect(await db.version.count()).toBe(0);
  await adoptMaterialStudy({courseId:'c',taskId:task.id,revision:approved.revision,chosenIds:[task.sections[0].id],targets:[]});expect(await db.originalQuestionBank.count()).toBe(1);
});

it('keeps mixed knowledge and questions in one draft and sends each approved item to its destination',async()=>{
  await db.material.deleteMany();await material('m',['知识点讲解','汇率是两种货币之间的兑换比率。','名词解释','1.金融远期']);
  vi.mocked(generateWithDeepSeek).mockImplementation(async(_pages,_annotations,_preset,questions=[])=>({model:'test',output:{sections:[{title:'汇率',body:'汇率是两种货币之间的兑换比率。',refs:[{materialId:'m',page:2,snippet:'汇率是两种货币之间的兑换比率。'}]}],questionIds:questions.map(question=>question.id),warnings:[]}}));
  const task=await finished(await organizeMaterial({courseId:'c',mode:'material',routing:'auto',materialIds:['m'],confirmed:true}));
  expect(task.sections.map(section=>section.destination)).toEqual(['notebook','practice']);expect(await db.originalQuestionBank.count()).toBe(0);
  const reviewed=await reviseMaterialStudy({courseId:'c',taskId:task.id,revision:task.revision,approveIds:task.sections.map(section=>section.id)}),notebook=await getNotebook('c');
  const adopted=await adoptMaterialStudy({courseId:'c',taskId:task.id,revision:reviewed.revision,chosenIds:task.sections.map(section=>section.id),notebookRevision:notebook.revision,targets:[{sectionId:task.sections[0].id,chapterTitle:'知识整理'}]});
  expect(adopted.sections.every(section=>section.review==='adopted')).toBe(true);expect(adopted.sections[0].adopted).toHaveLength(1);expect(adopted.sections[1].practice?.materialId).toBe('m');
  const version=await db.version.findFirstOrThrow();expect(JSON.parse(version.content)).toHaveLength(1);expect((await getNotebook('c')).document.pages).toHaveLength(1);expect(await db.originalQuestionBank.count()).toBe(1);
});

it('rejects invented question IDs during automatic organization',async()=>{
  vi.mocked(generateWithDeepSeek).mockResolvedValue({model:'test',output:{sections:[],questionIds:['invented'],warnings:[]}});
  const task=await finished(await organizeMaterial({courseId:'c',mode:'material',routing:'auto',materialIds:['m'],confirmed:true}));
  expect(task.state).toBe('failed');expect(task.sections).toEqual([]);expect(task.error).toContain('原题');expect(await db.originalQuestionBank.count()).toBe(0);
});

it('uses existing corrected answers in drafts and protects later question-bank edits',async()=>{
  await db.material.deleteMany();await material('m',['名词解释','1.金融远期']);const [bank]=await prepareQuestionBanks('c',['m']);
  const corrected=await reviseBankQuestion('c',bank.id,bank.revision,bank.questions[0].id,{answer:'已有人工答案'});
  vi.mocked(generateWithDeepSeek).mockImplementation(async(_pages,_annotations,_preset,questions=[])=>({model:'test',output:{sections:[],questionIds:questions.map(question=>question.id),warnings:[]}}));
  const task=await finished(await organizeMaterial({courseId:'c',mode:'material',routing:'auto',materialIds:['m'],confirmed:true}));expect(task.sections[0].question?.answer).toBe('已有人工答案');
  const approved=await reviseMaterialStudy({courseId:'c',taskId:task.id,revision:task.revision,approveIds:[task.sections[0].id]});
  await reviseBankQuestion('c',bank.id,corrected.revision,bank.questions[0].id,{answer:'另一窗口保存的最新答案'});
  await expect(adoptMaterialStudy({courseId:'c',taskId:task.id,revision:approved.revision,chosenIds:[task.sections[0].id],targets:[]})).rejects.toThrow(/来源变化|原题已/);
  expect(JSON.parse((await db.originalQuestionBank.findUniqueOrThrow({where:{id:bank.id}})).content).questions[0].answer).toBe('另一窗口保存的最新答案');
});

it('refreshes an old running snapshot when the worker completed during a task read',async()=>{
  const task=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true}));
  const row=await db.materialStudyTask.findUniqueOrThrow({where:{id:task.id}});
  const spy=vi.spyOn(db.materialStudyTask,'findFirst').mockResolvedValueOnce({...row,revision:row.revision-1,content:JSON.stringify({...JSON.parse(row.content),state:'running'})});
  try {expect((await getMaterialStudyTask('c',task.id)).state).toBe('ready');}finally{spy.mockRestore();}
});

it('saves source-grounded annotations without calling AI and rejects stale revisions',async()=>{
  const first=await saveMaterialAnnotation('m',{anchor:anchor(),instruction:'整理成概念和适用条件',confirmedText:true});
  expect(first.refs[0]).toMatchObject({page:1,location:'paragraph',snippet:anchor().quote});expect(generateWithDeepSeek).not.toHaveBeenCalled();
  const changed=await saveMaterialAnnotation('m',{id:first.id,revision:first.revision,anchor:anchor(),instruction:'强调适用条件',confirmedText:true});expect(changed.revision).toBe(2);
  await expect(saveMaterialAnnotation('m',{id:first.id,revision:first.revision,anchor:anchor(),instruction:'旧窗口修改',confirmedText:true})).rejects.toThrow(/另一页面/);
  expect((await listMaterialAnnotations('c'))[0].instruction).toBe('强调适用条件');
});
it('locates Word selections across original paragraphs instead of browser pages',()=>{
  const pages:SourcePage[]=[{materialId:'m',name:'m.docx',page:3,text:'概念甲的定义',extractionHash:'hash',method:'docx-text',warnings:[]},{materialId:'m',name:'m.docx',page:4,text:'适用于条件乙',extractionHash:'hash',method:'docx-text',warnings:[]}];
  const references=selectedReferences({id:'m',name:'m.docx',hash:'hash'},anchor('概念甲的定义\n适用于条件乙'),pages,true);
  expect(references.map(reference=>reference.page)).toEqual([3,4]);expect(references.every(reference=>reference.location==='paragraph')).toBe(true);
  expect(()=>selectedReferences({id:'m',name:'m.docx',hash:'hash'},anchor('概念'),[...pages,{...pages[0],page:7}],true)).toThrow(/多次/);
});
it('restores saved region images after edits without uploading them again and protects material ownership',async()=>{
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const selection=annotationAnchorSchema.parse({kind:'region',displayPage:1,quote:'',rects:[{x:.1,y:.2,width:.4,height:.1}]});
  const saved=await saveMaterialAnnotation('m',{anchor:selection,instruction:'稍后核对原图文字',confirmedText:false,image});
  expect(saved.hasImage).toBe(true);expect(saved.refs).toEqual([]);expect(generateWithDeepSeek).not.toHaveBeenCalled();
  const edited=await saveMaterialAnnotation('m',{id:saved.id,revision:saved.revision,anchor:selection,instruction:'保留框选图，人工核对后再整理',confirmedText:false});
  expect(edited.hasImage).toBe(true);expect((await listMaterialAnnotations('c'))[0].hasImage).toBe(true);
  expect(await readAnnotationImage('m',saved.id)).toEqual(Buffer.from(image.split(',')[1],'base64'));
  await expect(readAnnotationImage('another-material',saved.id)).rejects.toThrow(/不存在/);
  await deleteMaterialAnnotation('m',saved.id,edited.revision);await expect(readAnnotationImage('m',saved.id)).rejects.toThrow(/不存在/);
});
it('retains unconfirmed region annotations and uses reviewed region text without inventing printed Word pages',async()=>{
  const selection=annotationAnchorSchema.parse({kind:'region',displayPage:2,quote:'图示区域中的概念说明',rects:[{x:.1,y:.2,width:.4,height:.1}]});
  const pending=await saveMaterialAnnotation('m',{anchor:selection,instruction:'整理图中的含义',confirmedText:false});expect(pending.refs).toEqual([]);
  await expect(organizeMaterial({courseId:'c',mode:'annotations',annotationIds:[pending.id],confirmed:true})).rejects.toThrow(/已核对/);
  const confirmed=await saveMaterialAnnotation('m',{id:pending.id,revision:pending.revision,anchor:selection,instruction:'整理图中的含义',confirmedText:true});
  expect(confirmed.refs[0]).toMatchObject({location:'image',anchor:{displayPage:2}});
  const task=await finished(await organizeMaterial({courseId:'c',mode:'annotations',annotationIds:[confirmed.id],confirmed:true}));
  expect(task.sections[0].refs[0]).toMatchObject({page:2,location:'image',anchor:{displayPage:2}});expect(task.stale).toBe(false);
});
it('sends only the selected crop and complete regional text, without storing image bytes in the task',async()=>{
  await material('selected',['图内第一句定义。','图内第二句条件。','邻近未选中的内容。']);
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const quote='图内第一句定义。\n图内第二句条件。',selection=annotationAnchorSchema.parse({kind:'region',displayPage:1,quote,rects:[{x:.1,y:.1,width:.4,height:.3}],recognition:{sourceText:quote,ocrText:quote,confidence:98}});
  const annotation=await saveMaterialAnnotation('selected',{anchor:selection,instruction:'归纳框内定义和条件',confirmedText:true,image});
  await saveMaterialAnnotation('m',{anchor:annotationAnchorSchema.parse({...selection,quote:''}),instruction:'没有选择的另一张图',confirmedText:true,image});
  vi.mocked(generateWithDeepSeek).mockImplementation(async()=>({model:'test',output:{sections:[{title:'图内概念',body:'图内定义和条件。',annotationIds:[annotation.id]}],warnings:[]}}));
  const task=await finished(await organizeMaterial({courseId:'c',mode:'annotations',annotationIds:[annotation.id],confirmed:true}));
  const [pages,instructions]=vi.mocked(generateWithDeepSeek).mock.calls[0];expect(pages).toHaveLength(1);expect(pages[0].text).toBe(quote);expect(JSON.stringify(pages)).not.toContain('邻近');expect(instructions!.every(item=>item.annotationId===annotation.id&&item.image===image)).toBe(true);
  expect(task.sections[0].refs).toEqual(annotation.refs);expect(task.sections[0].generation?.contentOrigin).toBe('source');expect(task.sections[0].review).toBe('pending');
  expect((await db.materialStudyTask.findUniqueOrThrow({where:{id:task.id}})).content).not.toContain('data:image');expect(await db.notebook.count()).toBe(0);
});
it('organizes an image-only region with its real image anchor and no invented quotation',async()=>{
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const selection=annotationAnchorSchema.parse({kind:'region',displayPage:1,quote:'',rects:[{x:.1,y:.1,width:.4,height:.3}]});
  const annotation=await saveMaterialAnnotation('m',{anchor:selection,instruction:'整理图中可见关系',confirmedText:true,image});
  expect(annotation.refs[0]).toMatchObject({snippet:'',location:'image',anchor:{rects:selection.rects}});
  const edited=await saveMaterialAnnotation('m',{id:annotation.id,revision:annotation.revision,anchor:selection,instruction:'整理图中可见关系',confirmedText:true});expect(edited.refs).toEqual(annotation.refs);
  vi.mocked(generateWithDeepSeek).mockResolvedValue({model:'test',output:{sections:[{title:'图像关系',body:'图中可见的关系。',annotationIds:[annotation.id]}],warnings:[]}});
  const task=await finished(await organizeMaterial({courseId:'c',mode:'annotations',annotationIds:[annotation.id],confirmed:true}));expect(task.state).toBe('ready');expect(task.sections[0].refs).toEqual(annotation.refs);expect(vi.mocked(generateWithDeepSeek).mock.calls[0][1]![0].image).toBe(image);
});
it('limits a visual batch to eight selected regions to keep inline images within the API body limit',async()=>{
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',ids:string[]=[];
  for(let index=0;index<9;index++){const saved=await saveMaterialAnnotation('m',{anchor:annotationAnchorSchema.parse({kind:'region',displayPage:1,quote:'',rects:[{x:.1,y:.1,width:.1,height:.1}]}),instruction:`图像 ${index}`,confirmedText:true,image});ids.push(saved.id);}
  vi.mocked(generateWithDeepSeek).mockImplementation(async(_pages,annotations)=>({model:'test',output:{sections:[{title:annotations![0].instruction,body:'选区图像内容。',annotationIds:[annotations![0].annotationId]}],warnings:[]}}));
  const task=await finished(await organizeMaterial({courseId:'c',mode:'annotations',annotationIds:ids,confirmed:true}));expect(task.total).toBe(2);expect(vi.mocked(generateWithDeepSeek).mock.calls.map(call=>call[1]!.length)).toEqual([8,1]);
});
it('marks source-file and extraction changes stale while retaining the annotation',async()=>{
  const saved=await saveMaterialAnnotation('m',{anchor:anchor(),instruction:'保存知识点',confirmedText:true});
  await unlink(path.join(dataDir,'extractions/m.json'));expect((await listMaterialAnnotations('c'))[0]).toMatchObject({id:saved.id,stale:true});
  await db.material.update({where:{id:'m'},data:{hash:'replaced'}});expect((await listMaterialAnnotations('c'))[0].stale).toBe(true);
});
it('organizes annotations from multiple files and reuses the same persistent task',async()=>{
  await material('n',['另一个文件也说明条件成立时，概念甲可用于解释关系乙。']);
  const a=await saveMaterialAnnotation('m',{anchor:anchor(),instruction:'归纳条件',confirmedText:true}),b=await saveMaterialAnnotation('n',{anchor:anchor(),instruction:'对照前一份解释',confirmedText:true});
  const input={courseId:'c',mode:'annotations' as const,annotationIds:[a.id,b.id],confirmed:true};
  const task=await finished(await organizeMaterial(input)),again=await organizeMaterial(input);
  expect(again.id).toBe(task.id);expect(await db.materialStudyTask.count()).toBe(1);expect(generateWithDeepSeek).toHaveBeenCalledOnce();
  expect(vi.mocked(generateWithDeepSeek).mock.calls[0][0].map(page=>page.materialId)).toEqual(['m','n']);
  expect(vi.mocked(generateWithDeepSeek).mock.calls[0][1]?.map(annotation=>annotation.instruction)).toEqual(['归纳条件','对照前一份解释']);
  expect(await db.notebook.count()).toBe(0);
});
it('keeps all long content in bounded batches including a single oversized page',()=>{
  const pages=[{id:'long',text:('完整原文。\n').repeat(17000)},...Array.from({length:25},(_,index)=>({id:`page-${index}`,text:`完整来源${index}`}))];
  const batches=knowledgeBatches(pages);expect(batches.every(batch=>batch.length<=20&&batch.reduce((length,page)=>length+page.text.length,0)<=40000)).toBe(true);
  expect(batches.flat().filter(page=>page.id==='long').map(page=>page.text).join('')).toBe(pages[0].text);expect(batches.flat().filter(page=>page.id!=='long')).toHaveLength(25);
  const fragments=knowledgeBatches([{id:'repeated-page',text:'甲'.repeat(19999)+'。'+'乙'.repeat(19999)+'。'+'丙'.repeat(5000)}]);
  expect(fragments).toHaveLength(2);expect(fragments.every(batch=>new Set(batch.map(page=>page.id)).size===batch.length)).toBe(true);
});
it('preserves completed batches and resumes only the unfinished portion after a model failure',async()=>{
  await db.material.deleteMany();await material('m',Array.from({length:21},(_,index)=>`完整概念说明${index}，仅依据当前原文。`));
  vi.mocked(generateWithDeepSeek).mockImplementationOnce(async pages=>({model:'test',output:{sections:[{title:'已完成知识点',body:'来自第一批的解释。',refs:[{materialId:'m',page:1,snippet:pages[0].text}]}],warnings:[]}})).mockRejectedValueOnce(new Error('第二批暂时失败'));
  const partial=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true}));
  expect(partial).toMatchObject({state:'partial',done:1,total:2,error:'第二批暂时失败'});expect(partial.sections).toHaveLength(1);
  const recovered=await finished(await organizeMaterial({courseId:'c',mode:'material',taskId:partial.id,confirmed:true}));expect(recovered.id).toBe(partial.id);expect(recovered.done).toBe(2);expect(recovered.error).toBe('');expect(recovered.sections.some(section=>section.title==='已完成知识点')).toBe(true);
  expect(vi.mocked(generateWithDeepSeek).mock.calls.map(call=>call[0][0].page)).toEqual([1,21,21]);
});
it('requires separate approval after editing and persists exclusions',async()=>{
  const task=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true})),id=task.sections[0].id;
  const approved=await reviseMaterialStudy({courseId:'c',taskId:task.id,revision:task.revision,approveIds:[id]});expect(approved.sections[0].review).toBe('approved');
  const changed=await reviseMaterialStudy({courseId:'c',taskId:task.id,revision:approved.revision,edits:[{id,title:'我修改的标题',body:'我核对后的正文',excluded:true}],approveIds:[id]});
  expect(changed.sections[0]).toMatchObject({title:'我修改的标题',review:'pending',excluded:true});expect((await getMaterialStudyTask('c',task.id)).sections).toEqual(changed.sections);
  await expect(adoptMaterialStudy({courseId:'c',taskId:task.id,revision:changed.revision,chosenIds:[id],notebookRevision:1,targets:[]})).rejects.toThrow(/先审核/);
});
it('appends approved knowledge to an existing page, preserves personal text and makes adoption idempotent',async()=>{
  const notebook=await getNotebook('c');const personal={id:'personal',title:'我的知识页',chapterId:null,doc:markdownDocument('已有个人编辑，必须保留。')};
  const saved=await saveNotebook('c',{...emptyNotebook(),pages:[personal]},notebook.revision,crypto.randomUUID());
  const task=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true})),id=task.sections[0].id;
  const approved=await reviseMaterialStudy({courseId:'c',taskId:task.id,revision:task.revision,approveIds:[id]});
  const input={courseId:'c',taskId:task.id,revision:approved.revision,chosenIds:[id],notebookRevision:saved.revision,targets:[{sectionId:id,pageId:'personal'}]};
  const adopted=await adoptMaterialStudy(input),again=await adoptMaterialStudy(input),result=await getNotebook('c');expect(again.revision).toBe(adopted.revision);
  expect(result.document.pages).toHaveLength(1);expect(richText(result.document.pages[0].doc)).toContain('已有个人编辑，必须保留。');expect(sourceBlocks(result.document.pages[0].doc)).toHaveLength(1);expect((sourceBlocks(result.document.pages[0].doc)[0].attrs?.origin as {needsReview:boolean}).needsReview).toBe(false);
  expect(adopted.sections[0]).toMatchObject({review:'adopted',adopted:[{pageId:'personal',pageTitle:'我的知识页',chapterTitle:'未分类'}]});expect(await db.version.count()).toBe(1);
});
it('rejects concurrent notebook edits without losing the approved draft or overwriting personal content',async()=>{
  const notebook=await getNotebook('c'),task=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true})),id=task.sections[0].id;
  const approved=await reviseMaterialStudy({courseId:'c',taskId:task.id,revision:task.revision,approveIds:[id]});
  await saveNotebook('c',{...emptyNotebook(),pages:[{id:'personal',title:'个人页',chapterId:null,doc:markdownDocument('并发修改内容')} ]},notebook.revision,crypto.randomUUID());
  await expect(adoptMaterialStudy({courseId:'c',taskId:task.id,revision:approved.revision,chosenIds:[id],notebookRevision:notebook.revision,targets:[{sectionId:id,chapterTitle:'新章'}]})).rejects.toThrow(/另一台设备/);
  expect((await getMaterialStudyTask('c',task.id)).sections[0].review).toBe('approved');expect(richText((await getNotebook('c')).document.pages[0].doc)).toBe('并发修改内容');expect(await db.version.count()).toBe(0);
});
it('merges identical explanations with all sources and retains conflicting versions',()=>{
  const ref={materialId:'m',name:'m.pdf',page:1,snippet:'可靠出处'},first={id:'a',title:'概念',body:'解释',refs:[ref],review:'pending' as const};
  const merged=mergeStudyCandidates([first],[{id:'b',title:'概念',body:'解释',refs:[{...ref,materialId:'n'}]},{id:'c',title:'概念',body:'不同解释',refs:[ref]}]);
  expect(merged).toHaveLength(2);expect(merged[0].refs).toHaveLength(2);expect(merged[1].body).toBe('不同解释');
});
it('routes bare question stems to practice without making an AI knowledge request, while accepting mixed lectures',async()=>{
  await db.material.deleteMany();await material('m',['名词解释','1. 金融远期','2. 保本基金']);
  await expect(organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true})).rejects.toThrow(/原题|可靠讲解/);expect(generateWithDeepSeek).not.toHaveBeenCalled();
  await writeFile(path.join(dataDir,'extractions/m.json'),JSON.stringify({state:'complete',pageCount:3,sourceCount:3,continuation:{startSource:1,hasMore:false},durationMs:1,updatedAt:'2026-10-04',pages:['讲义：金融远期是在未来约定时点交割的协议，适用条件为双方事先约定交割价格。','名词解释','1. 金融远期'].map((text,index)=>({page:index+1,text,method:'docx-text',state:'extracted',warnings:[]}))}));
  const mixed=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true}));expect(mixed.sections).toHaveLength(1);expect(generateWithDeepSeek).toHaveBeenCalledOnce();
});

it('keeps different source presets separate while reusing the same confirmed scope',async()=>{
  const annotation=await saveMaterialAnnotation('m',{anchor:anchor(),instruction:'归纳条件',confirmedText:true});
  const tasks=[];
  for(const preset of ['notes','compare','qa'] as const){
    const input={courseId:'c',mode:'annotations' as const,annotationIds:[annotation.id],preset,confirmed:true};
    const task=await finished(await organizeMaterial(input));tasks.push(task);
    expect(task.preset).toBe(preset);expect(task.sections[0].generation?.contentOrigin).toBe('source');
    expect((await organizeMaterial(input)).id).toBe(task.id);
  }
  expect(new Set(tasks.map(task=>task.id)).size).toBe(3);expect(generateWithDeepSeek).toHaveBeenCalledTimes(3);
  expect(vi.mocked(generateWithDeepSeek).mock.calls.map(call=>call[2])).toEqual(['notes','compare','qa']);
  expect(await db.notebook.count()).toBe(0);
});

it.each(['text','region'] as const)('binds a two-character %s concept to its verified annotation without invented citations',async kind=>{
  await db.material.deleteMany();await material('m',['汇率']);
  const selection=annotationAnchorSchema.parse({kind,quote:'汇率',displayPage:2,rects:kind==='region'?[{x:.1,y:.1,width:.2,height:.2}]:[]});
  const annotation=await saveMaterialAnnotation('m',{anchor:selection,instruction:'补充定义与例子',confirmedText:true});
  vi.mocked(generateWithDeepSeek).mockResolvedValue({model:'test',output:{sections:[{title:'汇率',body:'AI 补充定义及示例。',annotationIds:[annotation.id],refs:[{materialId:'invented',page:999,snippet:'虚构依据'}]}],warnings:[]}});
  const task=await finished(await organizeMaterial({courseId:'c',mode:'annotations',preset:'concepts',annotationIds:[annotation.id],confirmed:true}));
  expect(task.state).toBe('ready');expect(task.sections[0].refs).toEqual(annotation.refs);
  expect(task.sections[0].generation).toMatchObject({contentOrigin:'ai-supplement'});expect(task.sections[0].review).toBe('pending');
  expect(await db.notebook.count()).toBe(0);
});

it('rejects supplement references outside the sent annotation snapshot and duplicate IDs',()=>{
  const selected={id:'selected',refs:[{materialId:'m',name:'m.docx',page:1,snippet:'汇率'}]};
  for(const annotationIds of [['other-task'],['selected','selected']])expect(()=>validateSupplementOutput({sections:[{title:'解释',body:'补充内容',annotationIds}],warnings:[]},[selected],'test','draft')).toThrow(/未选中/);
  expect(()=>validateSupplementOutput({sections:[{title:'解释',body:'补充内容',annotationIds:[]}],warnings:[]},[selected],'test','draft')).toThrow(/格式/);
});

it('persists per-concept sources and repairs legacy draft attribution without rewriting it on read',async()=>{
  await db.material.deleteMany();await material('m',['名词解释','1.金融远期','2.保本基金','3.汇率']);
  const annotation=await saveMaterialAnnotation('m',{anchor:anchor('1.金融远期\n2.保本基金\n3.汇率'),instruction:'补充解释',confirmedText:true});
  vi.mocked(generateWithDeepSeek).mockResolvedValue({model:'test',output:{sections:[{title:'金融远期',body:'【定义】补充解释。',annotationIds:[annotation.id]},{title:'汇率',body:'【定义】两种货币的兑换比率。',annotationIds:[annotation.id]}],warnings:[]}});
  const task=await finished(await organizeMaterial({courseId:'c',mode:'annotations',preset:'concepts',annotationIds:[annotation.id],confirmed:true}));
  let row=await db.materialStudyTask.findUniqueOrThrow({where:{id:task.id}});
  const content=JSON.parse(row.content);
  expect(content.sections.map((section:MaterialStudyTask['sections'][number])=>section.refs.map(ref=>ref.snippet))).toEqual([['1.金融远期'],['3.汇率']]);
  content.sections[0].refs=annotation.refs;
  row=await db.materialStudyTask.update({where:{id:row.id},data:{content:JSON.stringify(content)}});
  const read=await getMaterialStudyTask('c',row.id);
  expect(read.sections[0].refs).toHaveLength(1);expect(read.sections[0].refs[0].anchor?.quote).toBe('1.金融远期');
  expect((await db.materialStudyTask.findUniqueOrThrow({where:{id:row.id}})).content).toBe(row.content);
  expect(await db.notebook.count()).toBe(0);
  const reviewed=await reviseMaterialStudy({courseId:'c',taskId:task.id,revision:read.revision,edits:read.sections.map(section=>({id:section.id,title:section.title,body:section.body})),approveIds:[read.sections[0].id]});
  const notebook=await getNotebook('c');
  const adopted=await adoptMaterialStudy({courseId:'c',taskId:task.id,revision:reviewed.revision,chosenIds:[reviewed.sections[0].id],notebookRevision:notebook.revision,targets:[{sectionId:reviewed.sections[0].id,chapterTitle:'概念解释'}]});
  expect(adopted.sections[0].review).toBe('adopted');
  const version=await db.version.findFirstOrThrow({where:{courseId:'c'},orderBy:{number:'desc'}});
  expect(JSON.parse(version.content)[0].refs.map((ref:{snippet:string})=>ref.snippet)).toEqual(['1.金融远期']);
});

it('allows bare terms only in the explicitly chosen supplement operation',async()=>{
  await db.material.deleteMany();await material('m',['名词解释','1. 汇率']);
  const annotation=await saveMaterialAnnotation('m',{anchor:anchor('1. 汇率'),instruction:'补充解释',confirmedText:true});
  await expect(organizeMaterial({courseId:'c',mode:'annotations',annotationIds:[annotation.id],confirmed:true})).rejects.toThrow(/可靠讲解/);
  await expect(organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],preset:'concepts',confirmed:true})).rejects.toThrow(/所选批注/);
  vi.mocked(generateWithDeepSeek).mockResolvedValue({model:'test',output:{sections:[{title:'汇率解释',body:'AI 补充解释。',annotationIds:[annotation.id]}],warnings:[]}});
  const task=await finished(await organizeMaterial({courseId:'c',mode:'annotations',annotationIds:[annotation.id],preset:'concepts',confirmed:true}));
  expect(task.sections).toHaveLength(1);expect(generateWithDeepSeek).toHaveBeenCalledOnce();
});

it('resumes a failed supplement with its original preset and retains the public default for legacy tasks',async()=>{
  const annotation=await saveMaterialAnnotation('m',{anchor:anchor(),instruction:'补充解释',confirmedText:true});
  vi.mocked(generateWithDeepSeek).mockRejectedValueOnce(new Error('生成暂时失败')).mockResolvedValue({model:'test',output:{sections:[{title:'解释',body:'AI 补充内容。',annotationIds:[annotation.id]}],warnings:[]}});
  const failed=await finished(await organizeMaterial({courseId:'c',mode:'annotations',annotationIds:[annotation.id],preset:'concepts',confirmed:true}));
  expect(failed).toMatchObject({state:'failed',preset:'concepts',done:0});
  const recovered=await finished(await organizeMaterial({courseId:'c',mode:'annotations',taskId:failed.id,preset:'notes',confirmed:true}));
  expect(recovered.preset).toBe('concepts');expect(recovered.sections[0].generation?.contentOrigin).toBe('ai-supplement');
  expect(vi.mocked(generateWithDeepSeek).mock.calls.map(call=>call[2])).toEqual(['concepts','concepts']);
  const row=await db.materialStudyTask.findUniqueOrThrow({where:{id:recovered.id}}),content=JSON.parse(row.content);delete content.preset;
  await db.materialStudyTask.update({where:{id:row.id},data:{content:JSON.stringify(content)}});
  expect((await getMaterialStudyTask('c',row.id)).preset).toBe('notes');
});

async function beginExam(){return db.originalPracticeSession.create({data:{id:'exam',courseId:'c',context:'paper',content:JSON.stringify({questions:[{materialId:'m'}],session:{mode:'exam',submitted:false,finished:false}})}});}
it('hides a protected draft and blocks generation, approval and adoption until submission',async()=>{
  const task=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true}));
  await beginExam();
  const hidden=await getMaterialStudyTask('c',task.id);expect(hidden).toMatchObject({withheld:true,sections:[],error:''});
  expect((await listMaterialStudyTasks('c'))[0].sections).toEqual([]);
  await expect(organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true})).rejects.toThrow(/未交卷/);
  await expect(organizeMaterial({courseId:'c',mode:'material',taskId:task.id,confirmed:true})).rejects.toThrow(/未交卷/);
  await expect(reviseMaterialStudy({courseId:'c',taskId:task.id,revision:task.revision,approveIds:[task.sections[0].id]})).rejects.toThrow(/未交卷/);
  await expect(adoptMaterialStudy({courseId:'c',taskId:task.id,revision:task.revision,chosenIds:[task.sections[0].id],notebookRevision:1,targets:[]})).rejects.toThrow(/未交卷/);
  expect(generateWithDeepSeek).toHaveBeenCalledOnce();
  await db.originalPracticeSession.update({where:{id:'exam'},data:{content:JSON.stringify({questions:[{materialId:'m'}],session:{mode:'exam',submitted:true,finished:true}})}});
  const restored=await getMaterialStudyTask('c',task.id);expect(restored.withheld).toBeUndefined();expect(restored.sections).toEqual(task.sections);
});

it('checks exams again after the model responds and saves no protected result',async()=>{
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  vi.mocked(generateWithDeepSeek).mockImplementation(async pages=>{await pending;return {model:'test',output:{sections:[{title:'未交卷答案',body:'应隐藏的解释',refs:[{materialId:'m',page:1,snippet:pages[0].text}]}],warnings:[]}};});
  const task=await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true});
  await vi.waitFor(()=>expect(generateWithDeepSeek).toHaveBeenCalledOnce());
  await beginExam();release();
  await vi.waitFor(async()=>expect(JSON.parse((await db.materialStudyTask.findUniqueOrThrow({where:{id:task.id}})).content).state).toBe('failed'));
  const row=await db.materialStudyTask.findUniqueOrThrow({where:{id:task.id}});expect(JSON.parse(row.content).sections).toEqual([]);
  expect((await getMaterialStudyTask('c',task.id)).withheld).toBe(true);
});

it('does not save generated content when the source changes during generation',async()=>{
  vi.mocked(generateWithDeepSeek).mockImplementation(async pages=>{await db.material.update({where:{id:'m'},data:{hash:'updated'}});return {model:'test',output:{sections:[{title:'旧版解释',body:'旧版内容',refs:[{materialId:'m',page:1,snippet:pages[0].text}]}],warnings:[]}};});
  const task=await finished(await organizeMaterial({courseId:'c',mode:'material',materialIds:['m'],confirmed:true}));
  expect(task).toMatchObject({state:'failed',stale:true,sections:[]});expect(task.error).toContain('来源变化');
});

it('maps generated exam versions to their materials and ignores submitted or finished sessions',()=>{
  const original=(session:object)=>({content:JSON.stringify({questions:[{materialId:'original'}],session})});
  const generated=(session:object)=>({versionId:'version',content:JSON.stringify(session)}),versions=[{id:'version',sourceIds:'["lecture","answer"]'}];
  expect(examProtection([original({mode:'exam'})],[generated({mode:'exam'})],versions)).toEqual({withheldMaterials:['original','lecture','answer'],withheldVersions:['version']});
  expect(examProtection([original({mode:'exam',submitted:true}),original({mode:'practice'})],[generated({mode:'exam',finished:true})],versions).withheldMaterials).toEqual([]);
});
