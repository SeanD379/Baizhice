import { z } from 'zod';
import { gradeObjective, type Question } from './practice';

const resultSchema=z.object({answer:z.string().max(8000),correct:z.boolean().nullable()});
export const sessionSchema=z.object({roundId:z.string().uuid().optional(),mode:z.enum(['practice','exam']).default('practice'),submitted:z.boolean().default(false),ids:z.array(z.string()).max(20),index:z.number().int().nonnegative(),answers:z.record(z.string(),z.string().max(8000)),results:z.record(z.string(),resultSchema),finished:z.boolean(),attempts:z.array(z.object({id:z.string(),correct:z.boolean(),at:z.string().max(40)})).max(200)});
export type PracticeSession=z.infer<typeof sessionSchema>;
export const blankSession=():PracticeSession=>({mode:'practice',submitted:false,ids:[],index:0,answers:{},results:{},finished:false,attempts:[]});
export function validateSession(input:unknown,questions:Question[]):PracticeSession {
  const state=sessionSchema.parse(input),available=new Set(questions.map(q=>q.id));
  const used=[...state.ids,...Object.keys(state.answers),...Object.keys(state.results),...state.attempts.map(a=>a.id)];
  if(used.some(id=>!available.has(id))||new Set(state.ids).size!==state.ids.length)throw new Error('练习题目范围已变化，请重新打开练习。');
  if(state.index>=Math.max(1,state.ids.length))throw new Error('练习进度不正确。');
  if(Object.keys(state.answers).some(id=>!state.ids.includes(id)))throw new Error('答案不属于本组练习。');
  for(const [id,result] of Object.entries(state.results)) {
    if(!state.ids.includes(id)||!result.answer.trim()||state.answers[id]!==result.answer)throw new Error('作答记录不完整。');
    const expected=gradeObjective(questions.find(q=>q.id===id)!,result.answer);
    if(expected!==null&&expected!==result.correct)throw new Error('作答判定与参考答案不匹配。');
  }
  if(state.mode==='exam') {
    if(!state.submitted&&Object.keys(state.results).length)throw new Error('考试交卷前不能保存判定结果。');
    if(state.submitted&&(!state.ids.length||state.ids.some(id=>!state.results[id])))throw new Error('交卷必须包含整组答案。');
  }
  if(state.finished&&(!state.ids.length||state.ids.some(id=>state.results[id]?.correct==null)))throw new Error('本组尚有未完成作答或自评。');
  return state;
}

export function submitExam(session:PracticeSession,questions:Question[],at:string):PracticeSession {
  const state=validateSession(session,questions);
  if(state.mode!=='exam'||state.submitted)throw new Error('本组不能重复交卷。');
  if(!state.ids.length||state.ids.some(id=>!state.answers[id]?.trim()))throw new Error('请先完成所有题目再交卷。');
  const results:PracticeSession['results']={},attempts=[...state.attempts];
  for(const id of state.ids) {
    const answer=state.answers[id],correct=gradeObjective(questions.find(q=>q.id===id)!,answer);
    results[id]={answer,correct};
    if(correct!==null)attempts.push({id,correct,at});
  }
  return {...state,submitted:true,index:0,results,attempts:attempts.slice(-200)};
}
