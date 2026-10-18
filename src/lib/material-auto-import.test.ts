import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
vi.mock('./db',async()=>{
  const fs=await import('node:fs/promises'),path=await import('node:path');await fs.mkdir('tmp',{recursive:true});const dataDir=await fs.mkdtemp(path.resolve('tmp/auto-import-'));
  return {dataDir,db:{material:{findUnique:vi.fn(),findMany:vi.fn()}}};
});
vi.mock('./extraction',()=>({readExtraction:vi.fn(),extractMaterial:vi.fn()}));
vi.mock('./question-bank-store',()=>({prepareQuestionBanks:vi.fn()}));
import { db, dataDir } from './db';
import { readExtraction, extractMaterial } from './extraction';
import { prepareQuestionBanks } from './question-bank-store';
import { queueMaterialImport, questionImportReports } from './material-auto-import';
import type { Extraction } from './extraction-types';
import type { QuestionBankData } from './question-bank-types';
const material={id:'m',courseId:'c',name:'合成资料.txt',hash:'same-version',excluded:false,conflictResolution:null,status:'extracted'};
const extraction=(more=false,next=2)=>({state:more?'partial':'complete',continuation:{startSource:1,hasMore:more,nextSource:more?next:undefined},pages:[{page:1,text:'已读取的完整题干'}]}) as Extraction;
const questions=[{kind:'single',answerSource:'original',warnings:[]},{kind:'short',answerSource:'none',warnings:[]},{kind:'unknown',answerSource:'none',warnings:['结构不完整，请核对原页']}];
beforeEach(async()=>{
  vi.clearAllMocks();vi.mocked(db.material.findUnique).mockResolvedValue(material as never);vi.mocked(db.material.findMany).mockResolvedValue([material] as never);vi.mocked(readExtraction).mockResolvedValue(extraction());vi.mocked(prepareQuestionBanks).mockResolvedValue([{questions,error:''}] as QuestionBankData[]);
  await mkdir(path.join(dataDir,'question-imports'),{recursive:true});await writeFile(path.join(dataDir,'question-imports/m.json'),'{}');
});
async function finished(){let reports=await questionImportReports('c');await vi.waitFor(async()=>{reports=await questionImportReports('c');expect(reports[0]?.state).toMatch(/ready|failed/);});return reports[0];}
afterEach(async()=>{await vi.waitFor(()=>expect((globalThis as unknown as {materialImportRuntime:{active:Set<string>}}).materialImportRuntime.active.size).toBe(0));});
it('reads all continuation ranges before reporting the actual imported question counts',async()=>{
  vi.mocked(readExtraction).mockResolvedValue(extraction(true,2));vi.mocked(extractMaterial).mockResolvedValueOnce(extraction(true,3)).mockResolvedValueOnce(extraction());
  queueMaterialImport('m',true);queueMaterialImport('m',true);const report=await finished();
  expect(report).toMatchObject({state:'ready',sourceHash:'same-version',total:3,originalAnswers:1,needsReview:1});expect(extractMaterial).toHaveBeenCalledTimes(2);expect(prepareQuestionBanks).toHaveBeenCalledExactlyOnceWith('c',['m'],true);
  expect(JSON.parse(await readFile(path.join(dataDir,'question-imports/m.json'),'utf8'))).toMatchObject({state:'ready',total:3});
});
it('preserves a stalled read as a retryable failure without pretending all questions were imported',async()=>{
  vi.mocked(readExtraction).mockResolvedValue(extraction(true,2));vi.mocked(extractMaterial).mockResolvedValue(extraction(true,2));queueMaterialImport('m',true);
  expect(await finished()).toMatchObject({state:'failed',total:0,error:expect.stringContaining('未完成范围')});expect(prepareQuestionBanks).not.toHaveBeenCalled();
});
it('does not import a material whose course is still unconfirmed',async()=>{
  vi.mocked(db.material.findUnique).mockResolvedValue({...material,status:'review'} as never);queueMaterialImport('m',true);
  await vi.waitFor(()=>expect(db.material.findUnique).toHaveBeenCalled());expect(prepareQuestionBanks).not.toHaveBeenCalled();expect(await questionImportReports('c')).toEqual([]);
});
it('restores an interrupted report and stops using it when the source version changes',async()=>{
  await writeFile(path.join(dataDir,'question-imports/m.json'),JSON.stringify({materialId:'m',sourceHash:'same-version',state:'running',total:0}));expect((await questionImportReports('c'))[0]).toMatchObject({state:'failed',error:expect.stringContaining('中断')});
  vi.mocked(db.material.findMany).mockResolvedValue([{...material,hash:'changed-version'}] as never);expect(await questionImportReports('c')).toEqual([]);
});
