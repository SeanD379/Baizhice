'use client';
import { useEffect, useState } from 'react';
import { BookOpen, ListChecks, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Markdown } from './markdown';
import { PracticeWorkspace } from './practice-workspace';
import { PracticeHistory } from './practice-history';
import { sourceLocation } from '@/lib/document-labels';
import type { PracticeData } from '@/lib/practice-store';
import type { Material, Reference, Version } from '@/lib/types';

export function PracticePanel({courseId,materials,version,onRead,onSource,generationOnly=false,registerLeave,expectedScope,expectedSetId}:{courseId:string;materials:Material[];version?:Version;onRead:()=>void;onSource:(ref:Reference)=>void;generationOnly?:boolean;expectedScope?:string;expectedSetId?:string;registerLeave?:(flush:(()=>Promise<boolean>)|null)=>void}) {
  const [data,setData]=useState<PracticeData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<string[]>([]);
  const sourceKey=materials.map(m=>`${m.id}:${m.excluded}:${m.status}`).join(',');
  useEffect(()=>{
    let active=true;setData(null);setError('');setSelected([]);
    if(version)void fetch(`/api/practice?courseId=${encodeURIComponent(courseId)}&versionId=${encodeURIComponent(version.id)}`,{cache:'no-store'}).then(async r=>{const result=await r.json();if(!r.ok)throw new Error(result.error);if(expectedScope&&result.scope!==expectedScope||expectedSetId&&result.set?.id!==expectedSetId)throw Error('题组或来源已更新，旧答案保留在练习记录中；请重新选择当前题组。');if(active)setData(result);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[courseId,version?.id,sourceKey,expectedScope,expectedSetId]);
  async function action(body:object){
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/practice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,courseId,versionId:version?.id})});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      const refresh=await fetch(`/api/practice?courseId=${encodeURIComponent(courseId)}&versionId=${encodeURIComponent(version!.id)}`,{cache:'no-store'});
      const next=await refresh.json();if(!refresh.ok)throw new Error(next.error);setData(next);
    }catch(e){setError(e instanceof Error?e.message:'操作失败，请重试。');}finally{setBusy(false);}
  }
  if(!version)return <div className="practice-page"><div className="empty-state"><h2>先准备复习材料</h2><p>从上方选择资料，核对文字、知识点及出处后，就可以生成练习。</p><Button onClick={onRead}>查看复习材料</Button></div></div>;
  return <div className="practice-page">
    {error&&<p className="modal-error" role="alert">{error}</p>}
    {!data&&!error&&<p role="status">正在读取本机练习记录…</p>}
    {generationOnly&&data?.session?.mode==='exam'&&!data.session.submitted&&<p role="status">这组题仍在考试中，请先交卷，再生成或核对答案与解析。</p>}
    {data&&<>
      <>{!generationOnly&&<PracticeWorkspace key={data.scope} courseId={courseId} version={version} data={data} onRead={onRead} onSource={onSource} registerLeave={registerLeave}/>}</>
      {(generationOnly||data.configured||!!data.set)&&!(data.session?.mode==='exam'&&!data.session.submitted)&&<details className="home-card practice-generation" open={generationOnly||!!data.set&&!data.set.reviewed&&!data.set.stale}><summary><ListChecks size={17}/>从已核对知识点出题</summary><div className="practice-generation-content">
        <p>{data.configured?'将你选择的知识点正文及引用摘录发送给 AI 助手，生成最多 5 道自编练习。题目和答案需核对后使用。':'AI 出题暂未启用。可以先核对复习材料，或使用下方已有练习；无需现在配置 API。'}</p>
        {!data.eligibleSections.length&&<p className="muted small">还没有可用于真实出题的已核对知识点。请先在复习材料中核对生成内容及引用。</p>}
        <div className="topic-options">{data.eligibleSections.map(s=><label key={s.id}><input type="checkbox" disabled={busy} checked={selected.includes(s.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id))}/>{s.title}</label>)}</div>
        <Button disabled={busy||!data.configured||!selected.length} onClick={()=>void action({action:'generate',sectionIds:selected,confirmed:true})}>{busy?<LoaderCircle className="spin" size={15}/>:<ListChecks size={15}/>}生成一组待核对练习</Button>
        {data.set?.stale&&<p className="modal-error">这组题的来源已变化，已暂停练习。请核对新材料后重新出题，原记录仍保留。</p>}
        {data.set&&!data.set.reviewed&&!data.set.stale&&<div className="practice-review"><h3>先核对题目、答案和出处</h3><p className="muted small">AI 助手生成。引用匹配不等于题目或答案正确。</p>{data.set.questions.map(q=><section key={q.id} className="generation-page"><h3>{q.prompt}</h3>{!!q.options?.length&&<ol>{q.options!.map(o=><li key={o}>{o}</li>)}</ol>}<b>参考答案</b><Markdown text={q.answer}/><p>{q.explanation}</p>{!!q.criteria?.length&&<ul>{q.criteria!.map(c=><li key={c}>{c}</li>)}</ul>}<Button variant="ghost" onClick={()=>onSource(q.reference)}><BookOpen size={14}/>{q.reference.name} · {sourceLocation(q.reference.name,q.reference.page)}</Button><blockquote>{q.reference.snippet}</blockquote></section>)}<Button variant="primary" disabled={busy} onClick={()=>void action({action:'review',setId:data.set!.id})}>我已核对题目与答案，启用练习</Button></div>}
      </div></details>}
    </>}
    {!generationOnly&&<PracticeHistory key={courseId} courseId={courseId}/>}
  </div>;
}
