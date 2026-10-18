import { expect, it } from 'vitest';
import { summarizeOriginalRound } from './original-practice-results';
import type { OriginalSessionState } from './question-bank-types';

const session:OriginalSessionState={roundId:'round',mode:'practice',ids:['right','wrong','pending','blank'],index:0,answers:{right:'A',wrong:'B',pending:'我的论述',blank:'  '},results:{right:{answer:'A',correct:true,source:'ai'},wrong:{answer:'B',correct:false,source:'original'},pending:{answer:'我的论述',correct:null,source:'none'},blank:{answer:'  ',correct:false,source:'original'}},submitted:true,finished:true};

it('separates unanswered and pending questions from mistakes and explains score denominators',()=>{
  expect(summarizeOriginalRound(session)).toMatchObject({total:4,answered:3,correct:1,wrong:1,pending:1,unanswered:1,score:25,accuracy:50,wrongIds:['wrong'],pendingIds:['pending'],unansweredIds:['blank']});
});
it('leaves accuracy unknown for an empty hand-in and does not turn blanks into mistakes',()=>{
  expect(summarizeOriginalRound({...session,answers:{},results:{}})).toMatchObject({correct:0,wrong:0,unanswered:4,score:0,accuracy:null});
});
it('does not fabricate a score when every answered question needs assessment',()=>{
  expect(summarizeOriginalRound({...session,ids:['pending'],answers:{pending:'论述'},results:{}})).toMatchObject({pending:1,score:null,accuracy:null});
});
it('counts a self-assessment while keeping its provenance available',()=>{
  expect(summarizeOriginalRound({...session,ids:['right'],results:{right:{answer:'A',correct:true,source:'self'}}})).toMatchObject({score:100,accuracy:100,selfAssessed:1,aiJudged:0});
});
