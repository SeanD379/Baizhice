'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, FileText, LoaderCircle } from 'lucide-react';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { Markdown } from './markdown';
import type { GenerationPreview, GenerationSources, SourcePage } from '@/lib/generation';
import { sourceLocation, extractionLabel, originalLinkLabel } from '@/lib/document-labels';
import { examSectionLabel } from '@/lib/exam-reading';
import { groupDocumentPages } from '@/lib/question-bank';
import type { NotebookStore } from './use-notebook';

type PendingPreview={id:string;createdAt:string;model:string;sectionCount:number};

const pageKey=(page:SourcePage)=>`${page.materialId}:${page.page}`;
async function request<T>(url:string,body?:unknown):Promise<T> {
  const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data=await response.json().catch(()=>({error:'服务暂时不可用，请保留页面并重试。'}));
  if(!response.ok)throw new Error(data.error||'操作失败，请重试。');return data;
}
export function GenerationDialog({courseId,expectedVersionId,materialIds,notebook,onClose,onSaved}:{courseId:string;expectedVersionId:string|null;materialIds?:string[]|null;notebook?:NotebookStore;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [targets,setTargets]=useState<Record<string,string>>({}),[chapterTitles,setChapterTitles]=useState<Record<string,string>>({});
  const [sources,setSources]=useState<GenerationSources|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<Record<string,boolean>>({}),[edits,setEdits]=useState<Record<string,string>>({}),[confirmed,setConfirmed]=useState(false);
  const [preview,setPreview]=useState<GenerationPreview|null>(null),[chosen,setChosen]=useState<string[]>([]);
  const [pending,setPending]=useState<PendingPreview[]>([]),[reviewedPages,setReviewedPages]=useState<SourcePage[]>([]);
  const recoveryUrl=`/api/generation?courseId=${encodeURIComponent(courseId)}&expectedVersionId=${encodeURIComponent(expectedVersionId??'')}`;
  useEffect(()=>{let active=true;void request<{previews:PendingPreview[]}>(`${recoveryUrl}&action=list`).then(data=>{if(active)setPending(data.previews);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[recoveryUrl]);
  useEffect(()=>{let active=true;void request<GenerationSources>(`/api/generation?courseId=${encodeURIComponent(courseId)}`).then(data=>{if(active)setSources(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[courseId]);
  const visiblePages=(sources?.pages??[]).filter(page=>!materialIds||materialIds.includes(page.materialId));
  const visibleNames=new Set(visiblePages.map(page=>page.name));
  const unavailable=(sources?.unavailable??[]).filter(message=>!materialIds||[...visibleNames].some(name=>message.startsWith(`${name}：`)||message.startsWith(`${name} 第`)));
  const pages=visiblePages.filter(p=>selected[pageKey(p)]).map(p=>({...p,text:edits[pageKey(p)]??p.text}));
  const sourceGroups=visiblePages.reduce<SourcePage[][]>((groups,p)=>{const group=groups.find(items=>items[0].materialId===p.materialId);if(group)group.push(p);else groups.push([p]);return groups;},[]);
  const count=pages.reduce((sum,p)=>sum+p.text.trim().length,0);
  const invalid=!pages.length||count>40000||pages.some(p=>!p.text.trim());
  const suggestedChapter=(sectionId:string)=>{
    const section=preview?.sections.find(section=>section.id===sectionId);
    const similar=notebook?.data?.document.pages.find(page=>page.title===section?.title);
    const chapter=notebook?.data?.document.chapters.find(chapter=>chapter.id===similar?.chapterId)?.title;
    return chapter??sources?.pages.find(page=>section?.refs.some(ref=>ref.materialId===page.materialId)&&page.chapter&&!['未分类','历年套卷'].includes(page.chapter))?.chapter??'';
  };
  const generateBlocker=!sources?.configured?'当前未配置 AI 助手，配置后重启服务才能生成。':!pages.length?'请先选择需要整理的完整内容。':invalid?'所选文字超出本次范围，请减少选择。':!confirmed?'请先核对所选文字，并勾选发送确认。':'';
  async function generate(){
    setBusy(true);setError('');
    try {const result=await request<GenerationPreview>('/api/generation',{action:'preview',courseId,expectedVersionId,pages,confirmed});setPreview(result);setReviewedPages(pages);setChosen([]);setPending(v=>[{id:result.id,createdAt:result.createdAt,model:result.model,sectionCount:result.sections.length},...v]);}
    catch(e){setError(e instanceof Error?e.message:'生成失败，请重试。');}finally{setBusy(false);}
  }
  async function recover(id:string){
    setBusy(true);setError('');
    try {
      const result=await request<GenerationPreview&{pages:SourcePage[]}>(`${recoveryUrl}&action=restore&draftId=${encodeURIComponent(id)}`);
      setPreview(result);setReviewedPages(result.pages);setChosen([]);setConfirmed(false);
      setSelected(Object.fromEntries(result.pages.map(p=>[pageKey(p),true])));
      setEdits(Object.fromEntries(result.pages.map(p=>[pageKey(p),p.text])));
    } catch(e){setError(e instanceof Error?e.message:'恢复失败，请重新打开窗口。');}finally{setBusy(false);}
  }
  async function adopt(){
    if(!preview)return;setBusy(true);setError('');
    try {
      if(notebook&&!await notebook.flush('采用草稿前保存'))throw new Error('请先完成笔记同步，再采用草稿。');
      await request('/api/generation',{action:'adopt',courseId,expectedVersionId,draftId:preview.id,chosenIds:chosen,notebookRevision:notebook?.getCurrent()?.revision,targets:chosen.map(sectionId=>({sectionId,...(targets[sectionId]&&targets[sectionId]!=='new'?{pageId:targets[sectionId]}:{chapterTitle:(chapterTitles[sectionId]??suggestedChapter(sectionId)).trim()||undefined})}))});await onSaved();
    }
    catch(e){setError(e instanceof Error?e.message:'保存失败，请重试。');}finally{setBusy(false);}
  }
  return <Modal open onOpenChange={open=>{if(!open&&!busy)onClose();}} title={preview?'核对并采用复习内容':'从真实资料整理复习材料'} description={preview?'逐段查看内容与出处，勾选后保存为新版本。':'选择原页并核对识别文字，再发送给 AI 助手 整理。'} error={error} wide>
    <div className="generation-dialog">
    {!sources&&!error&&<p role="status">正在读取本课程的识别结果…</p>}
    {sources&&!preview&&<>
      {pending.length>0&&<section className="generation-page"><h3>待采用的生成预览</h3><p>恢复学习空间保存的候选和当时核对的文字，不会再次调用 AI 助手。资料或版本变化后的预览不可恢复。</p>{pending.map(draft=><div key={draft.id}><span>{new Date(draft.createdAt).toLocaleString()} · {draft.sectionCount} 段候选 </span><Button disabled={busy} onClick={()=>void recover(draft.id)}>恢复预览</Button></div>)}</section>}
      <p className="generation-notice">{sources.configured?'AI 助手 已配置。只发送所选内容的核对后文字与来源标识，可能产生 API 费用；不发送文件原件。':'尚未配置 AI 助手，暂不能生成。你仍可以查看与核对下方文字。'}<br/>按完整题目或连续内容选择，本次最多 40000 字。修订只用于本次生成，原文件与原识别记录保留。</p>
      {!sources.configured&&<details className="generation-setup"><summary>本机配置方法</summary><p>请联系管理员检查 AI 助手服务配置。请勿把服务密钥填入课程正文或聊天。</p></details>}
      {unavailable.length>0&&<details className="generation-setup"><summary>{unavailable.length} 项暂不可用于整理</summary><ul>{unavailable.map((text,i)=><li key={i}>{text}</li>)}</ul></details>}
      {!visiblePages.length&&<p>所选资料还没有可核对的文字。请关闭窗口，在「我的资料」中打开文件并提取文字。</p>}
      <div className="generation-pages">{sourceGroups.map(group=><details className="generation-material" open key={group[0].materialId}><summary><span>{group[0].name}</span><small>已选 {group.filter(p=>selected[pageKey(p)]).length} 处原文 · 按完整内容核对</small></summary><div className="generation-material-body"><div className="generation-material-actions"><button type="button" disabled={busy} onClick={()=>{setSelected(v=>({...v,...Object.fromEntries(group.map(p=>[pageKey(p),true]))}));setConfirmed(false);}}>选择整份</button><button type="button" disabled={busy} onClick={()=>{setSelected(v=>({...v,...Object.fromEntries(group.map(p=>[pageKey(p),false]))}));setConfirmed(false);}}>清空本份</button></div>{groupDocumentPages(group).map(block=>{
        const heading=block.kind==='content'&&block.pages.length===1&&block.text.trim().length<85&&/^(?:[一二三四五六七八九十\d]+[、.．]\s*)?(?:单选|单项选择|多选|多项选择|判断题|填空题|名词解释|简答题|计算题|写作)/.test(block.text.trim());
        if(heading)return <h4 className="generation-section-heading" key={block.id}>{block.text}</h4>;
        const first=block.pages[0],last=block.pages.at(-1)!,checked=block.pages.every(p=>selected[pageKey(p)]),section=examSectionLabel(first.name,first.page);
        return <section className="generation-page generation-content-block" key={block.id}>
          <label className="generation-choice"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>{const value=e.target.checked;setSelected(v=>({...v,...Object.fromEntries(block.pages.map(p=>[pageKey(p),value]))}));setConfirmed(false);}}/><span>{block.title}{section&&` · ${section}`}</span></label>
          <div className="generation-content-preview"><Markdown text={block.pages.map(p=>edits[pageKey(p)]??p.text).join('\n\n')}/></div>
          <p className="muted small">原文位置：{sourceLocation(first.name,first.page)}{last.page!==first.page&&` 至 ${sourceLocation(last.name,last.page)}`}</p>
          {checked&&<details className="generation-content-edit"><summary>核对原文与修订文字</summary><p className="muted small">{[...new Set(block.pages.flatMap(p=>p.warnings))].join(' ')}</p>{block.pages.map(p=><label className="generation-text-label" key={pageKey(p)}>{sourceLocation(p.name,p.page)}<a href={`/api/files/${p.materialId}${/\.(docx|pptx|txt)$/i.test(p.name)?'':`#page=${p.page}`}`} target="_blank" rel="noreferrer">{originalLinkLabel(p.name,p.page)}</a><textarea aria-label={`${p.name} ${sourceLocation(p.name,p.page)}核对文字`} value={edits[pageKey(p)]??p.text} disabled={busy} maxLength={40000} onChange={e=>{setEdits(v=>({...v,[pageKey(p)]:e.target.value}));setConfirmed(false);}}/></label>)}</details>}
        </section>;
      })}</div></details>)}</div>
      <div className="generation-total">已选 {pages.length} 处原文 · {count} / 40000 字{count>40000&&<p role="alert">超出本次范围，请减少完整内容的选择，不会自动截断。</p>}</div>
      <label className="generation-choice generation-consent"><input type="checkbox" checked={confirmed} disabled={busy||invalid} onChange={e=>setConfirmed(e.target.checked)}/><span>我已核对所选文字中的公式和数字，同意发送给 AI 助手 生成复习材料。</span></label>
      {generateBlocker&&<p className="generation-blocker" id="generation-blocker" role="status">{generateBlocker}{!sources.configured&&<button type="button" onClick={()=>{const details=document.querySelector<HTMLDetailsElement>('.generation-dialog .generation-setup');if(details){details.open=true;details.scrollIntoView({block:'start'});}}}>查看配置方法</button>}</p>}
      <div className="modal-footer"><Button onClick={onClose} disabled={busy}>返回</Button><Button variant="primary" aria-describedby={generateBlocker?'generation-blocker':undefined} disabled={busy||!!generateBlocker} onClick={()=>void generate()}>{busy?<LoaderCircle size={16} className="spin"/>:<FileText size={16}/>}生成待核对内容</Button></div>
    </>}
    {preview&&<>
      <details className="generation-setup"><summary>查看本次生成使用的核对文字（{reviewedPages.length} 项）</summary>{reviewedPages.map(p=><section key={pageKey(p)}><b>{p.name} · {sourceLocation(p.name,p.page)}</b><p>{extractionLabel(p.method)}</p><pre style={{whiteSpace:'pre-wrap'}}>{p.text}</pre></section>)}</details>
      <p className="generation-notice">AI 助手 · {preview.sections.length} 段候选<br/>已核验引用摘录存在于所选文字中，尚未核验结论正确性。请核对公式、前提和是否与已有内容重复。</p>
      {preview.warnings.length>0&&<div className="generation-warnings"><b>覆盖不足与待核对事项</b><ul>{preview.warnings.map((text,i)=><li key={i}>{text}</li>)}</ul></div>}
      {!preview.sections.length&&<p>本次没有可采用的新内容。请查看上方提示，补充或调整资料范围后再生成。</p>}
      {preview.sections.map(s=><section className="generation-page" key={s.id}><label className="generation-choice"><input type="checkbox" disabled={busy} checked={chosen.includes(s.id)} onChange={e=>setChosen(v=>e.target.checked?[...v,s.id]:v.filter(id=>id!==s.id))}/><b>{s.title}</b></label><Markdown text={s.body}/>{s.refs.map((ref,i)=><div className="generation-reference" key={i}><a href={`/api/files/${ref.materialId}#page=${ref.page}`} target="_blank" rel="noreferrer">{ref.name} · {sourceLocation(ref.name,ref.page)}</a><blockquote>{ref.snippet}</blockquote><small>摘录自本次核对后的文字；如曾修订，请同时对照原文件。</small></div>)}</section>)}

    </>}
    {preview&&notebook&&<section className="generation-page"><h3>归入我的活页笔记</h3><p>选择追加位置或建立新知识点。现有正文与个人补充会保留。</p>{preview.sections.filter(section=>chosen.includes(section.id)).map(section=>{
      const similar=notebook.data?.document.pages.find(page=>page.title.includes(section.title)||section.title.includes(page.title));
      return <div key={section.id}><label className="notebook-form-label">{section.title}<select value={targets[section.id]??'new'} onChange={event=>setTargets(value=>({...value,[section.id]:event.target.value}))}><option value="new">新建知识点</option>{notebook.data?.document.pages.map(page=><option key={page.id} value={page.id}>追加到：{page.title}</option>)}</select></label>{similar&&!targets[section.id]&&<Button variant="ghost" size="sm" onClick={()=>setTargets(value=>({...value,[section.id]:similar.id}))}>相似知识点：{similar.title} · 选择追加</Button>}{(!targets[section.id]||targets[section.id]==='new')&&<label className="notebook-form-label">章节名称（采用前可调整）<input list="notebook-chapter-suggestions" placeholder="未分类" maxLength={80} value={chapterTitles[section.id]??suggestedChapter(section.id)} onChange={event=>setChapterTitles(value=>({...value,[section.id]:event.target.value}))}/></label>}</div>;
    })}<datalist id="notebook-chapter-suggestions">{notebook.data?.document.chapters.map(chapter=><option key={chapter.id} value={chapter.title}/>)}</datalist></section>}
    {preview&&<div className="modal-footer"><Button disabled={busy} onClick={()=>{setPreview(null);setConfirmed(false);}}>调整范围</Button><span className="muted small">已选 {chosen.length} 段 · 原有内容保留</span><Button variant="primary" disabled={busy||!chosen.length} onClick={()=>void adopt()}>{busy?<LoaderCircle size={16} className="spin"/>:<ArrowRight size={16}/>}采用所选内容</Button></div>}
    {busy&&<p role="status">正在处理，请保留页面…</p>}
    </div>
  </Modal>;
}
