import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
vi.mock('./db', async () => {
  const { PrismaClient } = await import('@prisma/client'), fs = await import('node:fs/promises'), path = await import('node:path');
  await fs.mkdir(path.resolve('tmp'), { recursive: true });
  const dataDir = await fs.mkdtemp(path.resolve('tmp/original-practice-'));
  return { dataDir, db: new PrismaClient({ datasources: { db: { url: `file:${path.join(dataDir, 'test.db').replaceAll('\\', '/')}` } } }) };
});
vi.mock('./deepseek', async original => ({ ...await original<typeof import('./deepseek')>(), deepSeekConfig: () => ({ configured: true, model: 'test' }), requestStructuredOutput: vi.fn() }));
import { db, dataDir } from './db';
import { requestStructuredOutput } from './deepseek';
import { analyzeQuestionBanks, ensureOriginalAnswer, generateOriginalVariants, listQuestionBanks, prepareQuestionBanks, reviseBankQuestion, startBankAnalysis } from './question-bank-store';
import { appendOriginalQuestions, loadOriginalSession, refreshOriginalSessionAnswers, restartOriginalSession, resumeOriginalSession, saveOriginalSession, switchOriginalMode, originalPracticeHistory } from './original-practice-store';
import { originalPracticeAction } from './original-practice-api';
beforeAll(async () => {
  await db.$executeRawUnsafe('CREATE TABLE Course (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await db.$executeRawUnsafe('CREATE TABLE Material (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, folderId TEXT, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL, filePath TEXT NOT NULL, fixture TEXT, chapter TEXT NOT NULL DEFAULT "未分类", status TEXT NOT NULL DEFAULT "stored", excluded BOOLEAN NOT NULL DEFAULT 0, conflictResolution TEXT, conflictFeedbackReason TEXT, conflictFeedbackNote TEXT, conflictResolvedAt DATETIME, origin TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await db.$executeRawUnsafe('CREATE TABLE OriginalQuestionBank (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, materialId TEXT NOT NULL, sourceHash TEXT NOT NULL, content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updatedAt DATETIME NOT NULL, UNIQUE(materialId, sourceHash))');
  await db.$executeRawUnsafe('CREATE TABLE OriginalPracticeSession (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, context TEXT NOT NULL, content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updatedAt DATETIME NOT NULL)');
  await db.$executeRawUnsafe('CREATE TABLE OriginalPracticeRound (id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, courseId TEXT NOT NULL, content TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await db.$executeRawUnsafe('CREATE TABLE PracticeSession (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, versionId TEXT NOT NULL, content TEXT NOT NULL)');
  await db.$executeRawUnsafe('CREATE TABLE Version (id TEXT PRIMARY KEY, courseId TEXT NOT NULL, sourceIds TEXT NOT NULL)');
  await db.course.create({ data: { id: 'c', name: '原题测试' } });
  await db.material.create({ data: { id: 'm', courseId: 'c', name: '原题.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', hash: 'm', size: 1, filePath: 'unused', origin: 'test', status: 'extracted' } });
  await mkdir(path.join(dataDir, 'extractions'), { recursive: true });
  await writeFile(path.join(dataDir, 'extractions/m.json'), JSON.stringify({ state: 'complete', pageCount: 4, sourceCount: 4, continuation: {startSource:1,hasMore:false}, durationMs: 1, updatedAt: '2026-09-30', pages: ['单选题', '1.下列信用工具属于长期工具的是？', 'A.普通股 B.支票', '2.请选择正确选项。\nA.甲 B.乙'].map((text, index) => ({ page: index + 1, text, method: 'docx-text', state: 'extracted', warnings: [] })) }));
});
afterAll(async () => db.$disconnect());
async function bankWithVariants(count=6) {
  const bank=(await listQuestionBanks('c'))[0],base=bank.questions[0];
  const variants=Array.from({length:count},(_,i)=>({...base,id:`${base.id}:variant:test-${i}`,origin:'variant' as const,answer:'A',answerSource:'ai' as const,explanation:'AI解析'}));
  await db.originalQuestionBank.update({where:{id:bank.id},data:{content:JSON.stringify({...bank,questions:[...bank.questions,...variants]})}});
  return {bank,variants};
}
beforeEach(async () => { await db.originalPracticeRound.deleteMany(); await db.originalPracticeSession.deleteMany(); await db.originalQuestionBank.deleteMany(); vi.clearAllMocks(); await prepareQuestionBanks('c', ['m']); });
it('rechecks unsubmitted exams inside a new practice transaction without requiring an explanation', async () => {
  const question = (await listQuestionBanks('c'))[0].questions[0];
  const exam = await loadOriginalSession('c', 'paper', [question.id], 'exam', true);
  await expect(loadOriginalSession('c', 'knowledge', [question.id], 'practice', true)).rejects.toThrow('未交卷');
  expect(await db.originalPracticeSession.count()).toBe(1);
  await db.originalPracticeSession.update({ where: { id: exam.scope }, data: { content: JSON.stringify({ questions: exam.questions, session: { ...exam.session, submitted: true, finished: true } }) } });
  expect((await loadOriginalSession('c', 'knowledge', [question.id], 'practice', true)).session.ids).toEqual([question.id]);
});
it('rechecks exams when a cached homepage resumes a previous practice while retaining saved answers', async () => {
  const question = (await listQuestionBanks('c'))[0].questions[0];
  const practice = await loadOriginalSession('c', 'knowledge', [question.id], 'practice', true);
  const saved = await saveOriginalSession('c', practice.scope, practice.revision, { ...practice.session, answers: { [question.id]: 'B' } });
  const exam = await loadOriginalSession('c', 'paper', [question.id], 'exam', true);
  await expect(resumeOriginalSession('c', saved.scope)).rejects.toThrow('未交卷');
  expect((await resumeOriginalSession('c', exam.scope)).session.mode).toBe('exam');
  await db.originalPracticeSession.update({ where: { id: exam.scope }, data: { content: JSON.stringify({ questions: exam.questions, session: { ...exam.session, submitted: true, finished: true } }) } });
  expect((await resumeOriginalSession('c', saved.scope)).session.answers).toEqual(saved.session.answers);
});
it('shrinks answer batches to 40000 characters without truncating any complete shared context',async()=>{
  const bank=(await listQuestionBanks('c'))[0],questions=Array.from({length:5},(_,index)=>({...bank.questions[0],id:`long-${index}`,context:`第${index}段完整共用材料：${'完整证据'.repeat(2300)}`}));
  await db.originalQuestionBank.update({where:{id:bank.id},data:{content:JSON.stringify({...bank,questions})}});
  const seen:string[]=[];
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>{
    expect(task.input.length).toBeLessThanOrEqual(40000);const input=JSON.parse(task.input);
    for(const question of input.questions){seen.push(question.questionId);expect(input.contexts[question.contextId]).toBe(questions.find(q=>q.id===question.questionId)!.context);}
    return {model:'test',output:{answers:input.questions.map((q:{questionId:string})=>({questionId:q.questionId,answer:'A',explanation:'完整解析',topics:['完整材料知识点'],criteria:[],warnings:[]}))}};
  });
  await analyzeQuestionBanks('c',['m']);expect(new Set(seen)).toEqual(new Set(questions.map(q=>q.id)));expect(vi.mocked(requestStructuredOutput).mock.calls.length).toBeGreaterThan(1);expect((await listQuestionBanks('c'))[0].questions.every(q=>q.answer==='A'&&q.explanation==='完整解析')).toBe(true);
});
it('generates only the remaining variant count and rejects excess model output',async()=>{
  let bank=(await listQuestionBanks('c'))[0];bank=await reviseBankQuestion('c',bank.id,bank.revision,bank.questions[0].id,{answer:'A',explanation:'已核对解析'});
  const variant={kind:'single',prompt:'新的完整题干',options:[{label:'A',text:'甲'},{label:'B',text:'乙'}],answer:'A',explanation:'变式解析',criteria:[]};
  vi.mocked(requestStructuredOutput).mockResolvedValue({model:'test',output:{questions:[variant,variant,variant]}});
  await expect(generateOriginalVariants('c',bank.id,bank.questions[0].id,2)).rejects.toThrow();
  expect((await listQuestionBanks('c'))[0].questions).toHaveLength(2);
  vi.mocked(requestStructuredOutput).mockResolvedValue({model:'test',output:{questions:[variant,variant]}});
  const generated=await generateOriginalVariants('c',bank.id,bank.questions[0].id,2);expect(generated.questions.filter(q=>q.origin==='variant')).toHaveLength(2);
});
it('matches supplement answers to numbered section headings when question numbers repeat',async()=>{
  const {supplementQuestionAnswers}=await import('./question-bank-store'),bank=(await listQuestionBanks('c'))[0];
  const questions=[bank.questions[0],{...bank.questions[1],number:'1',section:'二、判断题',kind:'judge' as const,options:[]}];
  await db.originalQuestionBank.update({where:{id:bank.id},data:{content:JSON.stringify({...bank,questions})}});
  await db.material.create({data:{id:'section-answers',courseId:'c',name:'补充答案.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',hash:'answers',size:1,filePath:'unused',origin:'test',status:'extracted'}});
  try{
    const lines=['一、单选题','1. B','二、判断题','1. 错误'];
    await writeFile(path.join(dataDir,'extractions/section-answers.json'),JSON.stringify({state:'complete',pageCount:4,sourceCount:4,continuation:{startSource:1,hasMore:false},durationMs:1,updatedAt:'2026-10-01',pages:lines.map((text,index)=>({page:index+1,text,method:'docx-text',state:'extracted',warnings:[]}))}));
    const result=await supplementQuestionAnswers('c',bank.id,'section-answers');
    expect(result.questions.map(q=>({number:q.number,kind:q.kind,answer:q.answer,source:q.answerSource}))).toEqual([{number:'1',kind:'single',answer:'B',source:'supplement'},{number:'1',kind:'judge',answer:'错误',source:'supplement'}]);
  }finally{await db.material.delete({where:{id:'section-answers'}});}
});
it('honors a newly selected mode and archives the old answers in the same scope',async()=>{
  const ids=(await listQuestionBanks('c'))[0].questions.map(q=>q.id),loaded=await loadOriginalSession('c','knowledge',ids,'practice');
  const saved=await saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,answers:{[ids[0]]:'B'}});
  const resumed=await loadOriginalSession('c','knowledge',ids,'exam');expect(resumed.session).toEqual(saved.session);
  const next=await loadOriginalSession('c','knowledge',ids,'exam',true);
  expect(next.scope).toBe(saved.scope);expect(next.session.mode).toBe('exam');expect(next.session.answers).toEqual({});expect(next.rounds[0].session).toEqual(saved.session);
  await expect(saveOriginalSession('c',saved.scope,saved.revision,saved.session)).rejects.toThrow();
});
it('distinguishes refresh resume from explicit new rounds and retains appended historical snapshots',async()=>{
  const {bank,variants}=await bankWithVariants(),ids=bank.questions.map(q=>q.id),loaded=await loadOriginalSession('c','knowledge',ids,'practice');
  const appended=await appendOriginalQuestions('c',loaded.scope,loaded.revision,[variants[0].id]);
  const progress=await saveOriginalSession('c',appended.scope,appended.revision,{...appended.session,answers:{[ids[0]]:'B'},index:1});
  const targeted=await loadOriginalSession('c','knowledge',ids,'exam');expect(targeted.session).toEqual(progress.session);expect(targeted.questions).toEqual(appended.questions);
  await reviseBankQuestion('c',bank.id,bank.revision,variants[0].id,{answer:'B'});
  expect((await loadOriginalSession('c','knowledge',[],'practice')).questions).toEqual(appended.questions);
  const next=await loadOriginalSession('c','knowledge',ids,'practice',true);
  expect(next.questions.map(q=>q.id)).toEqual(ids);expect(next.rounds.some(r=>r.questions.length===3&&r.questions[2].answer==='A')).toBe(true);
  const saved=await saveOriginalSession('c',next.scope,next.revision,{...next.session,answers:{[ids[0]]:'B'}});
  expect((await loadOriginalSession('c','knowledge',ids,'practice')).session).toEqual(saved.session);
  const fresh=await loadOriginalSession('c','knowledge',ids,'practice',true);
  expect(fresh.session.roundId).not.toBe(saved.session.roundId);expect(fresh.session.answers).toEqual({});expect(fresh.rounds[0].session.answers[ids[0]]).toBe('B');
});
it.each(['knowledge','paper'] as const)('switches unfinished %s mode without losing drafts and archives previous judgments',async(context)=>{
  const ids=(await listQuestionBanks('c'))[0].questions.map(q=>q.id),loaded=await loadOriginalSession('c',context,ids,'practice');
  const saved=await saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,index:1,answers:{[ids[0]]:'B'},results:{[ids[0]]:{answer:'B',correct:false,source:'self'}}});
  const exam=await switchOriginalMode('c',saved.scope,saved.revision,'exam');
  expect(exam.session.answers).toEqual(saved.session.answers);expect(exam.session.index).toBe(1);expect(exam.session.mode).toBe('exam');expect(exam.session.results).toEqual({});expect(exam.rounds[0].session).toEqual(saved.session);
  await expect(switchOriginalMode('c',saved.scope,saved.revision,'practice')).rejects.toThrow();
  const practice=await switchOriginalMode('c',exam.scope,exam.revision,'practice');expect(practice.session.answers).toEqual(saved.session.answers);expect(practice.session.results).toEqual({});
});
it('accepts memorize via the API, archives answers, and returns to a blank practice round',async()=>{
  const ids=(await listQuestionBanks('c'))[0].questions.map(q=>q.id),loaded=await loadOriginalSession('c','knowledge',ids,'practice');
  const saved=await saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,index:1,answers:{[ids[0]]:'B'},results:{[ids[0]]:{answer:'B',correct:false,source:'self'}}});
  const response=await originalPracticeAction({action:'original-mode',courseId:'c',scope:saved.scope,revision:saved.revision,mode:'memorize'});
  const memorize=await response.json();expect(memorize.session.mode).toBe('memorize');expect(memorize.session.index).toBe(1);expect(memorize.session.answers).toEqual({});expect(memorize.session.results).toEqual({});expect(memorize.rounds[0].session).toEqual(saved.session);
  const browsed=await saveOriginalSession('c',memorize.scope,memorize.revision,{...memorize.session,index:0});
  const practice=await switchOriginalMode('c',browsed.scope,browsed.revision,'practice');expect(practice.session.answers).toEqual({});expect(practice.session.roundId).not.toBe(saved.session.roundId);
  expect((await originalPracticeHistory('c')).mistakes).toHaveLength(1);
});
it('rejects answers, judgments and submission in a memorize round',async()=>{
  const ids=(await listQuestionBanks('c'))[0].questions.map(q=>q.id);
  const response=await originalPracticeAction({action:'original-load',courseId:'c',context:'knowledge',questionIds:ids,mode:'memorize',newRound:true});const loaded=await response.json();
  await expect(saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,answers:{[ids[0]]:'A'}})).rejects.toThrow(/背题/);
  await expect(saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,results:{[ids[0]]:{answer:'',correct:true,source:'self'}}})).rejects.toThrow(/背题/);
  await expect(saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,submitted:true,finished:true})).rejects.toThrow(/背题/);
});
it.each(['append','start','mode'] as const)('preserves legacy judgment chronology when %s archives a timestamp-free snapshot',async(operation)=>{
  const {bank,variants}=await bankWithVariants(1),ids=bank.questions.map(q=>q.id),loaded=await loadOriginalSession('c','knowledge',ids,'practice');
  const wrong=await saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,answers:{[ids[0]]:'B'},results:{[ids[0]]:{answer:'B',correct:false,source:'self'}}});
  const legacy=JSON.parse(JSON.stringify({questions:wrong.questions,session:wrong.session}));delete legacy.session.results[ids[0]].judgedAt;
  await db.originalPracticeSession.update({where:{id:wrong.scope},data:{content:JSON.stringify(legacy),updatedAt:new Date('2000-01-01T00:00:00.000Z')}});
  const paper=await loadOriginalSession('c','paper',ids,'practice');
  await saveOriginalSession('c',paper.scope,paper.revision,{...paper.session,answers:{[ids[0]]:'A'},results:{[ids[0]]:{answer:'A',correct:true,source:'self'}}});
  const archived=operation==='append'?await appendOriginalQuestions('c',wrong.scope,wrong.revision,[variants[0].id]):operation==='start'?await loadOriginalSession('c','knowledge',ids,'practice',true):await switchOriginalMode('c',wrong.scope,wrong.revision,'exam');
  expect(archived.rounds[0].session.results[ids[0]].judgedAt).toBe('2000-01-01T00:00:00.000Z');
  expect((await originalPracticeHistory('c')).mistakes).toEqual([]);
});
it('appends owned variants to the same knowledge round and archives the old snapshot without resetting progress',async()=>{
  const {bank,variants}=await bankWithVariants(),loaded=await loadOriginalSession('c','knowledge',bank.questions.map(q=>q.id),'practice');
  const q=loaded.questions[0],saved=await saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,index:1,answers:{[q.id]:'B'},results:{[q.id]:{answer:'B',correct:false,source:'self'}}});
  const other=await loadOriginalSession('c','knowledge',[bank.questions[1].id],'exam');
  const appended=await appendOriginalQuestions('c',saved.scope,saved.revision,variants.slice(0,5).map(q=>q.id));
  expect(appended.scope).toBe(saved.scope);expect(appended.revision).toBe(saved.revision+1);expect(appended.session).toEqual({...saved.session,ids:[...saved.session.ids,...variants.slice(0,5).map(q=>q.id)]});
  expect(appended.rounds[0].questions).toEqual(saved.questions);expect(appended.rounds[0].session).toEqual(saved.session);expect(appended.questions).toHaveLength(7);
  expect(await loadOriginalSession('c','knowledge',[bank.questions[1].id],'exam')).toEqual(other);
  await expect(appendOriginalQuestions('c',saved.scope,saved.revision,[variants[5].id])).rejects.toThrow();
  await expect(appendOriginalQuestions('c',appended.scope,appended.revision,[variants[5].id])).rejects.toThrow(/5/);
  expect((await loadOriginalSession('c','knowledge',[], 'practice')).scope).toBe(saved.scope);
});
it('rejects paper, foreign, duplicate, original and unrelated-parent variants without changing the round',async()=>{
  const {bank,variants}=await bankWithVariants();const knowledge=await loadOriginalSession('c','knowledge',[bank.questions[1].id],'practice'),paper=await loadOriginalSession('c','paper',bank.questions.map(q=>q.id),'exam');
  await expect(appendOriginalQuestions('c',paper.scope,paper.revision,[variants[0].id])).rejects.toThrow();
  await expect(appendOriginalQuestions('foreign',knowledge.scope,knowledge.revision,[variants[0].id])).rejects.toThrow();
  for(const ids of [['foreign'],[variants[0].id],[bank.questions[1].id],[variants[0].id,variants[0].id],variants.map(q=>q.id)])await expect(appendOriginalQuestions('c',knowledge.scope,knowledge.revision,ids)).rejects.toThrow();
  expect((await loadOriginalSession('c','knowledge',[bank.questions[1].id],'practice')).revision).toBe(knowledge.revision);
  expect(await db.originalPracticeRound.count()).toBe(0);
});
it('rejects completed or submitted rounds and stale original snapshots before appending',async()=>{
  const {bank,variants}=await bankWithVariants(),ids=bank.questions.map(q=>q.id),exam=await loadOriginalSession('c','knowledge',ids,'exam');
  const answers=Object.fromEntries(ids.map(id=>[id,'A'])),results=Object.fromEntries(ids.map(id=>[id,{answer:'A',correct:null,source:'none' as const}]));
  const submitted=await saveOriginalSession('c',exam.scope,exam.revision,{...exam.session,answers,results,submitted:true,finished:true});
  await expect(appendOriginalQuestions('c',submitted.scope,submitted.revision,[variants[0].id])).rejects.toThrow();
  const ongoing=await loadOriginalSession('c','knowledge',[ids[0]],'practice');await reviseBankQuestion('c',bank.id,bank.revision,ids[0],{prompt:'题干经过实际修订',answer:'B'});
  await expect(appendOriginalQuestions('c',ongoing.scope,ongoing.revision,[variants[0].id])).rejects.toThrow(/更新/);
  expect(await db.originalPracticeRound.count()).toBe(0);
});
it('permits appending before knowledge exam submission while retaining concealment and the variant cap on load',async()=>{
  const {bank,variants}=await bankWithVariants(),loaded=await loadOriginalSession('c','knowledge',bank.questions.map(q=>q.id),'exam');
  const appended=await appendOriginalQuestions('c',loaded.scope,loaded.revision,[variants[0].id]);expect(appended.session.mode).toBe('exam');expect(appended.session.submitted).toBe(false);expect(appended.session.results).toEqual({});
  await expect(loadOriginalSession('c','knowledge',variants.map(q=>q.id),'practice')).rejects.toThrow(/5/);
});
it('imports original questions without a review version and rejects foreign material selection', async () => {
  const banks = await prepareQuestionBanks('c', ['m']);
  expect(banks[0].questions).toHaveLength(2);
  expect(banks[0].questions[0].prompt).toContain('长期工具');
  await expect(prepareQuestionBanks('foreign', ['m'])).rejects.toThrow();
  expect((await listQuestionBanks('c'))[0].id).toBe(banks[0].id);
});
it('persists model answers, preserves manual corrections and rejects stale revisions', async () => {
  const bank = (await prepareQuestionBanks('c', ['m']))[0];
  vi.mocked(requestStructuredOutput).mockResolvedValue({ model: 'test', output: { answers: bank.questions.map(question => ({ questionId: question.id, answer: 'A', explanation: '普通股是长期信用工具。', topics: ['信用工具'], criteria: [], warnings: [] })) } });
  await analyzeQuestionBanks('c', ['m']);
  const analyzed = (await listQuestionBanks('c'))[0];
  expect(analyzed.questions[0].answerSource).toBe('ai');
  const revised = await reviseBankQuestion('c', analyzed.id, analyzed.revision, analyzed.questions[0].id, { answer: 'B' });
  expect(revised.questions[0].answerSource).toBe('manual');
  await expect(reviseBankQuestion('c', analyzed.id, analyzed.revision, analyzed.questions[0].id, { answer: 'A' })).rejects.toThrow();
  await analyzeQuestionBanks('c', ['m']);
  expect((await listQuestionBanks('c'))[0].questions[0].answer).toBe('B');
});
it('keeps paper and knowledge sessions separate, detects concurrent writes and snapshots prior rounds', async () => {
  const bank = (await listQuestionBanks('c'))[0], ids = bank.questions.map(question => question.id);
  const paper = await loadOriginalSession('c', 'paper', ids, 'exam');
  const knowledge = await loadOriginalSession('c', 'knowledge', ids, 'practice');
  expect(paper.scope).not.toBe(knowledge.scope);
  expect(paper.session.mode).toBe('exam');
  const changed = { ...knowledge.session, answers: { [ids[0]]: 'B' } };
  const saved = await saveOriginalSession('c', knowledge.scope, knowledge.revision, changed);
  await expect(saveOriginalSession('c', knowledge.scope, knowledge.revision, changed)).rejects.toThrow();
  expect((await loadOriginalSession('c', 'knowledge', ids, 'practice')).session.answers[ids[0]]).toBe('B');
  const restarted = await restartOriginalSession('c', saved.scope, saved.revision, 'practice');
  expect(restarted.rounds[0].session.answers[ids[0]]).toBe('B');
  expect(restarted.session.answers).toEqual({});
  await expect(saveOriginalSession('c', restarted.scope, restarted.revision, { ...restarted.session, answers: { foreign: 'A' } })).rejects.toThrow();
});

it('preserves a live round snapshot after an answer correction and starts new groups with the correction', async () => {
  const bank=(await listQuestionBanks('c'))[0],ids=bank.questions.map(q=>q.id);
  const first=await loadOriginalSession('c','knowledge',ids,'practice');
  await reviseBankQuestion('c',bank.id,bank.revision,ids[0],{prompt:'题干经过实际修订',answer:'B'});
  const continued=await saveOriginalSession('c',first.scope,first.revision,{...first.session,answers:{[ids[0]]:'A'}});
  expect(continued.questions[0].answer).toBe('');
  expect(continued.session.answers[ids[0]]).toBe('A');
  const next=await loadOriginalSession('c','knowledge',ids,'practice');
  expect(next.scope).not.toBe(first.scope);expect(next.questions[0].answer).toBe('B');
  expect((await loadOriginalSession('c','knowledge',[], 'practice')).session.ids).toEqual(ids);
});

it('keeps completed reference answers when a source batch grows around unchanged questions',async()=>{
  const bank=(await listQuestionBanks('c'))[0];
  vi.mocked(requestStructuredOutput).mockResolvedValue({model:'test',output:{answers:bank.questions.map(question=>({questionId:question.id,answer:'A',explanation:'已保存解析',topics:['信用工具'],criteria:[],warnings:[]}))}});
  await analyzeQuestionBanks('c',['m']);
  const filename=path.join(dataDir,'extractions/m.json'),stored=JSON.parse(await (await import('node:fs/promises')).readFile(filename,'utf8'));
  stored.pages.push({page:5,text:'',method:'docx-text',state:'empty',warnings:[]});stored.pageCount=5;stored.sourceCount=5;
  await writeFile(filename,JSON.stringify(stored));
  const next=(await prepareQuestionBanks('c',['m']))[0];
  expect(next.questions[0].answerSource).toBe('ai');expect(next.questions[0].explanation).toBe('已保存解析');
});

it('review: model completion preserves criteria and topics revised while its request is running',async()=>{
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>{
    const latest=(await listQuestionBanks('c'))[0];
    await reviseBankQuestion('c',latest.id,latest.revision,latest.questions[0].id,{answer:'B',topics:['我的标签'],criteria:['我的要点']});
    const input=JSON.parse(task.input);
    return {model:'test',output:{answers:input.questions.map((q:{questionId:string})=>({questionId:q.questionId,answer:'A',explanation:'AI解析',topics:['AI标签'],criteria:['AI要点'],warnings:[]}))}};
  });
  await analyzeQuestionBanks('c',['m']);
  const question=(await listQuestionBanks('c'))[0].questions[0];
  expect(question.answer).toBe('B');expect(question.criteria).toEqual(['我的要点']);expect(question.topics).toEqual(['我的标签']);
});
it('review: answered and tagged questions still receive missing explanations',async()=>{
  let bank=(await listQuestionBanks('c'))[0];
  for(const question of bank.questions)bank=await reviseBankQuestion('c',bank.id,bank.revision,question.id,{answer:'A',topics:['已分类']});
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>({model:'test',output:{answers:JSON.parse(task.input).questions.map((q:{questionId:string})=>({questionId:q.questionId,answer:'A',explanation:'补充解析',topics:['已分类'],criteria:[],warnings:[]}))}}));
  await analyzeQuestionBanks('c',['m']);
  expect((await listQuestionBanks('c'))[0].questions[0].explanation).toBe('补充解析');
});
it('review: navigation cannot turn an older wrong result into the latest judgement',async()=>{
  const bank=(await listQuestionBanks('c'))[0],ids=bank.questions.map(q=>q.id);
  const older=await loadOriginalSession('c','knowledge',ids,'practice');
  const wrong=await saveOriginalSession('c',older.scope,older.revision,{...older.session,answers:{[ids[0]]:'B'},results:{[ids[0]]:{answer:'B',correct:false,source:'self'}}});
  await new Promise(resolve=>setTimeout(resolve,20));
  const newer=await loadOriginalSession('c','paper',ids,'practice');
  await saveOriginalSession('c',newer.scope,newer.revision,{...newer.session,answers:{[ids[0]]:'A'},results:{[ids[0]]:{answer:'A',correct:true,source:'self'}}});
  expect((await originalPracticeHistory('c')).mistakes).toEqual([]);
  await new Promise(resolve=>setTimeout(resolve,20));
  await saveOriginalSession('c',wrong.scope,wrong.revision,{...wrong.session,index:1});
  expect((await originalPracticeHistory('c')).mistakes).toEqual([]);
});
it('review: stale model results are not attached to a newly repaired shared context',async()=>{
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>{
    const latest=(await listQuestionBanks('c'))[0];
    await reviseBankQuestion('c',latest.id,latest.revision,latest.questions[0].id,{context:'本题共同材料已人工改正，正确选项改为B。'});
    return {model:'test',output:{answers:JSON.parse(task.input).questions.map((q:{questionId:string})=>({questionId:q.questionId,answer:'A',explanation:'旧材料下的解析',topics:['旧材料标签'],criteria:[],warnings:[]}))}};
  });
  await analyzeQuestionBanks('c',['m']);
  const question=(await listQuestionBanks('c'))[0].questions[0];expect(question.answerSource).toBe('none');
});
it('review: persisted processing state without a live model job is retryable after restart',async()=>{
  const bank=(await listQuestionBanks('c'))[0];
  await db.originalQuestionBank.update({where:{id:bank.id},data:{content:JSON.stringify({...bank,state:'processing'})}});
  expect((await listQuestionBanks('c'))[0].state).not.toBe('processing');
});


vi.mock('./private-access',()=>({requirePrivateAccess:vi.fn(async()=>null)}));
import { GET as getOriginalAsset } from '../app/api/materials/[id]/assets/route';
import { officeFixture, zipEntryHeaders } from '../../scripts/document-fixtures.mjs';
import { officeArchive } from '../../scripts/document-formats.mjs';
import { zipSync, unzipSync } from 'fflate';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYwAAAABJRU5ErkJggg==','base64');
function imageDocument(media:Uint8Array=png){return zipSync({...unzipSync(officeFixture('docx','<w:document xmlns:w="w"><w:body/></w:document>')),'word/media/image1.png':media});}
async function requestImage(path='word/media/image1.png'){return getOriginalAsset(new Request(`http://localhost/api/materials/m/assets?path=${encodeURIComponent(path)}`),{params:Promise.resolve({id:'m'})});}
it('serves exact embedded PNG bytes while retaining the default XML-only archive budget',async()=>{
  const bytes=imageDocument(),filePath=path.join(dataDir,'media.docx');await writeFile(filePath,bytes);await db.material.update({where:{id:'m'},data:{filePath}});
  expect(officeArchive(bytes).files['word/media/image1.png']).toBeUndefined();const response=await requestImage();expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toBe('image/png');expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
});
it('rejects traversal and an explicitly requested media decompression bomb',async()=>{
  const bytes=imageDocument(new Uint8Array(8*1024*1024+1)),filePath=path.join(dataDir,'huge-media.docx');await writeFile(filePath,bytes);await db.material.update({where:{id:'m'},data:{filePath}});
  expect(officeArchive(bytes).files['word/document.xml']).toBeDefined();expect((await requestImage('../word/media/image1.png')).status).toBe(400);expect((await requestImage('https://example.com/image.png')).status).toBe(400);const response=await requestImage();expect(response.status).toBe(400);expect((await response.json()).error).toContain('大小');
});
it('rejects media whose original ZIP CRC does not match its bytes',async()=>{
  const {bytes,headers}=zipEntryHeaders(imageDocument());const header=headers.find(h=>h.name==='word/media/image1.png')!;bytes.writeUInt32LE(123,header.central+16);bytes.writeUInt32LE(123,header.local+14);
  const filePath=path.join(dataDir,'bad-crc.docx');await writeFile(filePath,bytes);await db.material.update({where:{id:'m'},data:{filePath}});const response=await requestImage();expect(response.status).toBe(400);expect((await response.json()).error).toContain('校验');
});
it('rejects stale model results when the revised kind differs from the request snapshot',async()=>{
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>{const bank=(await listQuestionBanks('c'))[0];await reviseBankQuestion('c',bank.id,bank.revision,bank.questions[0].id,{kind:'short'});return {model:'test',output:{answers:JSON.parse(task.input).questions.map((q:{questionId:string})=>({questionId:q.questionId,answer:'A',explanation:'旧题型解析',topics:['旧标签'],criteria:[],warnings:[]}))}};});
  await analyzeQuestionBanks('c',['m']);expect((await listQuestionBanks('c'))[0].questions[0].answerSource).toBe('none');
});
it('does not reconcile live processing as interrupted and rejects overlapping material selections',async()=>{
  let finish!:(value:Awaited<ReturnType<typeof requestStructuredOutput>>)=>void,input:{questions:{questionId:string}[]}|null=null;
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>{input=JSON.parse(task.input);return new Promise(resolve=>{finish=resolve;});});
  const first=analyzeQuestionBanks('c',['m']);await vi.waitFor(()=>expect(input).not.toBeNull());expect((await listQuestionBanks('c'))[0].state).toBe('processing');
  let rejected=false;try{startBankAnalysis('c',['m','other']);}catch{rejected=true;}
  finish({model:'test',output:{answers:input!.questions.map(q=>({questionId:q.questionId,answer:'A',explanation:'解析',topics:['实际标签'],criteria:[],warnings:[]}))}});await first;expect(rejected).toBe(true);
});


it('keeps published questions partial while raw source continuation remains',async()=>{
  const file=path.join(dataDir,'extractions/m.json'),original=await (await import('node:fs/promises')).readFile(file,'utf8');
  try {
    const content=JSON.parse(original);content.continuation={startSource:1,hasMore:true,nextSource:5};content.sourceCount=8;await writeFile(file,JSON.stringify(content));
    const existing=(await listQuestionBanks('c'))[0];await db.originalQuestionBank.update({where:{id:existing.id},data:{sourceHash:'old',content:JSON.stringify({...existing,sourceProgress:{hasMore:true,nextSource:5,total:8}})}});
    // Simulate a bank already published from an incomplete extraction, without advancing it here.
    const prepared=await db.originalQuestionBank.findFirstOrThrow({where:{materialId:'m'}});
    const normalized=await (await import('./extraction')).readExtraction('m');const versioned={parserVersion:3,materialHash:'m',pages:content.pages.map((p:{page:number;text:string})=>[p.page,p.text,[],null,null]),sourceCount:8,continuation:normalized!.continuation};
    const {hashContent}=await import('./generation');await db.originalQuestionBank.update({where:{id:prepared.id},data:{sourceHash:hashContent(JSON.stringify(versioned))}});
    vi.mocked(requestStructuredOutput).mockImplementation(async task=>({model:'test',output:{answers:JSON.parse(task.input).questions.map((q:{questionId:string})=>({questionId:q.questionId,answer:'A',explanation:'完整解析',topics:['标签'],criteria:[],warnings:[]}))}}));
    await analyzeQuestionBanks('c',['m']);const bank=(await listQuestionBanks('c'))[0];expect(bank.state).toBe('partial');expect(bank.error).toContain('第 5 段');
  }finally{await writeFile(file,original);}
});

it('rejects all model results when the material hash changes during the request',async()=>{
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>{await db.material.update({where:{id:'m'},data:{hash:'changed-raw-file'}});return {model:'test',output:{answers:JSON.parse(task.input).questions.map((q:{questionId:string})=>({questionId:q.questionId,answer:'A',explanation:'旧文件解析',topics:['旧文件标签'],criteria:[],warnings:[]}))}};});
  try{await expect(analyzeQuestionBanks('c',['m'])).rejects.toThrow('来源已变化');expect((await listQuestionBanks('c'))[0].questions[0].answerSource).toBe('none');}finally{await db.material.update({where:{id:'m'},data:{hash:'m'}});}
});

it('does not allow client timestamp spoofing or navigation to change a saved judgement timestamp',async()=>{
  const bank=(await listQuestionBanks('c'))[0],ids=bank.questions.map(q=>q.id),initial=await loadOriginalSession('c','knowledge',ids,'practice');
  const saved=await saveOriginalSession('c',initial.scope,initial.revision,{...initial.session,answers:{[ids[0]]:'A'},results:{[ids[0]]:{answer:'A',correct:true,source:'self',judgedAt:'2099-01-01T00:00:00.000Z'}}});
  expect(saved.session.results[ids[0]].judgedAt).not.toBe('2099-01-01T00:00:00.000Z');const timestamp=saved.session.results[ids[0]].judgedAt;
  const navigated=await saveOriginalSession('c',saved.scope,saved.revision,{...saved.session,index:1,results:{[ids[0]]:{...saved.session.results[ids[0]],judgedAt:'2099-01-01T00:00:00.000Z'}}});expect(navigated.session.results[ids[0]].judgedAt).toBe(timestamp);
});


import { readFile } from 'node:fs/promises';
import { docxFixture } from '../../scripts/document-fixtures.mjs';
const paragraphs=(texts:string[])=>texts.map(text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
it('migrates an old partial Word extraction without a 50-source warning before preparing its bank',async()=>{
  const file=path.join(dataDir,'extractions/m.json'),original=await readFile(file,'utf8'),material=await db.material.findUniqueOrThrow({where:{id:'m'}}),filePath=path.join(dataDir,'legacy-word.docx');
  try {
    await writeFile(filePath,docxFixture(paragraphs(['单选题','1.第一道完整原题','A.甲 B.乙','2.第二道完整原题','A.丙 B.丁'])));await db.material.update({where:{id:'m'},data:{filePath}});
    const legacy=JSON.parse(original);delete legacy.sourceCount;delete legacy.continuation;legacy.state='partial';await writeFile(file,JSON.stringify(legacy));
    const banks=await prepareQuestionBanks('c',['m']);expect(banks[0].questions).toHaveLength(2);expect(banks[0].questions[1].options).toHaveLength(2);
    const upgraded=JSON.parse(await readFile(file,'utf8'));expect(upgraded.sourceCount).toBe(5);expect(upgraded.continuation.hasMore).toBe(false);
  }finally{await writeFile(file,original);await db.material.update({where:{id:'m'},data:{filePath:material.filePath}});}
});

it('continues raw Word ranges and withholds the trailing question until all sources have merged',async()=>{
  const file=path.join(dataDir,'extractions/m.json'),original=await readFile(file,'utf8'),material=await db.material.findUniqueOrThrow({where:{id:'m'}}),filePath=path.join(dataDir,'continued-word.docx');
  const texts=['单选题',...Array.from({length:180},(_,i)=>[`${i+1}.完整题干 ${'X'.repeat(8000)}`,'A.甲 B.乙']).flat()];
  try {
    await writeFile(filePath,docxFixture(paragraphs(texts)));await db.material.update({where:{id:'m'},data:{filePath}});
    const paused={state:'partial',pageCount:3,sourceCount:texts.length,continuation:{startSource:1,nextSource:4,hasMore:true},durationMs:1,updatedAt:'2026-09-30',pages:texts.slice(0,3).map((text,i)=>({page:i+1,text,method:'docx-text',state:'extracted',warnings:[]}))};await writeFile(file,JSON.stringify(paused));
    const [partial]=await prepareQuestionBanks('c',['m']),after=JSON.parse(await readFile(file,'utf8'));expect(after.continuation.hasMore).toBe(true);expect(partial.error).toContain('再次点击');expect(partial.questions.length).toBeGreaterThan(0);expect(partial.questions.at(-1)!.sources.at(-1)!.page).toBeLessThan(after.pages.at(-1).page);
    const firstId=partial.questions[0].id;const [finished]=await prepareQuestionBanks('c',['m']);expect(finished.questions).toHaveLength(180);expect(finished.questions[0].id).toBe(firstId);expect(finished.questions.at(-1)!.options).toHaveLength(2);expect(JSON.parse(await readFile(file,'utf8')).continuation.hasMore).toBe(false);
  }finally{await writeFile(file,original);await db.material.update({where:{id:'m'},data:{filePath:material.filePath}});}
},20000);

it('invalidates an old text-only bank when identical text gains embedded media or parser metadata',async()=>{
  const file=path.join(dataDir,'extractions/m.json'),original=await readFile(file,'utf8'),before=(await listQuestionBanks('c'))[0];
  try{const content=JSON.parse(original);content.pages[1].blocks=[{type:'image',sourceStart:2,sourceEnd:2,assetPath:'word/media/image1.png',marker:'原题图示'}];await writeFile(file,JSON.stringify(content));const [after]=await prepareQuestionBanks('c',['m']);expect(after.id).not.toBe(before.id);expect(after.questions[0].media?.[0].url).toContain('assets?path=word%2Fmedia%2Fimage1.png');expect((await listQuestionBanks('c'))[0].id).toBe(after.id);}finally{await writeFile(file,original);}
});


it('fills blank topic and criteria lines left by the editor while preserving the manual answer',async()=>{
  const bank=(await listQuestionBanks('c'))[0];await reviseBankQuestion('c',bank.id,bank.revision,bank.questions[0].id,{kind:'short',answer:'人工答案',topics:['  '],explanation:'人工解析',criteria:['','  ']});
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>({model:'test',output:{answers:JSON.parse(task.input).questions.map((q:{questionId:string;kind:string})=>({questionId:q.questionId,answer:q.kind==='short'?'AI答案':'A',explanation:'AI解析',topics:['实际标签'],criteria:q.kind==='short'?['内容完整']:[],warnings:[]}))}}));
  await analyzeQuestionBanks('c',['m']);const updated=(await listQuestionBanks('c'))[0];expect(updated.state).toBe('ready');expect(updated.questions[0].answer).toBe('人工答案');expect(updated.questions[0].explanation).toBe('人工解析');expect(updated.questions[0].topics).toEqual(['实际标签']);expect(updated.questions[0].criteria).toEqual(['内容完整']);
});
it('fills missing subjective criteria while retaining its manual answer and explanation',async()=>{
  const bank=(await listQuestionBanks('c'))[0];await reviseBankQuestion('c',bank.id,bank.revision,bank.questions[0].id,{kind:'short',answer:'我修订的参考答案',topics:['人工标签'],explanation:'人工解析',criteria:[]});
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>({model:'test',output:{answers:JSON.parse(task.input).questions.map((q:{questionId:string;kind:string})=>({questionId:q.questionId,answer:q.kind==='short'?'AI参考答案':'A',explanation:'AI解析',topics:['AI标签'],criteria:q.kind==='short'?['论证完整']:[],warnings:[]}))}}));
  await analyzeQuestionBanks('c',['m']);const question=(await listQuestionBanks('c'))[0].questions[0];expect(question.answer).toBe('我修订的参考答案');expect(question.explanation).toBe('人工解析');expect(question.topics).toEqual(['人工标签']);expect(question.criteria).toEqual(['论证完整']);
});
it('leaves empty AI explanations partial and fills them on a requested retry',async()=>{
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>({model:'test',output:{answers:JSON.parse(task.input).questions.map((q:{questionId:string})=>({questionId:q.questionId,answer:'A',explanation:'',topics:['实际标签'],criteria:[],warnings:[]}))}}));await analyzeQuestionBanks('c',['m']);expect((await listQuestionBanks('c'))[0].state).toBe('partial');
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>({model:'test',output:{answers:JSON.parse(task.input).questions.map((q:{questionId:string})=>({questionId:q.questionId,answer:'B',explanation:'后来补齐的解析',topics:['新标签'],criteria:[],warnings:[]}))}}));await analyzeQuestionBanks('c',['m']);const bank=(await listQuestionBanks('c'))[0];expect(bank.state).toBe('ready');expect(bank.questions[0].answer).toBe('A');expect(bank.questions[0].explanation).toBe('后来补齐的解析');expect(bank.questions[0].topics).toEqual(['实际标签']);
});
it('reserves an orphaned processing bank before the first database write so startup polling does not interrupt it',async()=>{
  const bank=(await listQuestionBanks('c'))[0];await db.originalQuestionBank.update({where:{id:bank.id},data:{content:JSON.stringify({...bank,state:'processing'})}});
  let finish!:(value:Awaited<ReturnType<typeof requestStructuredOutput>>)=>void,input:{questions:{questionId:string}[]}|null=null;
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>{input=JSON.parse(task.input);return new Promise(resolve=>{finish=resolve;});});
  const task=analyzeQuestionBanks('c',['m']);const during=(await listQuestionBanks('c'))[0];expect(during.state).toBe('processing');expect(during.error).not.toContain('中断');await vi.waitFor(()=>expect(input).not.toBeNull());
  finish({model:'test',output:{answers:input!.questions.map(q=>({questionId:q.questionId,answer:'A',explanation:'解析',topics:['标签'],criteria:[],warnings:[]}))}});await task;expect((await listQuestionBanks('c'))[0].state).toBe('ready');
});

it('reports all reserved material jobs as processing across a multi-file batch before their first writes',async()=>{
  const material=await db.material.findUniqueOrThrow({where:{id:'m'}});await db.material.create({data:{...material,id:'reserved-m2',name:'第二份.docx',hash:'second-source'}});await writeFile(path.join(dataDir,'extractions/reserved-m2.json'),await readFile(path.join(dataDir,'extractions/m.json')));await prepareQuestionBanks('c',['reserved-m2']);
  const waiting:{input:{questions:{questionId:string}[]};finish:(value:Awaited<ReturnType<typeof requestStructuredOutput>>)=>void}[]=[];
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>new Promise(resolve=>{waiting.push({input:JSON.parse(task.input),finish:resolve});}));
  const task=analyzeQuestionBanks('c',['m','reserved-m2']);await vi.waitFor(()=>expect(waiting).toHaveLength(1));const during=await listQuestionBanks('c');
  function finish(index:number){waiting[index].finish({model:'test',output:{answers:waiting[index].input.questions.map(q=>({questionId:q.questionId,answer:'A',explanation:'解析',topics:['标签'],criteria:[],warnings:[]}))}});}
  finish(0);await vi.waitFor(()=>expect(waiting).toHaveLength(2));finish(1);await task;expect(during.every(bank=>bank.state==='processing')).toBe(true);
});
async function waitSingleAnswer(bankId:string,questionId:string){let bank=(await listQuestionBanks('c')).find(item=>item.id===bankId)!;await vi.waitFor(async()=>{bank=(await listQuestionBanks('c')).find(item=>item.id===bankId)!;expect(['queued','running']).not.toContain(bank.questions.find(item=>item.id===questionId)?.answerGeneration?.state);},{timeout:5000});return bank;}
const singleOutput=(questionId:string)=>({model:'test',output:{answers:[{questionId,answer:'A',explanation:'仅针对本题的 AI 解析',topics:['信用工具'],criteria:[],warnings:[]}]}});
it('generates and caches only the opened missing-answer question and deduplicates simultaneous requests',async()=>{
  const bank=(await listQuestionBanks('c'))[0],question=bank.questions[0];let release!:(value:ReturnType<typeof singleOutput>)=>void;
  vi.mocked(requestStructuredOutput).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  await Promise.all([ensureOriginalAnswer('c',bank.id,question.id),ensureOriginalAnswer('c',bank.id,question.id)]);
  await vi.waitFor(()=>expect(requestStructuredOutput).toHaveBeenCalledOnce());
  const input=JSON.parse(vi.mocked(requestStructuredOutput).mock.calls[0][0].input);expect(input.questions.map((item:{questionId:string})=>item.questionId)).toEqual([question.id]);expect(input.questions[0].context).toBe(question.context);expect(input).not.toHaveProperty('answers');
  const pending=(await listQuestionBanks('c'))[0];expect(pending.questions[1].answerGeneration).toBeUndefined();expect(pending.questions[1].answer).toBe('');
  release(singleOutput(question.id));const ready=await waitSingleAnswer(bank.id,question.id);expect(ready.questions[0],JSON.stringify(ready.questions[0].answerGeneration)).toMatchObject({answer:'A',answerSource:'ai',answerGeneration:{state:'ready'}});
  await ensureOriginalAnswer('c',bank.id,question.id);expect(requestStructuredOutput).toHaveBeenCalledOnce();
});
it('does not report a completed answer as interrupted when a status read overlaps completion',async()=>{
  const bank=(await listQuestionBanks('c'))[0],question=bank.questions[0];let release!:(value:ReturnType<typeof singleOutput>)=>void,releaseRead!:()=>void;
  vi.mocked(requestStructuredOutput).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  await ensureOriginalAnswer('c',bank.id,question.id);await vi.waitFor(()=>expect(requestStructuredOutput).toHaveBeenCalledOnce());
  const extraction=await import('./extraction'),read=extraction.readExtraction;
  const spy=vi.spyOn(extraction,'readExtraction').mockImplementationOnce(async id=>{await new Promise<void>(resolve=>{releaseRead=resolve;});return read(id);});
  try {
    const delayed=listQuestionBanks('c');await vi.waitFor(()=>expect(releaseRead).toBeTypeOf('function'));
    const runtime=(globalThis as unknown as {originalAnswerRuntime:{active:Map<string,Promise<void>>}}).originalAnswerRuntime;
    release(singleOutput(question.id));await Promise.all(runtime.active.values());releaseRead();
    const ready=(await delayed).find(item=>item.id===bank.id)!;
    expect(ready.questions[0],JSON.stringify(ready.questions[0].answerGeneration)).toMatchObject({answer:'A',answerSource:'ai',answerGeneration:{state:'ready'}});
  } finally {spy.mockRestore();}
});
it('does not replace an original or manual answer, including a manual edit during generation',async()=>{
  const bank=(await listQuestionBanks('c'))[0],question=bank.questions[0];let release!:(value:ReturnType<typeof singleOutput>)=>void;
  vi.mocked(requestStructuredOutput).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  await ensureOriginalAnswer('c',bank.id,question.id);await vi.waitFor(()=>expect(requestStructuredOutput).toHaveBeenCalledOnce());
  const pending=(await listQuestionBanks('c'))[0];await reviseBankQuestion('c',bank.id,pending.revision,question.id,{answer:'B',explanation:'我核对的解释'});
  release(singleOutput(question.id));const ready=await waitSingleAnswer(bank.id,question.id);expect(ready.questions[0]).toMatchObject({answer:'B',answerSource:'manual',explanation:'我核对的解释'});
  await ensureOriginalAnswer('c',bank.id,question.id);expect(requestStructuredOutput).toHaveBeenCalledOnce();
});
it('preserves failures until an explicit retry and rejects answers for a different question',async()=>{
  const bank=(await listQuestionBanks('c'))[0],question=bank.questions[0];
  vi.mocked(requestStructuredOutput).mockResolvedValueOnce(singleOutput('foreign-question')).mockResolvedValueOnce(singleOutput(question.id));
  await ensureOriginalAnswer('c',bank.id,question.id);const failed=await waitSingleAnswer(bank.id,question.id);expect(failed.questions[0]).toMatchObject({answer:'',answerGeneration:{state:'failed'}});
  await ensureOriginalAnswer('c',bank.id,question.id);expect(requestStructuredOutput).toHaveBeenCalledOnce();
  await ensureOriginalAnswer('c',bank.id,question.id,true);const ready=await waitSingleAnswer(bank.id,question.id);expect(ready.questions[0].answer).toBe('A');expect(requestStructuredOutput).toHaveBeenCalledTimes(2);
});
it('fills an active round without resetting answers, index, round ID or self assessment',async()=>{
  let bank=(await listQuestionBanks('c'))[0];bank=await reviseBankQuestion('c',bank.id,bank.revision,bank.questions[1].id,{kind:'short',options:[]});
  const ids=bank.questions.map(question=>question.id),loaded=await loadOriginalSession('c','knowledge',ids,'practice');
  const saved=await saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,index:1,answers:{[ids[0]]:'A',[ids[1]]:'我的论述'},results:{[ids[0]]:{answer:'A',correct:null,source:'none'},[ids[1]]:{answer:'我的论述',correct:false,source:'self'}}});
  vi.mocked(requestStructuredOutput).mockImplementation(async task=>{const input=JSON.parse(task.input);return singleOutput(input.questions[0].questionId);});
  for(const id of ids){await ensureOriginalAnswer('c',bank.id,id);await waitSingleAnswer(bank.id,id);}
  const refreshed=await refreshOriginalSessionAnswers('c',saved.scope,saved.revision);expect(refreshed.scope).toBe(saved.scope);expect(refreshed.session.roundId).toBe(saved.session.roundId);expect(refreshed.session.answers).toEqual(saved.session.answers);expect(refreshed.session.index).toBe(1);expect(refreshed.session.results[ids[0]]).toMatchObject({answer:'A',correct:true,source:'ai'});expect(refreshed.session.results[ids[1]]).toEqual(saved.session.results[ids[1]]);expect(refreshed.rounds).toEqual(saved.rounds);
});
it('keeps submitted snapshots frozen and uses cached references only in a newly started round',async()=>{
  const bank=(await listQuestionBanks('c'))[0],id=bank.questions[0].id,loaded=await loadOriginalSession('c','paper',[id],'exam');
  const finished=await saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,answers:{[id]:'A'},results:{[id]:{answer:'A',correct:null,source:'none'}},submitted:true,finished:true});
  vi.mocked(requestStructuredOutput).mockResolvedValue(singleOutput(id));await ensureOriginalAnswer('c',bank.id,id);await waitSingleAnswer(bank.id,id);
  const unchanged=await refreshOriginalSessionAnswers('c',finished.scope,finished.revision);expect(unchanged).toEqual(finished);
  const fresh=await restartOriginalSession('c',finished.scope,finished.revision,'practice');expect(fresh.questions[0].answer).toBe('A');expect(fresh.rounds[0].questions[0].answer).toBe('');expect(fresh.rounds[0].session.answers[id]).toBe('A');
});
it('replays a lost reference-sync response without writing twice or replacing another page answer',async()=>{
  const bank=(await listQuestionBanks('c'))[0],id=bank.questions[0].id,loaded=await loadOriginalSession('c','knowledge',[id],'practice');
  const saved=await saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,answers:{[id]:'A'},results:{[id]:{answer:'A',correct:null,source:'none'}}});
  vi.mocked(requestStructuredOutput).mockResolvedValue(singleOutput(id));await ensureOriginalAnswer('c',bank.id,id);await waitSingleAnswer(bank.id,id);
  const filled=await refreshOriginalSessionAnswers('c',saved.scope,saved.revision,saved.session);
  expect(await refreshOriginalSessionAnswers('c',saved.scope,saved.revision,saved.session)).toEqual(filled);
  await saveOriginalSession('c',filled.scope,filled.revision,{...filled.session,answers:{[id]:'B'},results:{[id]:{answer:'B',correct:false,source:'self'}}});
  await expect(refreshOriginalSessionAnswers('c',saved.scope,saved.revision,saved.session)).rejects.toThrow(/作答记录已更新/);
  const retained=await loadOriginalSession('c','knowledge',[],'practice');expect(retained.session.answers[id]).toBe('B');expect(retained.session.results[id].source).toBe('self');
});
it('rejects a changed stem during answer synchronization and preserves current work',async()=>{
  const bank=(await listQuestionBanks('c'))[0],id=bank.questions[0].id,loaded=await loadOriginalSession('c','knowledge',[id],'practice');
  const saved=await saveOriginalSession('c',loaded.scope,loaded.revision,{...loaded.session,answers:{[id]:'B'}});
  await reviseBankQuestion('c',bank.id,bank.revision,id,{prompt:'题干已经改变',answer:'A'});
  await expect(refreshOriginalSessionAnswers('c',saved.scope,saved.revision)).rejects.toThrow(/题干|来源/);
  const retained=await loadOriginalSession('c','knowledge',[],'practice');expect(retained.session.answers[id]).toBe('B');expect(retained.questions[0].prompt).toBe(saved.questions[0].prompt);
});
it('fills explanations only for selected questions while preserving the supplied answer', async () => {
  const bank = (await listQuestionBanks('c'))[0], first = bank.questions[0], other = bank.questions[1];
  await reviseBankQuestion('c', bank.id, bank.revision, first.id, { answer: 'A', explanation: '' });
  vi.mocked(requestStructuredOutput).mockImplementation(async task => {
    const input = JSON.parse(task.input); expect(input.questions.map((question: { questionId: string }) => question.questionId)).toEqual([first.id]);
    return { model: 'test', output: { answers: [{ questionId: first.id, answer: 'B', explanation: 'AI 补充解析', topics: ['信用工具'], criteria: [], warnings: ['沿用资料答案'] }] } };
  });
  await analyzeQuestionBanks('c', ['m'], [first.id]);
  const current = (await listQuestionBanks('c'))[0];
  expect(current.questions[0]).toMatchObject({ answer: 'A', explanation: 'AI 补充解析', explanationSource: 'ai' });
  expect(current.questions.find(question => question.id === other.id)).toEqual(other);
});
