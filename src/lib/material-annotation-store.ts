import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { db, dataDir } from './db';
import { generationSources } from './generation-store';
import { normalizeQuote, type AnnotationAnchor, type MaterialAnnotation } from './material-study';
import type { Reference } from './types';
import type { SourcePage } from './generation';

const exec = promisify(execFile);
const imageDirectory = path.join(dataDir, 'annotation-images');
const imageBytes = (image:string) => {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) throw new Error('批注截图格式无效。');
  const bytes = Buffer.from(image.slice(image.indexOf(',')+1), 'base64');
  if (bytes.length > 3*1024*1024 || bytes.length < 8 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('批注截图须为 3 MB 内的 PNG。');
  return bytes;
};
export function annotationLocation(name:string):Reference['location'] { return /\.docx$|\.txt$/i.test(name)?'paragraph':/\.pptx$/i.test(name)?'slide':/\.(png|jpe?g|webp)$/i.test(name)?'image':'page'; }
export function selectedReferences(material:{id:string;name:string;hash:string}, anchor:AnnotationAnchor, pages:SourcePage[], confirmedText:boolean,hasImage=false):Reference[] {
  const available = anchor.page ? pages.filter(page=>page.page===anchor.page) : pages;
  const quote = normalizeQuote(anchor.quote);
  if(!quote&&anchor.kind==='region'&&confirmedText&&hasImage&&anchor.rects.length&&(anchor.page||anchor.displayPage))return [{materialId:material.id,name:material.name,page:anchor.page??anchor.displayPage!,snippet:'',location:'image',sourceHash:material.hash,anchor:{quote:'',rects:anchor.rects,displayPage:anchor.displayPage}}];
  if (!quote || !pages.length && anchor.kind==='text') return [];
  const joined = available.map(page=>normalizeQuote(page.text)).join('');
  let start = joined.indexOf(quote);
  const matches:number[]=[];
  while(start>=0) { if((!anchor.prefix||joined.slice(Math.max(0,start-normalizeQuote(anchor.prefix).length),start).endsWith(normalizeQuote(anchor.prefix)))&&(!anchor.suffix||joined.slice(start+quote.length,start+quote.length+normalizeQuote(anchor.suffix).length).startsWith(normalizeQuote(anchor.suffix))))matches.push(start);start=joined.indexOf(quote,start+1); }
  if (matches.length===1) {
    let offset=0; const end=matches[0]+quote.length;
    return available.flatMap(page=>{const normalized=normalizeQuote(page.text),from=Math.max(0,matches[0]-offset),to=Math.min(normalized.length,end-offset);offset+=normalized.length;const positions=[...page.text.matchAll(/\S/g)].map(match=>match.index);return from<to?[{materialId:material.id,name:material.name,page:page.page,snippet:page.text.slice(positions[from],positions[to-1]+1),location:annotationLocation(material.name),sourceHash:material.hash,anchor:{quote:anchor.quote,prefix:anchor.prefix,suffix:anchor.suffix,rects:anchor.rects,displayPage:anchor.displayPage}}]:[];});
  }
  if(anchor.kind==='region'&&confirmedText&&(anchor.page||anchor.displayPage)) return [{materialId:material.id,name:material.name,page:anchor.page??anchor.displayPage!,snippet:anchor.quote,location:anchor.page?annotationLocation(material.name):'image',sourceHash:material.hash,anchor:{quote:anchor.quote,rects:anchor.rects,displayPage:anchor.displayPage}}];
  if(anchor.kind==='region'&&!confirmedText) return [];
  throw new Error(matches.length>1?'摘录在文件中出现多次，请扩大选段后重新批注。':'摘录无法定位到已读取的原文，请先读取文件或重新选段。');
}
export async function annotationMaterial(materialId:string) {
  const material=await db.material.findUnique({where:{id:materialId}});
  if(!material)throw new Error('资料不存在。');
  return material;
}
export async function listMaterialAnnotations(courseId:string,materialId?:string) {
  if(!await db.course.findUnique({where:{id:courseId}}))throw new Error('课程不存在。');
  const [rows,materials,sources]=await Promise.all([db.materialAnnotation.findMany({where:{courseId,...(materialId?{materialId}:{})},orderBy:{createdAt:'asc'}}),db.material.findMany({where:{courseId,...(materialId?{id:materialId}:{})}}),generationSources(courseId)]);
  return Promise.all(rows.map(async row=>{const content=JSON.parse(row.content),material=materials.find(item=>item.id===row.materialId),hasImage=await access(path.join(imageDirectory,`${row.id}.png`)).then(()=>true,()=>false);return {...content,id:row.id,courseId,materialId:row.materialId,sourceHash:row.sourceHash,revision:row.revision,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),hasImage,stale:!material||material.hash!==row.sourceHash||material.excluded||!!material.conflictResolution||material.status==='review'||(!!content.extractionHash&&!sources.pages.some(page=>page.materialId===row.materialId&&page.extractionHash===content.extractionHash))} as MaterialAnnotation;}));
}
export async function saveMaterialAnnotation(materialId:string,input:{anchor:AnnotationAnchor;instruction:string;confirmedText:boolean;image?:string;id?:string;revision?:number}) {
  const material=await annotationMaterial(materialId),png=input.image?imageBytes(input.image):undefined;
  const sources=await generationSources(material.courseId),pages=sources.pages.filter(page=>page.materialId===material.id);
  const hasImage=!!png||!!input.id&&await access(path.join(imageDirectory,`${input.id}.png`)).then(()=>true,()=>false);
  const refs=selectedReferences(material,input.anchor,pages,input.confirmedText,hasImage),id=input.id??randomUUID();
  const content={name:material.name,anchor:input.anchor,refs,instruction:input.instruction,confirmedText:input.confirmedText,extractionHash:pages[0]?.extractionHash??''};
  if(input.id) {
    const old=await db.materialAnnotation.findFirst({where:{id,materialId}});
    if(!old||old.sourceHash!==material.hash)throw new Error('原文件或批注已变化，请重新选段。');
    const changed=await db.materialAnnotation.updateMany({where:{id,materialId,revision:input.revision},data:{content:JSON.stringify(content),revision:{increment:1}}});
    if(changed.count!==1)throw new Error('批注已在另一页面修改，请刷新后重试。');
  } else await db.materialAnnotation.create({data:{id,courseId:material.courseId,materialId,sourceHash:material.hash,content:JSON.stringify(content)}});
  if(png){await mkdir(imageDirectory,{recursive:true});await writeFile(path.join(imageDirectory,`${id}.png`),png);}
  return (await listMaterialAnnotations(material.courseId)).find(item=>item.id===id)!;
}
export async function deleteMaterialAnnotation(materialId:string,id:string,revision:number) {
  const changed=await db.materialAnnotation.deleteMany({where:{id,materialId,revision}});
  if(changed.count!==1)throw new Error('批注已变化，请刷新后重试。');
  await unlink(path.join(imageDirectory,`${id}.png`)).catch(error=>{if(error.code!=='ENOENT')throw error;});
}
export async function readAnnotationImage(materialId:string,id:string) {
  if(!/^[a-f0-9-]{36}$/.test(id)||!await db.materialAnnotation.findFirst({where:{id,materialId}}))throw new Error('批注截图不存在。');
  return readFile(path.join(imageDirectory,`${id}.png`));
}
export async function recognizeAnnotationImage(image:string) {
  const bytes=imageBytes(image),id=randomUUID(),directory=path.join(dataDir,'annotation-ocr');
  await mkdir(directory,{recursive:true});const file=path.join(directory,`${id}.png`);
  await writeFile(file,bytes);
  try {const {stdout}=await exec(process.execPath,[path.join(process.cwd(),'scripts','recognize-annotation.mjs'),file],{cwd:process.cwd(),timeout:45000,maxBuffer:1024*1024,windowsHide:true});return JSON.parse(stdout) as {text:string;confidence:number};}
  finally {await unlink(file).catch(()=>{});}
}
