import { expect,it } from 'vitest';
import { validateQuestions } from './practice-generation';
import { gradeObjective, type Question } from './practice';
import { validateSession, blankSession } from './practice-session';
import type { Section } from './types';
const section:Section={id:'s',title:'平均值',body:'三个数 1、2、3 的平均值为 2。',refs:[{materialId:'m',name:'讲义',page:2,snippet:'三个数 1、2、3 的平均值为 2。'}]};
const raw={sectionId:'s',kind:'choice',prompt:'这三个数的平均值是多少？',options:['1','2','3'],answer:'2',explanation:'总和为 6，共三个数。',criteria:[],reference:{materialId:'m',page:2,snippet:'三个数 1、2、3 的平均值为 2。'}};
it('grades using each question answer, preserving equivalent fractions',()=>{
 const q={kind:'fill',answer:'1/2',grading:'exact-or-self'} as Question;
 expect(gradeObjective(q,'2/4')).toBe(true);expect(gradeObjective(q,'2/3')).toBeNull();
 expect(gradeObjective({...q,answer:'2'},'2')).toBe(true);
});
it('validates linked reviewed sections and exact quoted evidence',()=>{
 const questions=validateQuestions({questions:[raw]},[section]);
 expect(questions[0].reference.page).toBe(2);expect(questions[0].sectionId).toBe('s');
 expect(()=>validateQuestions({questions:[raw]},[{...section,needsReview:true}])).toThrow();
 for(const change of [{sectionId:'foreign'},{answer:'4'},{options:['2','2']},{reference:{...raw.reference,page:1}}])expect(()=>validateQuestions({questions:[{...raw,...change}]},[section])).toThrow();
});
it('does not accept subjective questions without evaluation criteria',()=>{
 expect(()=>validateQuestions({questions:[{...raw,kind:'short',options:[]}]},[section])).toThrow();
});
it('rejects session IDs outside its question set and invalid progress',()=>{
 const questions=validateQuestions({questions:[raw]},[section]);
 expect(()=>validateSession({...blankSession(),ids:['foreign']},questions)).toThrow();
 expect(()=>validateSession({...blankSession(),ids:[questions[0].id],index:3},questions)).toThrow();
});
it('rejects tampered objective results and accepts a short answer self assessment',()=>{
 const questions=validateQuestions({questions:[raw]},[section]),id=questions[0].id;
 expect(()=>validateSession({...blankSession(),ids:[id],answers:{[id]:'1'},results:{[id]:{answer:'1',correct:true}}},questions)).toThrow();
 const subjective={...questions[0],kind:'short' as const,criteria:['解释理由']};
 expect(validateSession({...blankSession(),ids:[id],answers:{[id]:'我的推导'},results:{[id]:{answer:'我的推导',correct:false}}},[subjective]).results[id].correct).toBe(false);
});
