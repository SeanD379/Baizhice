import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Section } from './types';

export type SourcePage = { materialId:string; name:string; page:number; text:string; extractionHash:string; method:'pdf-text'|'local-ocr'|'docx-text'|'pptx-text'|'text'; warnings:string[]; chapter?:string };
export type GenerationPreview = { id:string; courseId:string; expectedVersionId:string|null; sections:Section[]; warnings:string[]; model:string; createdAt:string };
export type GenerationSources = { configured:boolean; model:string; pages:SourcePage[]; unavailable:string[] };
export const hashContent=(text:string)=>createHash('sha256').update(text).digest('hex');
export const pageSchema=z.object({materialId:z.string().min(1),page:z.number().int().positive(),text:z.string().trim().min(1).max(40000),extractionHash:z.string().regex(/^[a-f0-9]{64}$/)});
export const outputSchema=z.object({
  sections:z.array(z.object({title:z.string().min(1).max(120),body:z.string().min(1).max(8000),refs:z.array(z.object({materialId:z.string().min(1),page:z.number().int().positive(),snippet:z.string().min(4).max(1600)})).min(1).max(8)})).max(12),
  warnings:z.array(z.string().min(1).max(1000)).max(20),
});

export function validatePages(input:unknown,available:SourcePage[]):SourcePage[] {
  const selected=z.array(pageSchema).min(1).max(2000).parse(input);
  if(selected.reduce((sum,p)=>sum+p.text.length,0)>40000)throw new Error('本次最多整理 40000 字，请缩小页码范围。');
  const keys=new Set<string>();
  return selected.map(p=>{
    const key=`${p.materialId}:${p.page}`;
    if(keys.has(key))throw new Error('同一页不能重复选择。'); keys.add(key);
    const original=available.find(a=>a.materialId===p.materialId&&a.page===p.page);
    if(!original)throw new Error('资料范围已变化，或所选页尚未提取出文字。请重新选择。');
    if(original.extractionHash!==p.extractionHash)throw new Error('资料已重新识别，请重新打开并核对最新文字。');
    return {...original,text:p.text};
  });
}

export function validateOutput(input:unknown,pages:SourcePage[],model:string,draftId:string):{sections:Section[];warnings:string[]} {
  const parsed=outputSchema.safeParse(input);
  if(!parsed.success)throw new Error('生成内容格式不完整，没有保存，请缩小资料范围后重试。');
  const result=parsed.data,seen=new Set<string>();
  const normalize=(text:string)=>text.replace(/\s+/g,'');
  const sections=result.sections.map(s=>{
    if(!s.title.trim()||!s.body.trim())throw new Error('生成内容包含空段落，没有保存，请重试。');
    const refs=s.refs.map(ref=>{
      const page=pages.find(p=>p.materialId===ref.materialId&&p.page===ref.page);
      if(!page||normalize(ref.snippet).length<4||!normalize(page.text).includes(normalize(ref.snippet)))throw new Error('生成内容包含无法匹配所选原页的引用，未保存。请核对资料后重试。');
      return {...ref,name:page.name};
    });
    const id=`ai-${hashContent(JSON.stringify([s.title.trim(),refs.map(r=>`${r.materialId}:${r.page}`).sort()])).slice(0,24)}`;
    if(seen.has(id))throw new Error('生成内容包含重复段落，未保存。请缩小范围后重试。');seen.add(id);
    return {id,title:s.title,body:s.body,refs,needsReview:true,generation:{provider:'DeepSeek' as const,model,draftId}};
  });
  const used=new Set(sections.flatMap(s=>s.refs.map(r=>`${r.materialId}:${r.page}`)));
  const omitted=pages.filter(p=>!used.has(`${p.materialId}:${p.page}`));
  return {sections,warnings:[...result.warnings,...omitted.map(p=>`${p.name} 第 ${p.page} 页未被本次候选引用，请单独核对是否遗漏。`)]};
}
