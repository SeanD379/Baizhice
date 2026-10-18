import { z } from 'zod';
import { hashContent } from './generation';
import type { Section } from './types';
import type { Question } from './practice';

export const questionsSchema=z.object({questions:z.array(z.object({sectionId:z.string(),kind:z.enum(['choice','fill','short']),prompt:z.string().min(1).max(1600),options:z.array(z.string().min(1).max(400)).max(5),answer:z.string().min(1).max(2000),explanation:z.string().min(1).max(3000),criteria:z.array(z.string().min(1).max(400)).max(8),reference:z.object({materialId:z.string(),page:z.number().int().positive(),snippet:z.string().min(4).max(1600)})})).min(1).max(5)});
export function validateQuestions(output:unknown,sections:Section[]):Question[] {
  const parsed=questionsSchema.safeParse(output);if(!parsed.success)throw new Error('出题结果格式不完整，没有保存。');
  const seen=new Set<string>(),normalize=(s:string)=>s.replace(/\s/g,'');
  return parsed.data.questions.map(q=>{
    const section=sections.find(s=>s.id===q.sectionId&&!s.needsReview);
    const ref=section?.refs.find(r=>r.materialId===q.reference.materialId&&r.page===q.reference.page&&normalize(q.reference.snippet).length>=4&&normalize(r.snippet).includes(normalize(q.reference.snippet)));
    if(!section||!ref)throw new Error('题目引用不属于已核对的知识点，没有保存。');
    if(!q.prompt.trim()||!q.answer.trim()||!q.explanation.trim())throw new Error('题目内容不完整。');
    if(q.kind==='choice'&&(q.options.length<2||new Set(q.options.map(o=>o.trim())).size!==q.options.length||!q.options.includes(q.answer)))throw new Error('选择题选项或参考答案不正确。');
    if(q.kind!=='choice'&&q.options.length)throw new Error('非选择题不应包含选项。');
    if(q.kind==='short'&&!q.criteria.length)throw new Error('简答题缺少自评要点。');
    const id=`question-${hashContent(JSON.stringify([q.sectionId,q.prompt])).slice(0,24)}`;
    if(seen.has(id))throw new Error('题目重复，没有保存。');seen.add(id);
    return {...q,id,topic:section.title,reference:{...q.reference,name:ref.name},grading:'exact-or-self'};
  });
}
