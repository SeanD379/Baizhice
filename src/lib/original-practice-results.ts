import type { OriginalSessionState } from './question-bank-types';

export function summarizeOriginalRound(session:OriginalSessionState) {
  const correctIds:string[]=[],wrongIds:string[]=[],pendingIds:string[]=[],unansweredIds:string[]=[];
  let selfAssessed=0,aiJudged=0;
  for(const id of session.ids) {
    const result=session.results[id];
    if(!session.answers[id]?.trim()){unansweredIds.push(id);continue;}
    if(result?.source==='self')selfAssessed++;
    if(result?.source==='ai')aiJudged++;
    if(result?.correct===true)correctIds.push(id);
    else if(result?.correct===false)wrongIds.push(id);
    else pendingIds.push(id);
  }
  const total=session.ids.length,correct=correctIds.length,wrong=wrongIds.length,pending=pendingIds.length,unanswered=unansweredIds.length,judged=correct+wrong;
  return {total,answered:total-unanswered,correct,wrong,pending,unanswered,correctIds,wrongIds,pendingIds,unansweredIds,selfAssessed,aiJudged,
    score:pending&&!judged?null:total?Math.round(correct/total*100):0,
    accuracy:judged?Math.round(correct/judged*100):null};
}
