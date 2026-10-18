'use client';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from 'motion/react';
import { ArrowRight, Check, CheckCheck, ClipboardCheck, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import type { OriginalMode, OriginalQuestion, OriginalSessionState } from '@/lib/question-bank-types';
import { summarizeOriginalRound } from '@/lib/original-practice-results';
import CountUp from './react-bits/CountUp';
import { Button } from './ui/button';
import './original-practice-results.css';

type Props={session:OriginalSessionState;questions:OriginalQuestion[];celebrate:boolean;disabled:boolean;restartMode:OriginalMode;onRestartMode:(mode:OriginalMode)=>void;onRestart:()=>void;onReview:(id?:string)=>void;readOnly?:boolean};
export function OriginalPracticeResults({session,questions,celebrate,disabled,restartMode,onRestartMode,onRestart,onReview,readOnly=false}:Props) {
  const results=summarizeOriginalRound(session),reducedMotion=useReducedMotion();
  const heading=useRef<HTMLHeadingElement>(null);
  const [confetti,setConfetti]=useState(celebrate&&results.answered>0);
  const [numbersReady,setNumbersReady]=useState(false);
  const finishCounting=useCallback(()=>setNumbersReady(true),[]);
  useEffect(()=>{heading.current?.focus({preventScroll:true});heading.current?.closest('section')?.scrollIntoView({behavior:'instant',block:'start'});},[]);
  useEffect(()=>{if(!confetti)return;const timer=setTimeout(()=>setConfetti(false),2200);return()=>clearTimeout(timer);},[confetti]);
  const perfect=results.correct===results.total&&results.total>0;
  const title=readOnly&&!session.finished&&!session.submitted?'这轮练习，已留下记录':!results.answered?'本轮已结束，准备好再出发':perfect?'漂亮，这轮全部掌握！':results.pending?'这一轮完成了，继续核对收获':'每一次练习，都在向前';
  const subtitle=!results.answered?'这次还没有填写答案。准备好后，再给自己一次尝试。':perfect?'每一道题都答对了。把这份收获带进下一次练习。':results.pending?`已完成 ${results.answered} 题，还有 ${results.pending} 题等待核对；确认后，成绩会随之更新。`:'完成比停留更重要。看看这次的收获，再把薄弱处练扎实。';
  const states=[{key:'correct',label:'正确',count:results.correct,ids:results.correctIds},{key:'wrong',label:'错题',count:results.wrong,ids:results.wrongIds},{key:'unanswered',label:'未答',count:results.unanswered,ids:results.unansweredIds},{key:'pending',label:'待核对',count:results.pending,ids:results.pendingIds}];
  const reviewIds=results.wrongIds.length?results.wrongIds:results.pendingIds.length?results.pendingIds:results.unansweredIds;
  const reviewLabel=results.wrong?'复盘错题':results.pending?'核对答案':results.unanswered?'查看未答题':'回顾本轮收获';
  const weakTopics=[...new Set(questions.filter(q=>results.wrongIds.includes(q.id)).flatMap(q=>q.topics))].slice(0,3);
  const animate=celebrate&&!reducedMotion&&!numbersReady;
  const number=(value:number|null)=>value===null?'—':animate?<CountUp to={value} duration={1.4} onEnd={finishCounting}/>:value;
  return <section className="practice-results original-round-summary" aria-label="本轮答题结果">
    {confetti&&!reducedMotion&&<div className="practice-result-confetti" aria-hidden="true">{Array.from({length:36},(_,i)=><i key={i} style={{left:`${(i*29)%100}%`,background:['#26866a','#e4b85b','#92c9b0','#698ea8'][i%4],animationDelay:`${(i%7)*65}ms`,'--drift':`${((i*37)%160)-80}px`,'--spin':`${i%2?480:-420}deg`} as CSSProperties}/>)}</div>}
    <header className="practice-result-header"><span><CheckCheck size={15}/> {readOnly?'本轮作答回顾':`${session.mode==='exam'?'模拟考试':'本轮练习'}已完成`}</span><span><Check size={14}/> {readOnly?'历史快照 · 只读':'作答已保存'}</span></header>
    <div className="practice-result-hero">
      <div className="practice-result-emblem" data-perfect={perfect||undefined} aria-hidden="true">{results.answered?<Trophy size={34} strokeWidth={1.6}/>:<ClipboardCheck size={34} strokeWidth={1.6}/>}<Sparkles className="practice-result-spark" size={17}/></div>
      <h2 ref={heading} tabIndex={-1}>{title}</h2><p>{subtitle}</p>
    </div>
    <dl className="practice-result-metrics">
      <div className="practice-result-score"><dt>{results.pending?'暂定参考得分':'参考得分'}<span>百分制</span></dt><dd aria-label={results.score===null?'参考得分待核对':`${results.score} 分，满分 100 分`}><span aria-hidden="true">{number(results.score)}</span><small>/ 100</small></dd><p>{results.pending?'待核对题确认后更新':'按本轮全部题目等权折算'}</p></div>
      <div><dt>正确率</dt><dd aria-label={results.accuracy===null?'正确率待判定':`正确率 ${results.accuracy}%`}><span aria-hidden="true">{number(results.accuracy)}</span>{results.accuracy!==null&&<small>%</small>}</dd><p>正确 {results.correct} / 已判定 {results.correct+results.wrong} 题</p></div>
      <div><dt>错题数</dt><dd aria-label={`错题 ${results.wrong} 道`}><span aria-hidden="true">{number(results.wrong)}</span><small>题</small></dd><p>{results.wrong?'先理解原因，再练一次':'未答、待核对不算错题'}</p></div>
    </dl>
    <div className="practice-result-body">
      <section className="practice-result-distribution" aria-label="答题分布"><div className="practice-result-section-heading"><h3>这次的答题情况</h3><span>已答 {results.answered} / {results.total} 题</span></div>
        <div className="practice-result-bar" aria-hidden="true">{states.map(state=>state.count>0&&<span key={state.key} data-state={state.key} style={{flex:state.count}}/>)}</div>
        <div className="practice-result-legend">{states.map(state=><button key={state.key} type="button" data-state={state.key} disabled={!state.count||disabled} onClick={()=>onReview(state.ids[0])} aria-label={`查看${state.label}${state.key==='wrong'?'':'题'}，共 ${state.count} 题`}><i/>{state.label} {state.count}<ArrowRight size={12}/></button>)}</div>
        <details className="practice-result-scoring"><summary>分数和正确率怎么算？</summary><p>参考得分 = 正确题数 ÷ 本轮总题数 × 100。目前未设置原卷分值，各题等权；未答题不计分，待核对题暂不计分。正确率仅统计已判定题，不包含未答和待核对。{results.aiJudged>0&&`其中 ${results.aiJudged} 题采用 AI 参考判定。`}{results.selfAssessed>0&&`其中 ${results.selfAssessed} 题采用我的自评。`}这些结果用于辅助复习。</p></details>
      </section>
      <aside className="practice-result-next"><span className="practice-result-next-label"><Sparkles size={14}/> 下一步，学得更扎实</span><h3>{results.wrong?'把错题变成下一次的得分':results.pending?'先核对，再确认掌握':results.unanswered?'给遗漏的题一次认真回顾':'趁热巩固这次的收获'}</h3><p>{results.wrong?`先复盘 ${results.wrong} 道错题，重点看答案、解析和原文出处。`:results.pending?`还有 ${results.pending} 题需要对照参考答案、自评或核对。`:results.unanswered?`有 ${results.unanswered} 题未作答，先看看解题思路。`:'查看解析，确认答对背后的思路；也可以重新练习，检验是否真正掌握。'}</p>{weakTopics.length>0&&<div className="practice-result-topics">{weakTopics.map(topic=><span key={topic}>{topic}</span>)}</div>}<Button variant="primary" disabled={disabled} onClick={()=>onReview(reviewIds[0])}>{reviewIds.length?`${reviewLabel}（${reviewIds.length}）`:reviewLabel}<ArrowRight size={16}/></Button></aside>
    </div>
    <footer className="practice-result-footer"><Button variant="ghost" disabled={disabled} onClick={()=>onReview()}>查看全部解析</Button>{!readOnly&&<div><label>再来一轮<select aria-label="重新练习模式" value={restartMode} disabled={disabled} onChange={event=>onRestartMode(event.target.value as OriginalMode)}><option value="practice">逐题练习</option><option value="memorize">背题 · 直接查看答案</option><option value="exam">模拟考试</option></select></label><Button disabled={disabled} onClick={onRestart}><RotateCcw size={15}/>重新练习并保留历史</Button></div>}</footer>
  </section>;
}
