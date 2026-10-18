'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { CaptureButton } from './notebook-context';
import { sourceLocation } from '@/lib/document-labels';
import type { AnswerFeedbackResult } from '@/lib/practice-feedback';

export type AnswerFeedbackProps={courseId:string;versionId:string;setId:string|null;questionId:string;answer:string;configured?:boolean;isSaved?:boolean};

export function AnswerFeedback(props:AnswerFeedbackProps) {
  return <FeedbackForm key={JSON.stringify([props.courseId,props.versionId,props.setId,props.questionId,props.answer])} {...props}/>;
}

function FeedbackForm({configured,isSaved=true,...input}:AnswerFeedbackProps) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<AnswerFeedbackResult|null>(null);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function generate() {
    if(request.current||!isSaved)return;
    const controller=new AbortController();request.current=controller;setBusy(true);setError('');setResult(null);
    try {
      const response=await fetch('/api/practice/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,confirmed:true}),signal:controller.signal});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'反馈暂不可用，请稍后重试。');
      if(!controller.signal.aborted)setResult(data);
    } catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'反馈请求失败，请重试。');}
    finally{if(!controller.signal.aborted){request.current=null;setBusy(false);}}
  }
  return <section className="home-card" aria-label="AI 答案反馈">
    <h3>AI 答案反馈（不评分）</h3>
    <p>点击下方按钮，即同意将本题已保存的答案、题目、参考答案、自评要点和引用摘录发送给 AI 助手。反馈仅供参考，不会修改自评或练习记录。</p>
    {configured===false?<p role="status">AI 答案反馈尚未启用。你仍可查看参考答案并自行评价，无需现在配置 API。</p>:<Button disabled={busy||!isSaved||!input.answer.trim()} onClick={()=>void generate()}>{busy?'正在生成反馈…':'同意发送并获取 AI 反馈'}</Button>}
    {!isSaved&&<p role="status">答案保存成功后可请求 AI 反馈。</p>}
    <p className="muted small">请先提交答案并等待保存完成。引用匹配不保证反馈正确，请结合原文核对。</p>
    <p className="muted small">反馈仅在本次页面中展示，不会保存；刷新页面或切换答案后需重新请求。</p>
    {error&&<p role="alert">{error}</p>}
    <div aria-live="polite" aria-busy={busy}>{result&&<>
      {(['strengths','omissions','suggestions'] as const).map(key=><section key={key}><h4>{{strengths:'已体现的要点',omissions:'可能遗漏',suggestions:'改进建议'}[key]}</h4>{result.feedback[key].length?<ul>{result.feedback[key].map((entry,i)=><li key={i}><p>{entry.text}</p><blockquote>{entry.evidence}</blockquote></li>)}</ul>:<p>暂无有充分依据的反馈。</p>}</section>)}
      <h4>不确定性与核对提醒</h4><ul>{result.feedback.uncertainty.map((text,i)=><li key={i}>{text}</li>)}</ul>
      <CaptureButton title="练习反馈与反思" body={['我的作答：'+input.answer,...(['strengths','omissions','suggestions'] as const).map(key=>result.feedback[key].map(entry=>entry.text+'\n> '+entry.evidence).join('\n')),result.feedback.uncertainty.join('\n')].join('\n\n')} origin={{kind:'practice',label:'AI 练习反馈',questionId:input.questionId,refs:[result.reference],needsReview:true}}/>
      <p>来源：{result.reference.name} · {sourceLocation(result.reference.name,result.reference.page)}</p><blockquote>{result.reference.snippet}</blockquote><p className="muted small">摘录可能来自校正后的文字，请同时对照原文件。AI 助手生成</p>
    </>}</div>
  </section>;
}
