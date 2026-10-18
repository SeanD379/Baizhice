'use client';
import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, FileSearch, LoaderCircle, RotateCw } from 'lucide-react';
import { Button } from './ui/button';
import { MaterialNote } from './material-note';
import { sourceLocation, extractionLabel } from '@/lib/document-labels';
import type { Material } from '@/lib/types';
import type { Extraction } from '@/lib/extraction-types';
import { groupDocumentPages } from '@/lib/question-bank';
import { Markdown } from './markdown';
import { examReadingGuide, examSectionLabel, type ReadingLandmark } from '@/lib/exam-reading';

export function ExtractedContent({material,initialPage=1,readingMode=false,onComplete,onViewPage}:{material:Material;initialPage?:number;readingMode?:boolean;onComplete:()=>Promise<void>;onViewPage:(page:number)=>void}){
  const guide=examReadingGuide(material);
  const [result,setResult]=useState<Extraction|null>(null),[page,setPage]=useState(initialPage),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [showAllContent,setShowAllContent]=useState(false);
  const [pickedPosition,setPickedPosition]=useState(false);
  useEffect(()=>setPage(initialPage),[initialPage]);
  const url=`/api/materials/${material.id}/extraction`;
  useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;async function refresh(){try{const response=await fetch(url,{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error);if(active){setResult(data.result);setBusy(data.running);if(data.running)timer=setTimeout(refresh,1500);}}catch(e){if(active)setError(e instanceof Error?e.message:'识别记录暂时不可用。');}finally{if(active)setLoading(false);}}void refresh();return()=>{active=false;clearTimeout(timer);};},[url]);
  async function extract(continuing=false){setBusy(true);setError('');try{const response=await fetch(url,{method:'POST',...(continuing?{headers:{'Content-Type':'application/json'},body:JSON.stringify({continue:true})}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error);setResult(data.result);if(!continuing)setPage(1);await onComplete();}catch(e){setError(e instanceof Error?e.message:'识别失败，请重试。');}finally{setBusy(false);}}
  const selected=result?.pages.find(p=>p.page===page);
  const grouped=/\.(docx|txt)$/i.test(material.name),groups=result?groupDocumentPages(result.pages):[];
  const chosenGroup=(page===1&&!pickedPosition?groups.find(group=>group.kind==='question'):groups.find(group=>group.pages.some(part=>part.page===page)))??groups[0];
  function jumpTo(item:ReadingLandmark){setPage(item.page);setShowAllContent(true);setTimeout(()=>{
    const section=document.getElementById(`extracted-page-${material.id}-${item.page}`) as HTMLDetailsElement|null;
    if(section)section.open=true;
    section?.scrollIntoView({block:'start'});
    const part=result?.pages.find(value=>value.page===item.page);
    const offset=item.marker?.exec(part?.text||'')?.index;
    const text=section?.querySelector('pre')?.firstChild;
    if(offset===undefined||!text||text.nodeType!==Node.TEXT_NODE)return;
    const range=document.createRange();range.setStart(text,offset);range.setEnd(text,offset+1);
    section?.closest(readingMode?'.inspector-content':'.inspector')?.scrollBy({top:range.getBoundingClientRect().top-86});
  },0);}
  function download(){if(!result)return;const text=result.pages.map(p=>`${sourceLocation(material.name,p.page)} · ${extractionLabel(p.method)}\n${p.warnings.join('\n')}\n\n${p.text||'此页未提取出文字。'}`).join('\n\n——\n\n');const href=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=href;a.download=`${material.name}-识别文字.txt`;a.click();URL.revokeObjectURL(href);}
  const introduction=<>
    <header><h3><FileSearch size={17}/>{guide?'试卷文字与题目':'提取资料文字'}</h3><span>仅在本机处理</span></header>
    <p>{guide?guide.intro:material.mime==='application/pdf'?'把 PDF 内容转换成可搜索、可引用的文字，后续才能用于生成复习材料和练习。扫描页会尝试本机 OCR；公式和图表请对照原文。':material.mime.startsWith('image/')?'把图片内容转换成可搜索、可引用的文字，后续才能用于生成复习材料和练习。清晰印刷体识别更准确；手写、公式和图表请对照原图。':'把文档内容按原顺序转换成可搜索、可引用的文字，后续才能用于生成复习材料和练习。排版、图示和复杂公式请对照原文件。'}</p>
    <div className="extraction-actions"><Button size="sm" onClick={()=>void extract()} disabled={loading||busy}>{busy?<LoaderCircle size={15} className="spin"/>:result?<RotateCw size={15}/>:<FileSearch size={15}/>} {busy?'正在识别，请稍候':result?'重新提取文字':'提取文字'}</Button>{result&&<Button size="sm" variant="ghost" onClick={download}><ArrowDownToLine size={14}/>导出文字</Button>}</div>
    {loading&&<p role="status">正在读取识别记录…</p>}{busy&&<p role="status">可继续查看原文。结果保存后可重新打开此资料查看。</p>}
  </>;
  const warnings=<>{error&&<p className="extraction-error" role="alert">{error}</p>}{result&&<>
      {result.state==='partial'&&<p className="extraction-warning" role="status">提取不完整：存在空白、未识别内容或超出处理限制。请查看各位置提示，必要时拆分文件重试。</p>}
      {result.continuation?.hasMore&&<div className="extraction-warning" role="status"><p>尚未处理：{sourceLocation(material.name,result.continuation.nextSource??result.pages.at(-1)!.page+1)}至{sourceLocation(material.name,result.sourceCount??result.pageCount)}。已提取内容与原文位置保留。</p><Button size="sm" disabled={busy} onClick={()=>void extract(true)}>继续处理剩余内容</Button></div>}
      {result.continuation?.blockedSource&&<p className="extraction-warning">{sourceLocation(material.name,result.continuation.blockedSource)}超过处理限制，保留原文件供核对，未截取其中的半道题。</p>}
    </>}</>;
  const summary=result&&<>
    <div className="extraction-summary"><span>{result.pages.filter(p=>p.state==='extracted').length} 处含文字 · 已处理 {result.pages.length} / {result.sourceCount??result.pageCount} 处原文</span><span>处理用时 {(result.durationMs/1000).toFixed(1)} 秒</span></div>
    {guide&&<nav className="exam-reading-landmarks" aria-label="跳转到原文、题目和答案">{guide.landmarks.slice(0,showAllContent?undefined:6).map(item=><button key={item.label} type="button" onClick={()=>jumpTo(item)}>{item.label}<small>第 {item.page} 页</small></button>)}{(!readingMode||guide.landmarks.length>6)&&<button className="exam-reading-more" type="button" aria-expanded={showAllContent} onClick={()=>setShowAllContent(value=>!value)}>{readingMode?showAllContent?'收起其余阅读入口':'展开其余阅读入口':showAllContent?'收起其余入口和页码':guide.landmarks.length>6?`展开其余 ${guide.landmarks.length-6} 个入口及 ${result.pageCount} 页内容`:`展开 ${result.pageCount} 页内容`}</button>}</nav>}
  </>;
  function renderGroup(group:typeof groups[number]){return <div className="extraction-group" key={group.id}>{readingMode&&<h3>{group.title}</h3>}<p className="muted small">{sourceLocation(material.name,group.pages[0].page)}至{sourceLocation(material.name,group.pages.at(-1)!.page)} · {group.kind==='question'?'完整题目':'连续内容'}</p><Markdown text={group.text}/><details><summary>原文位置与逐段摘录</summary>{group.pages.map(part=><div key={part.page}><p>{sourceLocation(material.name,part.page)}</p>{!!part.warnings.length&&<p className="extraction-warning">{part.warnings.join(' ')}</p>}<MaterialNote material={material} page={part.page} text={part.text}/></div>)}</details><Button size="sm" variant="ghost" onClick={()=>onViewPage(group.pages[0].page)}>打开原文件核对<ArrowRight size={14}/></Button></div>;}
  const content=result&&(guide ? (readingMode||showAllContent)&&<div className="exam-reading-pages" id={`extracted-pages-${material.id}`}>{result.pages.map(part=><details className="exam-reading-page" id={`extracted-page-${material.id}-${part.page}`} key={part.page} open={readingMode&&(part.page===selected?.page||(!selected&&part===result.pages[0]))}><summary><span>第 {part.page} 页{examSectionLabel(material.name,part.page)&&` · ${examSectionLabel(material.name,part.page)}`}</span><small>展开文字</small></summary>{part.warnings.length>0&&<p className="extraction-warning">{part.warnings.join(' ')}</p>}<MaterialNote material={material} page={part.page} text={part.text}/><Button size="sm" variant="ghost" onClick={()=>onViewPage(part.page)}>对照原卷第 {part.page} 页<ArrowRight size={14}/></Button></details>)}</div> : <>
    {!(readingMode&&grouped)&&<label className="extraction-page">{grouped?'查看完整内容':'查看位置'}<select aria-label="识别结果页码" value={grouped?chosenGroup?.pages[0].page??page:page} onChange={e=>{setPickedPosition(true);setPage(Number(e.target.value));}}>{grouped?groups.map(group=><option key={group.id} value={group.pages[0].page}>{group.title}</option>):result.pages.map(part=><option key={part.page} value={part.page}>{sourceLocation(material.name,part.page)}{part.state!=='extracted'?' · 待处理':''}</option>)}</select></label>}
    {grouped&&chosenGroup?readingMode?groups.map(renderGroup):renderGroup(chosenGroup):selected&&<>{!!selected.warnings.length&&<p className="extraction-warning">{selected.warnings.join(' ')}</p>}{selected.confidence!==undefined&&<p className="extraction-confidence">识别器信心值 {Math.round(selected.confidence)} / 100，不代表内容正确率。</p>}<MaterialNote key={selected.page} material={material} page={selected.page} text={selected.text}/><Button size="sm" variant="ghost" onClick={()=>onViewPage(selected.page)}>对照{sourceLocation(material.name,selected.page)}原文<ArrowRight size={14}/></Button></>}
  </>);
  const footnote=result&&<p className="extraction-footnote">文字提取完成不等于内容已核验。可在复习材料中核对、修订并主动选择发送给 AI 助手；不会自动发送或出题。</p>;
  return <section className={`extracted-content${readingMode?' extracted-content-reading':''}`} aria-label={readingMode?'资料文字正文':'提取资料文字'}>{readingMode?<>{warnings}<div className="extraction-reading-body">{content}</div><details className="extraction-reading-tools" open={!result}><summary>文字提取与原文位置</summary>{introduction}{summary}{footnote}</details></>:<>{introduction}{warnings}{summary}{content}{footnote}</>}</section>;
}
