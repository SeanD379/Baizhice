import type { Material, Reference, Version } from './types';

export type Question = { id: string; kind: 'choice'|'fill'|'short'; topic: string; prompt: string; options?: string[]; answer: string; explanation: string; criteria?: string[]; reference: Reference; sectionId?:string; grading?:'exact-or-self'; numericTolerance?:number };
export function practiceQuestions(materials: Material[], version?: Version): Question[] {
  if (!version) return [];
  const result: Question[] = [];
  const source = (fixture: string) => materials.find(m => m.fixture===fixture && m.status==='ready' && !m.excluded);
  const conditional = source('conditional'), independence = source('independence');
  if (conditional && version.sections.some(s=>s.id==='conditional' && !s.needsReview)) {
    const reference = {materialId:conditional.id,name:conditional.name,page:1,snippet:'P(B|A) = P(A∩B) / P(A)，P(A)>0。'};
    result.push({id:'condition-choice',kind:'choice',topic:'条件概率',prompt:'使用条件概率公式 P(B|A)=P(A∩B)/P(A) 时，必须满足哪个条件？',options:['P(A)>0','P(B)>0','A 与 B 相互独立','A 与 B 互斥'],answer:'P(A)>0',explanation:'分母 P(A) 必须大于零。条件概率定义并不要求事件独立或互斥。',reference});
    result.push({id:'condition-fill',kind:'fill',topic:'条件概率',prompt:'讲义中，12 位选修数学的同学里有 8 位也选修物理。已知选中的同学选修数学，同时选修物理的概率是多少？',answer:'2/3',numericTolerance:.0005,explanation:'已知条件把范围限定在 12 位同学内，因此概率是 8/12=2/3。可填写分数或至少三位小数。',reference:{...reference,snippet:'已知他选修数学，则他同时选修物理的概率为 8/12 = 2/3。'}});
  }
  if (independence && version.sections.some(s=>s.id==='independence' && !s.needsReview)) {
    const reference={materialId:independence.id,name:independence.name,page:1,snippet:'当 P(A)>0 且 P(B)>0 时，互斥事件不独立。'};
    result.push({id:'independence-choice',kind:'choice',topic:'事件独立性',prompt:'已知 P(A)>0 且 P(B)>0，A 与 B 互斥。下面哪种说法正确？',options:['A 与 B 一定独立','A 与 B 不独立','无法判断是否独立','P(A∩B)=P(A)P(B)'],answer:'A 与 B 不独立',explanation:'互斥时联合概率为零，而两个正概率的乘积大于零，不满足独立的定义。',reference});
    result.push({id:'independence-short',kind:'short',topic:'事件独立性',prompt:'用自己的话解释：为什么当两个事件的概率都大于零时，互斥事件不独立？请写出推理过程。',answer:'互斥意味着 P(A∩B)=0。由于 P(A)>0 且 P(B)>0，P(A)P(B)>0，因此 P(A∩B)≠P(A)P(B)，不满足独立性的定义。',explanation:'关注推理中的条件和关系，不要求表述与参考答案逐字相同。',criteria:['说明互斥使联合概率为零','使用两个事件概率都大于零的条件，得到概率乘积大于零','比较两者并依据独立性定义得出不独立'],reference});
  }
  return result;
}

export function gradeObjective(question: Question, answer: string): boolean | null {
  if(question.kind==='short') return null;
  if(question.kind==='choice') return question.answer===answer;
  const normalize=(text:string)=>text.trim().replaceAll('／','/').replace(/\s/g,'');
  const normalized=normalize(answer),target=normalize(question.answer);
  if(normalized&&normalized===target)return true;
  const numeric=(text:string)=>{
    if(!/^[+-]?\d+(\.\d+)?(\/[+-]?\d+(\.\d+)?)?$/.test(text))return NaN;
    const parts=text.split('/').map(Number);return parts.length===2?parts[0]/parts[1]:parts[0];
  };
  const value=numeric(normalized),expected=numeric(target);
  if(Number.isFinite(value)&&Number.isFinite(expected)&&Math.abs(value-expected)<=(question.numericTolerance??1e-9))return true;
  return question.grading==='exact-or-self'?null:false;
}
