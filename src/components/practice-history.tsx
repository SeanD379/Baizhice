'use client';
import { useState } from 'react';
import { Button } from './ui/button';
import { Markdown } from './markdown';
import { sourceLocation } from '@/lib/document-labels';
import type { PracticeHistoryData } from '@/lib/practice-history';

export function PracticeHistory({courseId}:{courseId:string}) {
  const [data,setData]=useState<PracticeHistoryData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const url=`/api/practice/history?courseId=${encodeURIComponent(courseId)}`;
  async function load(){
    setBusy(true);setError('');
    try {const response=await fetch(url,{cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error);setData(result);}
    catch(e){setError(e instanceof Error?e.message:'读取历史失败，请重试。');}finally{setBusy(false);}
  }
  return <details className="home-card" onToggle={e=>{if(e.currentTarget.open)void load();}}><summary>历史题组与作答（只读）</summary>
    <p>旧题组不会重新启用，原判定不会重算。引用摘录和复习材料版本可回看，但完整原文件与 OCR 历史未单独保存。</p>
    <Button disabled={busy} onClick={()=>void load()}>刷新历史</Button>{' '}<a href={`${url}&format=markdown`} download>导出 Markdown</a>
    {busy&&<p role="status">正在读取历史…</p>}{error&&<p role="alert">{error}</p>}
    {data&&!data.entries.length&&<p>本课程还没有保存的题组或作答记录。</p>}
    {data?.entries.map(entry=><details className="generation-page" key={entry.id}><summary>材料版本 {entry.version.number} · {entry.model?'AI 助手生成':'历史作答'} · {new Date(entry.session?.updatedAt??entry.createdAt).toLocaleString()}</summary>
      {entry.archived&&<p>已归档轮次 · 开始重练前保存的完整答案</p>}
      {entry.withheld?<p>本版本有未交卷自测，交卷后可回看题目、参考答案与完整历史。</p>:<>
      <p>{entry.reviewed===null?'无独立题组核对记录':entry.reviewed?'题组已核对':'题组未核对'} · {entry.session?entry.session.state.finished?'本组已完成':'草稿或未完成':'尚无保存作答'}</p>
      {entry.snapshot!=='saved'&&<p>{entry.snapshot==='reconstructed'?'演示题由历史材料重建，已与原题目范围哈希匹配。':'原题目快照缺失，以下只展示保存的作答和判定，不套用当前题目。'}</p>}
      {entry.questions.map(q=><section key={q.id}><h3>{q.prompt}</h3>{q.options&&<ul>{q.options.map(o=><li key={o}>{o}</li>)}</ul>}<b>参考答案</b><Markdown text={q.answer}/><Markdown text={q.explanation}/>{q.criteria&&<ul>{q.criteria.map(c=><li key={c}>{c}</li>)}</ul>}<p>{q.reference.name} · {sourceLocation(q.reference.name,q.reference.page)}</p><blockquote>{q.reference.snippet}</blockquote></section>)}
      {entry.session&&<><h3>保存的作答</h3>{Object.entries(entry.session.state.answers).map(([id,answer])=>{const result=entry.session!.state.results[id];return <section key={id}><b>{entry.questions.find(q=>q.id===id)?.prompt??id}</b><Markdown text={answer}/><p>原记录判定：{result?.correct===true?'答对 / 自评掌握':result?.correct===false?'需要巩固':result?'待自评':'未提交'}</p></section>;})}<h3>保留的尝试记录</h3><ul>{entry.session.state.attempts.map((a,i)=><li key={i}>{a.at} · {entry.questions.find(q=>q.id===a.id)?.topic??a.id} · {a.correct?'答对 / 自评掌握':'需要巩固'}</li>)}</ul></>}
      <details><summary>当时的复习材料 · 版本 {entry.version.number}</summary>{entry.version.sections.map(s=><section key={s.id}><h3>{s.title}</h3><Markdown text={s.body}/>{s.refs.map((r,i)=><blockquote key={i}>{r.name} · {sourceLocation(r.name,r.page)}：{r.snippet}</blockquote>)}</section>)}</details>
    </>}</details>)}
  </details>;
}
