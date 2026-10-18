import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { db, dataDir } from './db';
import { extractionSchema, type Extraction } from './extraction-types';
const exec=promisify(execFile);
const directory=path.join(dataDir,'extractions');
const globalJobs=globalThis as unknown as { extractionJobs?:Map<string,Promise<Extraction>> };
const jobs=globalJobs.extractionJobs??=new Map();
export const isExtracting=(id:string)=>jobs.has(id);
export async function readExtraction(id:string):Promise<Extraction|null>{
  try{return extractionSchema.parse(JSON.parse(await readFile(path.join(directory,`${id}.json`),'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('识别记录无法读取，请重新提取原文件。');}
}
export function extractMaterial(material:{id:string;filePath:string;mime:string;fixture:string|null},options:{continue?:boolean}={}):Promise<Extraction>{
  const existing=jobs.get(material.id);if(existing)return existing;
  if(jobs.size>=2)return Promise.reject(new Error('本机已有两份资料正在识别，请稍后重试。'));
  const task=(async()=>{
    const previous=await readExtraction(material.id);
    const start=options.continue?previous?.continuation?.nextSource:undefined;
    if(options.continue&&(!previous?.continuation?.hasMore||!start))throw new Error('这份资料没有尚未处理的范围。');
    let stdout='';
    try{
      const output=await exec(process.execPath,[path.join(process.cwd(),'scripts','extract-document.mjs'),material.filePath,material.mime,...(start?[String(start)]:[])],{cwd:process.cwd(),timeout:240000,maxBuffer:2*1024*1024,windowsHide:true});
      stdout=output.stdout;
    }catch(error){
      const failure=error as {killed?:boolean;stdout?:string};
      if(failure.killed)throw new Error('识别超过本机时间限制。请拆分文档或缩小图片后重试，原文件仍保留。');
      try{const output=JSON.parse(failure.stdout??'');if(typeof output.error==='string')throw new Error(output.error);}catch(parsed){if(parsed instanceof SyntaxError)throw new Error('文件未能识别，请确认文件完整，或更换清晰图片后重试。');throw parsed;}
      throw new Error('识别失败，请重试。');
    }
    let result=extractionSchema.parse(JSON.parse(stdout));
    if(start&&previous){
      const pages=[...new Map([...previous.pages,...result.pages].map(page=>[page.page,page])).values()].sort((a,b)=>a.page-b.page);
      const blockedSource=previous.continuation?.blockedSource??result.continuation?.blockedSource;
      const requiresReview=pages.some(page=>page.state==='needs-ocr'||(page.state==='empty'&&!['docx-text','text'].includes(page.method))||page.blocks?.some(block=>['image','graphic'].includes(block.type))||page.numbering?.unsupported);
      result={...result,pages,pageCount:pages.length,durationMs:previous.durationMs+result.durationMs,state:result.state==='partial'||requiresReview||blockedSource?'partial':'complete',continuation:result.continuation?{...result.continuation,startSource:1,...(blockedSource?{blockedSource}:{})}:undefined};
    }
    await mkdir(directory,{recursive:true});
    if(previous){
      const history=path.join(dataDir,'extraction-history',material.id);
      await mkdir(history,{recursive:true});
      await writeFile(path.join(history,`${Date.now()}-${randomUUID()}.json`),JSON.stringify(previous),'utf8');
    }
    const destination=path.join(directory,`${material.id}.json`),temporary=`${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary,JSON.stringify(result),'utf8');await rename(temporary,destination);
    if(!material.fixture)await db.material.update({where:{id:material.id},data:{status:result.pages.some(p=>p.state==='extracted')?'extracted':'stored'}});
    return result;
  })();
  jobs.set(material.id,task);void task.then(()=>{jobs.delete(material.id);void import('./material-auto-import').then(module=>module.queueMaterialImport(material.id)).catch(()=>{});},()=>jobs.delete(material.id));
  return task;
}
