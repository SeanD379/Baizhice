import { expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const mock=vi.hoisted(()=>({output:'',args:[] as string[]}));
vi.mock('node:child_process',async()=>{
  const {promisify}=await import('node:util');
  const execFile=Object.assign(vi.fn(),{[promisify.custom]:async(_file:string,args:string[])=>{mock.args=args;return {stdout:mock.output,stderr:''};}});
  return {execFile};
});
vi.mock('./db',async()=>({dataDir:await (await import('node:fs/promises')).mkdtemp((await import('node:path')).join((await import('node:os')).tmpdir(),'lms-extraction-')),db:{material:{update:vi.fn()}}}));
import {dataDir} from './db';
import {extractMaterial,readExtraction} from './extraction';
const material={id:'m',mime:'text/plain',filePath:'test.txt',fixture:null};
const part=(page:number,text:string)=>({page,text,method:'text',state:'extracted',warnings:[]});
it('continues raw positions without replacing previous sources and snapshots the prior recognition record',async()=>{
  await mkdir(path.join(dataDir,'extractions'),{recursive:true});
  const previous={state:'partial',pageCount:2,sourceCount:4,durationMs:100,updatedAt:'old',pages:[part(1,'单选题'),part(2,'1.请选择。')],continuation:{startSource:1,hasMore:true,nextSource:3,reason:'result-limit'}};
  await writeFile(path.join(dataDir,'extractions/m.json'),JSON.stringify(previous));
  mock.output=JSON.stringify({state:'complete',pageCount:2,sourceCount:4,durationMs:90,updatedAt:'new',pages:[part(3,'A.甲 B.乙'),part(4,'2.简述概念。')],continuation:{startSource:3,hasMore:false}});
  const result=await extractMaterial(material,{continue:true});
  expect(mock.args.at(-1)).toBe('3');expect(result.pages.map(p=>p.page)).toEqual([1,2,3,4]);
  expect(result.state).toBe('complete');expect((await readExtraction('m'))?.pages).toHaveLength(4);
  const snapshots=await readdir(path.join(dataDir,'extraction-history','m'));
  expect(JSON.parse(await readFile(path.join(dataDir,'extraction-history','m',snapshots[0]),'utf8'))).toEqual(previous);
});

it('retains an unresolved empty scan when later pages finish processing',async()=>{
  const previous={state:'partial',pageCount:1,sourceCount:2,durationMs:1,updatedAt:'old',pages:[{page:1,text:'',method:'local-ocr',state:'empty',warnings:['扫描文字尚未识别']}],continuation:{startSource:1,hasMore:true,nextSource:2}};
  await writeFile(path.join(dataDir,'extractions/m.json'),JSON.stringify(previous));
  mock.output=JSON.stringify({state:'complete',pageCount:1,sourceCount:2,durationMs:1,updatedAt:'new',pages:[{...part(2,'后续文字'),method:'pdf-text'}],continuation:{startSource:2,hasMore:false}});
  expect((await extractMaterial({...material,mime:'application/pdf'},{continue:true})).state).toBe('partial');
});
