import { z } from 'zod';
import { outputSchema, validateOutput, type SourcePage } from './generation';
import { normalizeQuote, studyQuestionBody, type StudyCandidate } from './material-study';
import { originalKindNames, type OriginalQuestion } from './question-bank-types';
import { headingKind } from './question-bank';

export const automaticStudySchema = outputSchema.extend({questionIds:z.array(z.string().min(1).max(300)).max(1000)});
export function validateAutomaticStudy(input:unknown,pages:SourcePage[],questions:OriginalQuestion[],model:string,draftId:string):{sections:StudyCandidate[];warnings:string[]}{
  const parsed=automaticStudySchema.safeParse(input);if(!parsed.success)throw new Error('自动整理格式不完整，请重试。');
  if(new Set(parsed.data.questionIds).size!==parsed.data.questionIds.length||parsed.data.questionIds.some(id=>!questions.some(question=>question.id===id)))throw new Error('整理结果包含无法匹配的原题，未保存。');
  const selected=questions.filter(question=>parsed.data.questionIds.includes(question.id));
  const checked=validateOutput(parsed.data,pages,model,draftId);
  if(checked.sections.some(section=>section.refs.every(ref=>questions.some(question=>!question.answer&&!question.explanation&&question.materialId===ref.materialId&&question.sources.some(source=>source.page===ref.page&&normalizeQuote(source.snippet).includes(normalizeQuote(ref.snippet)))))))throw new Error('原题缺少讲解依据，不能收录为知识笔记。');
  const sections:StudyCandidate[]=checked.sections.map(section=>({...section,destination:'notebook',review:'pending'}));
  for(const question of selected)sections.push({id:`question-${question.id}`,title:question.kind==='term'?question.prompt.slice(0,120):`${originalKindNames[question.kind]} ${question.number}`,body:studyQuestionBody(question),destination:'practice',question,review:'pending',needsReview:true,refs:question.sources.map(source=>({...source,materialId:question.materialId,anchor:{quote:source.snippet}})),generation:{provider:'DeepSeek',model,draftId,contentOrigin:'source'}});
  const covered=new Set(sections.flatMap(section=>section.refs.map(ref=>`${ref.materialId}:${ref.page}`)));
  return {sections,warnings:checked.warnings.filter(warning=>!pages.some(page=>(covered.has(`${page.materialId}:${page.page}`)||headingKind(page.text.trim()))&&warning===`${page.name} 第 ${page.page} 页未被本次候选引用，请单独核对是否遗漏。`))};
}
