'use client';
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Share2, LoaderCircle, ListChecks, FileText } from 'lucide-react';
import { QuestionShare } from './question-share';
import type { Material, Reference } from '@/lib/types';
import type { OriginalKind, OriginalMode, OriginalQuestion, OriginalSessionData, QuestionBankData } from '@/lib/question-bank-types';
import { originalKindNames } from '@/lib/question-bank-types';
import { gradeOriginal, groupDocumentPages } from '@/lib/question-bank';
import type { Extraction } from '@/lib/extraction-types';
import { sourceLocation, referenceLocation } from '@/lib/document-labels';
import { originalRequest, useOriginalSession } from './use-original-session';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { Markdown } from './markdown';
import { RichAnswerEditor } from './rich-answer-editor';
import { QuestionStudyControls, usePracticeStudy } from './practice-study-context';
import { OriginalPracticeResults } from './original-practice-results';
import type { PracticeBackAction } from '@/lib/practice-hub';
import SpotlightCard from './react-bits/SpotlightCard';

type Props={courseId:string;materials:Material[];context:'knowledge'|'paper';initialMaterialId?:string;listMaterialId?:string;initialQuestion?:string|number;initialScope?:string;management?:boolean;importMistakes?:boolean;defaultOrigin?:'original'|'variant';selectionOnlyOnEntry?:boolean;compactRound?:boolean;onSource?:(ref:Reference)=>void;onStart?:(scope:string)=>void|Promise<void>;registerLeave?:(flush:(()=>Promise<boolean>)|null)=>void;registerBackAction?:(action:PracticeBackAction|null)=>void};
const provenance={original:'原文',supplement:'补充',manual:'我的修订',ai:'AI 参考答案',none:'待核对',self:'我的自评'};
async function bankRequest(method:string,body?:object,courseId?:string) {
  const response=await fetch(`/api/question-banks${method==='GET'?`?courseId=${encodeURIComponent(courseId??'')}`:''}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'原题读取失败，请重试。');return result as {banks?:QuestionBankData[];bank?:QuestionBankData;configured:boolean;model:string};
}
export function OriginalPracticeCenter({courseId,materials,context,initialMaterialId,listMaterialId,initialQuestion,initialScope,management=false,importMistakes=false,defaultOrigin,selectionOnlyOnEntry=false,compactRound=false,onSource,onStart,registerLeave,registerBackAction}:Props) {
  const selectionEntry=selectionOnlyOnEntry&&!initialScope&&!initialMaterialId&&initialQuestion===undefined;
  const eligible=materials.filter(m=>!m.excluded&&!['review','conflict'].includes(m.status)&&!m.conflictResolution);
  const [banks,setBanks]=useState<QuestionBankData[]>([]),[configured,setConfigured]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<string[]>(()=>(initialMaterialId??listMaterialId)&&eligible.some(m=>m.id===(initialMaterialId??listMaterialId))?[initialMaterialId??listMaterialId!]:context==='paper'?[eligible[0]?.id].filter(Boolean):eligible.map(m=>m.id));
  const [topic,setTopic]=useState('all'),[kind,setKind]=useState('all'),[origin,setOrigin]=useState<string>(defaultOrigin??'original'),[mode,setMode]=useState<OriginalMode>(context==='paper'?'exam':'practice');
  const [chosenIds,setChosenIds]=useState<string[]|null>(null);
  const [answerFiles,setAnswerFiles]=useState<Record<string,string>>({});
  const selectedKey=selected.join(',');
  useEffect(()=>{setChosenIds(null);},[topic,kind,origin,selectedKey]);
  const [protectedMaterials,setProtectedMaterials]=useState<string[]|null>(null);
  const [active,setActive]=useState<OriginalSessionData|null>(null),[examHidden,setExamHidden]=useState(management||selectionEntry),[consent,setConsent]=useState<{type:'analyze'|'variants';bankId?:string;questionId?:string}|null>(null);
  const [edit,setEdit]=useState<{bank:QuestionBankData;question:OriginalQuestion}|null>(null),[split,setSplit]=useState('');
  const [editText,setEditText]=useState({topics:'',options:''});
  useEffect(()=>{if(management||selectionEntry)setExamHidden(protectedMaterials===null||protectedMaterials.some(id=>selected.includes(id)));},[management,selectionEntry,selectedKey,protectedMaterials]);
  const flush=useRef<()=>Promise<boolean>>(async()=>true);
  const study=usePracticeStudy();
  const [importIds,setImportIds]=useState<string[]>([]),[importTags,setImportTags]=useState(''),[importMessage,setImportMessage]=useState('');
  useEffect(()=>{registerLeave?.(()=>flush.current());return()=>registerLeave?.(null);},[registerLeave]);
  function apply(result:{banks?:QuestionBankData[];bank?:QuestionBankData;configured?:boolean}) {if(result.banks)setBanks(result.banks);if(result.bank)setBanks(items=>items.map(b=>b.id===result.bank!.id?result.bank!:b));if(result.configured!==undefined)setConfigured(result.configured);}
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError('');setBusy(true);
    (async()=>{
      try {
        if(!await flush.current()||cancelled)return;
        let loadedBanks:QuestionBankData[]=[];
        try {
          let result=await bankRequest('GET',undefined,courseId);
          if(!management&&!(context==='paper'&&selectionEntry)&&!initialScope&&!result.banks?.length&&eligible.length)result=await bankRequest('POST',{action:'prepare',courseId,materialIds:selected});
          if(!management&&!initialScope&&initialMaterialId&&!result.banks?.some(b=>b.materialId===initialMaterialId)&&eligible.some(m=>m.id===initialMaterialId))result=await bankRequest('POST',{action:'prepare',courseId,materialIds:[initialMaterialId]});
          loadedBanks=result.banks??[];
          if(cancelled)return;apply(result);
        }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'原题读取失败。');}
        if(management||selectionEntry){const protectedIds=await readExamProtection();if(!cancelled)setProtectedMaterials(protectedIds);return;}
        if(initialScope){const restored=await originalRequest({action:'original-load',courseId,context,questionIds:[],mode,scope:initialScope});if(!cancelled){setActive(restored);setExamHidden(restored.session.mode==='exam'&&!restored.session.submitted);}return;}
        let targetIds:string[]=[];
        if(initialMaterialId||initialQuestion!==undefined) {
          const matching=loadedBanks.filter(b=>!b.stale&&(!initialMaterialId||b.materialId===initialMaterialId)&&eligible.some(m=>m.id===b.materialId));
          const target=initialQuestion===undefined?matching[0]?.questions[0]:matching.flatMap(b=>b.questions).find(q=>q.id===String(initialQuestion))??matching.flatMap(b=>b.questions).find(q=>q.number===String(initialQuestion));
          if(!target)throw Error('指定原题已更新或暂不可用，请重新读取并选择原题。');
          const fileQuestions=matching.flatMap(b=>b.questions).filter(q=>q.materialId===target.materialId&&q.origin===(context==='paper'?'original':target.origin));
          const targetIndex=fileQuestions.findIndex(q=>q.id===target.id);
          if(targetIndex<0)throw Error('套卷模式只支持原题，请在知识点巩固中查看 AI 自编变式。');
          const targetLimit=target.origin==='variant'?5:10;
          targetIds=(context==='paper'?fileQuestions:fileQuestions.slice(Math.floor(targetIndex/targetLimit)*targetLimit,Math.floor(targetIndex/targetLimit)*targetLimit+targetLimit)).map(q=>q.id);
          setSelected([target.materialId]);setOrigin(target.origin);if(context==='knowledge')setChosenIds(targetIds);
        }
        if(listMaterialId&&!initialMaterialId&&initialQuestion===undefined)return;
        const restored=await originalRequest({action:'original-load',courseId,context,questionIds:targetIds,mode:context==='paper'?'exam':'practice'});
        if(!cancelled&&restored.session.ids.length){setActive(restored);setExamHidden(restored.session.mode==='exam'&&!restored.session.submitted);}
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'读取失败。');}finally{if(!cancelled){setLoading(false);setBusy(false);}}
    })();return()=>{cancelled=true;};
    // Setup choices belong to the next round; restore only on entering this course/context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[courseId,context,initialMaterialId,initialQuestion,initialScope,management,selectionEntry,listMaterialId]);
  const processing=banks.some(b=>b.state==='processing'||b.questions.some(q=>['queued','running'].includes(q.answerGeneration?.state??'')));
  useEffect(()=>{if(!processing)return;let alive=true;const timer=setInterval(()=>{void bankRequest('GET',undefined,courseId).then(result=>{if(alive)apply(result);}).catch(e=>{if(alive)setError(e.message);});},3000);return()=>{alive=false;clearInterval(timer);};},[processing,courseId]);
  const available=banks.filter(b=>selected.includes(b.materialId)&&eligible.some(m=>m.id===b.materialId));
  const questions=available.flatMap(b=>b.questions);
  const topics=[...new Set(questions.flatMap(q=>q.topics.length?q.topics:['未归类']))];
  const filtered=questions.filter(q=>(context==='paper'||topic==='all'||(q.topics.length?q.topics:['未归类']).includes(topic))&&(context==='paper'||kind==='all'||q.kind===kind)&&(context==='paper'?q.origin==='original'&&q.practiceArea!=='knowledge':q.origin===origin&&q.practiceArea!=='papers'));
  const selectionLimit=origin==='variant'?5:10;
  const chosen=context==='knowledge'?(chosenIds?filtered.filter(q=>chosenIds.includes(q.id)).slice(0,selectionLimit):filtered.slice(0,selectionLimit)):filtered;
  const sections=[...new Set(filtered.map(q=>q.section||'原题'))];
  async function readExamProtection(){const response=await fetch(`/api/practice-hub?courseId=${encodeURIComponent(courseId)}&section=${context==='paper'?'papers':'knowledge'}`,{cache:'no-store'});const summary=await response.json();if(!response.ok||!Array.isArray(summary.withheldMaterials))throw Error(summary.error||'考试状态读取失败，请重试。');return summary.withheldMaterials as string[];}
  async function perform(method:string,body:object){setBusy(true);setError('');try{if(!await flush.current())return false;if(management||(selectionEntry&&!active)){setProtectedMaterials(null);setProtectedMaterials(await readExamProtection());}apply(await bankRequest(method,method==='GET'?undefined:{courseId,...body},courseId));return true;}catch(e){setError(e instanceof Error?e.message:'操作失败。');return false;}finally{setBusy(false);}}
  async function start(){setBusy(true);setError('');try{if(!await flush.current())return;const data=await originalRequest({action:'original-load',courseId,context,questionIds:chosen.map(q=>q.id),mode,newRound:true});if(onStart)await onStart(data.scope);else{setActive(data);setExamHidden(data.session.mode==='exam'&&!data.session.submitted);}}catch(e){setError(e instanceof Error?e.message:'启动失败。');}finally{setBusy(false);}}
  async function importSelected(){setBusy(true);setError('');try{const selected=available.filter(b=>!b.stale).flatMap(b=>b.questions).filter(q=>importIds.includes(q.id));if(!study||selected.length!==importIds.length||!selected.length)throw Error('所选原题来源已更新，请重新核对。');await study.change(selected.map(q=>({engine:'original',questionId:q.id,materialId:q.materialId})),{manualWrong:true,...(importTags.trim()?{tags:importTags.split(/[,，]/).map(t=>t.trim()).filter(Boolean)}:{})});setImportMessage(`已将 ${selected.length} 道已核对题目加入错题集。`);setImportIds([]);}catch(e){setError(e instanceof Error?e.message:'导入失败，请重试。');}finally{setBusy(false);}}
  async function saveEdit(action?:'merge'|'split') {
    if(!edit)return;
    const options=editText.options.split('\n').filter(line=>line.trim()).map((line,i)=>{const match=line.match(/^([^\.．、]+)[\.．、]\s*(.*)$/);return {label:match?.[1].trim()??String.fromCharCode(65+i),text:match?.[2]??line};});
    const changes={prompt:edit.question.prompt,context:edit.question.context,kind:edit.question.kind,options,topics:editText.topics.split(/[,，]/).map(t=>t.trim()).filter(Boolean),answer:edit.question.answer,explanation:edit.question.explanation,criteria:edit.question.criteria};
    if(await perform('PATCH',{bankId:edit.bank.id,revision:edit.bank.revision,questionId:edit.question.id,...(action?{action,...(action==='split'?{parts:split.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean)}:{})}:{changes})})){setEdit(null);setSplit('');}
  }
  const bankSummaries=available.map(b=><div key={b.id} className="original-bank-state"><strong>{b.name}</strong><span>{b.questions.length} 道原题 · {b.state==='processing'?`正在整理 ${b.progress.done} / ${b.progress.total}`:b.state==='ready'?'整理完成':b.state==='partial'?'部分解析待补充':'尚未整理解析'}</span>{b.stale&&<p role="status">原文件已变更，请重新读取完整原题。</p>}{b.error&&<p role="alert">{b.error}</p>}{!loading&&!examHidden&&eligible.some(m=>m.id!==b.materialId)&&<details><summary>关联补充答案文件（可选）</summary><label>补充答案文件<select aria-label={`${b.name} 补充答案文件`} value={answerFiles[b.id]??''} onChange={e=>setAnswerFiles(files=>({...files,[b.id]:e.target.value}))}><option value="">选择本课程的答案文件</option>{eligible.filter(m=>m.id!==b.materialId).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><Button size="sm" disabled={busy||!answerFiles[b.id]} onClick={()=>void perform('POST',{action:'supplement',bankId:b.id,answerMaterialId:answerFiles[b.id]})}>关联补充答案</Button><p className="muted small">按部分与原题编号对应，保留原文答案与手动修订。</p></details>}</div>);
  const originalOverview=!loading&&!examHidden&&<details className="original-overview" open={management||!!listMaterialId||undefined}><summary>完整原题列表与修订（{questions.length} 题）</summary>{available.map(b=><section key={b.id}><h3>{b.name}</h3>{b.questions.map((q,i)=><details key={q.id} open={management&&(q.id===String(initialQuestion)||q.number===String(initialQuestion))||undefined}><summary>{q.section} · 第 {q.number} 题 · {originalKindNames[q.kind]}{q.origin==='variant'?' · AI自编':''}</summary>{importMistakes&&<label className="import-question-check"><input type="checkbox" checked={importIds.includes(q.id)} disabled={b.stale||busy} onChange={e=>setImportIds(ids=>e.target.checked?[...ids,q.id]:ids.filter(id=>id!==q.id))}/>核对并选择这道题</label>}{q.context&&<Markdown text={q.context}/>}<Markdown text={q.prompt}/>{management&&<div className="import-question-answer"><strong>参考答案 · {provenance[q.answerSource]}</strong><Markdown text={q.answer||'暂无可核对参考答案，请对照原文或老师的答案补充。'}/><>{(q.explanationSource==='ai'||q.answerSource==='ai')&&<p className="muted small">AI 补充解析</p>}<Markdown text={q.explanation}/></></div>}{!importMistakes&&management&&<QuestionStudyControls question={{engine:'original',questionId:q.id,materialId:q.materialId}} editable/>}{q.options.map(o=><p key={o.label}>{o.label}. {o.text}</p>)}<div className="original-actions"><Button size="sm" onClick={()=>{setEdit({bank:b,question:{...q}});setEditText({topics:q.topics.join(','),options:q.options.map(o=>o.label+'. '+o.text).join('\n')});setSplit('');}}>修订题目与答案</Button><Button size="sm" disabled={i===0||busy} onClick={()=>void perform('PATCH',{action:'merge',bankId:b.id,revision:b.revision,questionId:q.id})}>并入上一题</Button><Button size="sm" disabled={!configured||busy||q.origin!=='original'} onClick={()=>setConsent({type:'variants',bankId:b.id,questionId:q.id})}>生成变式（AI自编）</Button></div></details>)}</section>)}</details>;
  const analysisTools=<div className="original-actions"><Button variant={context==='knowledge'?'primary':'secondary'} disabled={!selected.length||busy||loading} onClick={()=>void perform('POST',{action:'prepare',materialIds:selected})}>读取完整原题</Button><Button disabled={!questions.length||!configured||busy||processing||examHidden} onClick={()=>setConsent({type:'analyze'})}>{available.some(b=>b.state==='partial')?'重试缺失答案与解析':'整理原题与解析'}</Button></div>;
  const paperNeedsRead=!chosen.length||!available.length||available.some(bank=>bank.stale);
  const paperUpdated=available.some(bank=>bank.stale);
  const modeHint={exam:'模拟考试：整卷交卷后查看答案与反馈。',practice:'逐题练习：作答后逐题查看反馈。',memorize:'背题浏览：直接查看答案与解析，不产生作答判定。'}[mode];
  return <div className="original-practice-center">
    {management&&<header className="practice-heading"><span>{context==='paper'?'试卷原题':'知识点原题巩固'}</span><small>原题练习 · 按原文件完整读取</small></header>}
    {loading&&<p role="status">正在读取原题与上次答题记录…</p>}
    {error&&<div role="alert" className="original-error"><p>{error}</p><Button disabled={busy} onClick={()=>void perform('GET',{})}>重试读取</Button></div>}
    {management&&examHidden&&<p role="status" className="hub-small-copy">所选资料有未交卷考试，答案、解析与修订列表在交卷后显示。请从主页继续该轮考试。</p>}
    {(!active||management||!onStart&&!compactRound)&&(context==='paper'&&!management?<details className="original-paper-setup" open={!active}>
      <summary>{active?'选择下一轮题目':'开始整卷练习'}</summary>
      <p className="original-paper-caption">保留原题号、共同材料与原始顺序</p>
      <label className="original-paper-select">试卷文件<select aria-label="试卷文件" value={selected[0]??''} disabled={busy||loading} onChange={e=>setSelected([e.target.value])}><option value="">请选择文件</option>{eligible.map(material=><option key={material.id} value={material.id}>{material.name}</option>)}</select></label>
      <div className="original-paper-count" role="status"><strong>{paperNeedsRead?paperUpdated?'原文件已更新':'读取后显示原题数量':('共 '+chosen.length+' 道原题')}</strong><span>{paperNeedsRead?'首次读取在本机提取原题，不调用 AI':(sections.length+' 个部分 · '+chosen.filter(question=>!question.answer.trim()).length+' 题待核对答案')}</span></div>
      {!eligible.length&&<p className="hub-small-copy">暂无可用试卷，请先导入资料并处理来源疑点。</p>}
      {available.filter(bank=>bank.error&&!bank.stale).map(bank=><p role="status" className="hub-small-copy" key={bank.id}>{bank.error}</p>)}
      <div className="original-paper-start"><label>作答模式<select aria-label="下一轮模式" value={mode} disabled={busy||loading} onChange={e=>setMode(e.target.value as OriginalMode)}><option value="exam">模拟考试</option><option value="practice">逐题练习</option><option value="memorize">背题浏览</option></select></label><Button variant="primary" disabled={!selected.length||busy||loading} onClick={()=>void(paperNeedsRead?perform('POST',{action:'prepare',materialIds:selected}):start())}>{busy&&<LoaderCircle size={15} className="spin"/>}{paperNeedsRead?paperUpdated?'重新读取试卷':'读取试卷':('开始 '+chosen.length+' 题')}</Button><p className="original-mode-hint">{modeHint}{!paperNeedsRead&&' 缺少解析的题目也能作答。'}</p></div>
      {sections.length>0&&!paperUpdated&&<details className="original-paper-structure"><summary>查看试卷结构 · {sections.length} 个部分</summary><ul className="original-sections">{sections.map(section=><li key={section}>{section} · {filtered.filter(question=>(question.section||'原题')===section).length} 题</li>)}</ul></details>}
      <details className="original-paper-tools"><summary>解析与原题整理</summary><p className="hub-small-copy">按需补充解析、关联答案或修订原题。</p>{analysisTools}{bankSummaries}{originalOverview}</details>
    </details>:<details className="original-setup" open={!active||management}><summary>{active?'选择下一轮题目':'选择文件与原题'}</summary>
      <p className="muted small">选好资料，再挑选本轮题目；暂缺解析也能开始练习。</p>
      {context==='paper'?<label>试卷文件<select aria-label="试卷文件" value={selected[0]??''} onChange={e=>setSelected([e.target.value])}><option value="">请选择文件</option>{eligible.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>:<fieldset className="original-file-list original-file-grid"><legend>原题文件 · 可多选</legend>{eligible.map(m=>{const bank=banks.find(bank=>bank.materialId===m.id),checked=selected.includes(m.id);return <SpotlightCard theme="light" key={m.id} className={`original-file-card${checked?' is-selected':''}`} spotlightColor="var(--hub-accent)" intensity={0.06} borderGlow={0.12} proximity={0} ambient={false} flare={false}><label><input type="checkbox" aria-label={`选择文件 ${m.name}`} checked={checked} disabled={busy||loading} onChange={e=>setSelected(ids=>e.target.checked?[...ids,m.id]:ids.filter(id=>id!==m.id))}/><span className="original-file-icon"><FileText size={19}/></span><strong title={m.name}>{m.name}</strong><span className="original-file-meta"><span>{bank&&!bank.stale?`${bank.questions.length} 道原题`:'题量待读取'}</span><span data-state={bank?.stale?'stale':bank?.state??'raw'}>{bank?.stale?'文件已更新':bank?.state==='processing'?'正在整理':bank?.state==='ready'?'整理完成':bank?.state==='partial'?'部分解析待补充':bank?.questions.length?'原题已读取':'待读取'}</span></span></label></SpotlightCard>;})}</fieldset>}
      {!eligible.length&&<p>暂无可用文件，请先导入资料并处理存在冲突的资料。</p>}
      <div className="original-file-toolbar"><span>已选 {selected.length} 份资料</span>{analysisTools}</div>
      {!configured&&<p className="muted small">尚未配置 AI 助手，仍可直接作答和手动核对答案。</p>}
      {bankSummaries.length>0&&<details className="original-material-details"><summary>所选资料整理详情 · {bankSummaries.length} 份</summary>{bankSummaries}</details>}
      {context==='knowledge'&&!management&&<div className="original-filters"><label>知识点<select aria-label="知识点" value={topic} onChange={e=>setTopic(e.target.value)}><option value="all">全部知识点</option>{topics.map(t=><option key={t}>{t}</option>)}</select></label><label>题型<select aria-label="题型" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">全部题型</option>{Object.entries(originalKindNames).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label><label>题目来源<select aria-label="题目来源" value={origin} onChange={e=>setOrigin(e.target.value)}><option value="original">原题</option><option value="variant">AI自编变式</option></select></label></div>}
      {context==='paper'&&<ul className="original-sections">{sections.map(section=><li key={section}>{section} · {filtered.filter(q=>(q.section||'原题')===section).length} 题</li>)}</ul>}
      {!management&&context==='knowledge'&&filtered.length>0&&<details className="original-pick-list"><summary>选择本组题目（已选 {chosen.length} / 最多 {selectionLimit} 题）</summary>{filtered.map(q=><label key={q.id}><input type="checkbox" aria-label={`选择第 ${q.number} 题`} checked={chosen.some(v=>v.id===q.id)} disabled={!chosen.some(v=>v.id===q.id)&&chosen.length>=selectionLimit} onChange={e=>setChosenIds(e.target.checked?[...chosen.map(v=>v.id),q.id]:chosen.map(v=>v.id).filter(id=>id!==q.id))}/>{q.section} · 第 {q.number} 题 · {originalKindNames[q.kind]} · {q.topics.join('、')||'未归类'}</label>)}</details>}
      {!management&&<div className="original-filters"><label>下一轮模式<select aria-label="下一轮模式" value={mode} onChange={e=>setMode(e.target.value as OriginalMode)}><option value="practice">练习 · 即时反馈</option><option value="memorize">背题 · 直接查看答案</option><option value="exam">模拟考试 · 整卷交卷后查看</option></select></label><Button variant="primary" disabled={!chosen.length||busy||loading||available.some(b=>b.stale)} onClick={()=>void start()}>开始 {chosen.length} 题{context==='knowledge'?`（每组最多 ${selectionLimit} 题）`:''}</Button></div>}
      {originalOverview}
    </details>)}
    {importMistakes&&<div className="import-confirm-panel"><p>核对题干、原题编号、答案与出处后，再将选中的题目加入错题集。可用「修订」补充知识点分类。</p><label>统一标签（可选）<input value={importTags} onChange={e=>setImportTags(e.target.value)} placeholder="例如：阅读理解，期中错题" maxLength={350}/></label><Button variant="primary" disabled={busy||!importIds.length||study?.loading} onClick={()=>void importSelected()}>已核对，加入 {importIds.length} 道错题</Button>{importMessage&&<p role="status">{importMessage}</p>}</div>}
    {!management&&active&&<OriginalRound key={`${courseId}:${context}:${active.scope}:${active.revision}`} initial={active} registerBackAction={registerBackAction} compact={compactRound} onSource={onSource} courseId={courseId} externalBusy={busy} configured={configured} banks={banks} onBanks={apply} onBusy={setBusy} initialQuestion={initialQuestion} onState={data=>{setExamHidden(data.session.mode==='exam'&&!data.session.submitted);}} registerFlush={fn=>{flush.current=fn;}}/>}
    <Modal open={!!consent} onOpenChange={open=>{if(!open&&!busy)setConsent(null);}} title={consent?.type==='variants'?'生成 AI 自编变式':'整理原题与解析'} description="需要发送题目给 AI 助手，并产生 API 费用。" error={error}>
      <p>{consent?.type==='variants'?'将发送选中原题，生成至多 5 道明确标记为 AI自编 的变式。':'将发送所选文件的完整题目文字，补充答案、解析与知识点；已有答案保留，重试只补缺失内容。'}以后主动请求 AI 点评时也会发送对应题目和你的回答。AI 结果需要核对。</p><p>本次文件：{available.map(b=>b.name).join('、')}</p><div className="modal-footer"><Button disabled={busy} onClick={()=>setConsent(null)}>取消</Button><Button variant="primary" disabled={busy} onClick={()=>{if(consent)void perform('POST',consent.type==='variants'?{action:'variants',bankId:consent.bankId,questionId:consent.questionId,confirmed:true}:{action:'analyze',materialIds:selected,confirmed:true}).then(ok=>{if(ok)setConsent(null);});}}>同意发送并{consent?.type==='variants'?'生成':'整理'}</Button></div>
    </Modal>
    <Modal open={!!edit&&!examHidden} onOpenChange={open=>{if(!open)setEdit(null);}} title="修订完整原题" description="保留原题编号与出处。手动修改的答案标记为「我的修订」。" error={error} wide>
      {edit&&<div className="original-edit">{(['prompt','context','answer','explanation'] as const).map(field=><label key={field}>{({prompt:'完整题干',context:'共同材料',answer:'参考答案',explanation:'解析'})[field]}<textarea value={edit.question[field]} onChange={e=>setEdit({...edit,question:{...edit.question,[field]:e.target.value}})}/></label>)}<label>题型<select value={edit.question.kind} onChange={e=>setEdit({...edit,question:{...edit.question,kind:e.target.value as OriginalKind}})}>{Object.entries(originalKindNames).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label><label>知识点（以逗号分隔）<input value={editText.topics} onChange={e=>setEditText({...editText,topics:e.target.value})}/></label><label>评分要点（每行一条）<textarea value={edit.question.criteria.join('\n')} onChange={e=>setEdit({...edit,question:{...edit.question,criteria:e.target.value.split('\n')}})}/></label><label>选项（每行「标签. 内容」）<textarea value={editText.options} onChange={e=>setEditText({...editText,options:e.target.value})}/></label><Button variant="primary" disabled={busy||!edit.question.prompt.trim()} onClick={()=>void saveEdit()}>保存修订</Button><details><summary>拆分错误合并的题目</summary><label>完整题目之间空一行<textarea value={split} onChange={e=>setSplit(e.target.value)}/></label><Button disabled={busy||split.split(/\n\s*\n/).filter(s=>s.trim()).length<2} onClick={()=>void saveEdit('split')}>拆为独立题目</Button></details></div>}
    </Modal>
  </div>;
}

function AnswerSources({question}:{question:OriginalQuestion}) {
  if(!question.answerRefs?.length)return null;
  return <details className="original-answer-citations"><summary>参考答案出处</summary>{question.answerRefs.map((reference,index)=><div key={index}><a href={`/api/files/${encodeURIComponent(reference.materialId)}${reference.location==='page'?`#page=${reference.page}`:''}`} target="_blank" rel="noreferrer">{reference.name} · {referenceLocation(reference)}</a><blockquote>{reference.snippet}</blockquote></div>)}</details>;
}

function Sources({question,onOpen,onSource}:{question:OriginalQuestion;onOpen?:()=>void;onSource?:(ref:Reference)=>void}) {
  const [open,setOpen]=useState(false),[extraction,setExtraction]=useState<Extraction|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const currentSource=useRef<HTMLElement|null>(null),name=question.sources[0]?.name??'原文件';
  const variant=question.origin==='variant';
  const groups=extraction?groupDocumentPages(extraction.pages):[];
  function fileLink(source:OriginalQuestion['sources'][number]){return `/api/files/${encodeURIComponent(question.materialId)}${/\.pdf$/i.test(source.name)&&source.location==='page'?`#page=${source.page}`:''}`;}
  async function read(){
    onOpen?.();
    setOpen(true);setLoading(true);setError('');
    try {
      const response=await fetch(`/api/materials/${encodeURIComponent(question.materialId)}/extraction`,{cache:'no-store'}),data=await response.json();
      if(!response.ok)throw Error(data.error||'原文读取失败。');
      setExtraction(data.result??null);if(!data.result)setError(data.running?'原文仍在提取，请稍后重新读取。':'暂无完整原文记录，请回到文件选择读取完整原题。');
    }catch(e){setError(e instanceof Error?e.message:'原文读取失败。');}finally{setLoading(false);}
  }
  useEffect(()=>{if(open&&extraction)currentSource.current?.scrollIntoView({block:'start'});},[open,extraction]);
  return <div className="original-sources">{!onSource&&question.sources.map((s,i)=><a key={i} href={fileLink(s)} target="_blank" rel="noreferrer" onClick={onOpen}>{variant?'查看生成依据':'打开原文件核对'} · {s.name} · {sourceLocation(s.name,s.page)}（原文可能包含答案）</a>)}<Button size="sm" variant="ghost" onClick={()=>{if(onSource&&question.sources[0]){onOpen?.();onSource({materialId:question.materialId,...question.sources[0]});}else void read();}}>{onSource?variant?'查看生成依据':'查看出处':variant?'对照生成依据原文':'对照完整原文'}{onSource&&question.sources[0]?` · ${sourceLocation(name,question.sources[0].page)}`:'（原文可能含答案）'}</Button>
    <Modal open={open} onOpenChange={setOpen} title={`${name} · 完整原文对照`} description={`${variant?'以下为生成依据，AI 自编变式不在原文件中。':''}主动打开的原文件内容可能包含答案。文字按原文顺序分组，题干、选项与共同材料均保留；公式与图形请同时查看原文件。`} error={error} wide>
      {loading&&<p role="status">正在读取本机原文…</p>}<Button size="sm" disabled={loading} onClick={()=>void read()}>重新读取原文</Button>
      <nav className="original-source-nav" aria-label="原题来源位置">{question.sources.map((source,i)=>{const group=groups.find(g=>g.pages.some(p=>p.page===source.page));return <span key={i}>{group&&<a href={`#raw-source-${question.materialId}-${group.id}`}>{sourceLocation(source.name,source.page)} · 定位原文</a>}<a href={fileLink(source)} target="_blank" rel="noreferrer">打开原文件 · {sourceLocation(source.name,source.page)}</a></span>;})}</nav>
      {extraction?.state==='partial'&&<p role="status">原文提取不完整，请核对原文件及各位置提示。</p>}
      <div className="original-source-content">{groups.map(group=>{const current=group.pages.some(p=>question.sources.some(s=>s.page===p.page));return <section key={group.id} id={`raw-source-${question.materialId}-${group.id}`} data-source-current={current?'true':undefined} ref={node=>{if(group.pages.some(p=>p.page===question.sources[0]?.page))currentSource.current=node;}}><h3>{sourceLocation(name,group.pages[0].page)}{group.pages.length>1?` 至 ${sourceLocation(name,group.pages.at(-1)!.page)}`:''}{current?' · 本题原文':''}</h3><pre>{group.text}</pre>{group.pages.flatMap(p=>p.warnings??[]).map((warning,i)=><p key={i}>{warning}</p>)}{group.pages.flatMap(p=>p.blocks??[]).filter(block=>block.type==='image'&&block.assetPath).map((block,i)=><figure key={i}><img src={`/api/materials/${encodeURIComponent(question.materialId)}/assets?path=${encodeURIComponent(block.assetPath!)}`} alt={block.marker??'原文图片'}/></figure>)}</section>;})}</div>
    </Modal>
  </div>;
}

export function OriginalRound({initial,courseId,externalBusy,configured,banks,onBanks,onBusy,initialQuestion,onState,registerFlush,compact=false,onSource,registerBackAction}:{initial:OriginalSessionData;courseId:string;externalBusy:boolean;configured:boolean;banks:QuestionBankData[];onBanks:(result:{bank?:QuestionBankData})=>void;onBusy:(busy:boolean)=>void;initialQuestion?:string|number;onState:(data:OriginalSessionData)=>void;registerFlush:(flush:()=>Promise<boolean>)=>void;compact?:boolean;onSource?:(ref:Reference)=>void;registerBackAction?:(action:PracticeBackAction|null)=>void}) {
  const {data,update,flush,retry,refreshAnswers,referenceError,action:sessionAction,error,message,busy:savingAction,isSaved}=useOriginalSession(initial,courseId);
  const [submitting,setSubmitting]=useState(false);
  const busy=externalBusy||savingAction||submitting;
  const {session}=data,current=data.questions.find(q=>q.id===session.ids[session.index]),result=current?session.results[current.id]:undefined;
  const hidden=session.mode==='exam'&&!session.submitted,memorizing=session.mode==='memorize';
  const [showResults,setShowResults]=useState(initialQuestion===undefined&&initial.session.finished&&initial.session.mode!=='memorize'),[celebrateResults,setCelebrateResults]=useState(false);
  const displayingResults=!memorizing&&session.finished&&showResults&&isSaved;
  useEffect(()=>{registerBackAction?.(session.finished&&!memorizing&&!displayingResults?{label:'返回看板',onClick:()=>{setCelebrateResults(false);void flush().then(ok=>{if(ok)setShowResults(true);});}}:null);return()=>registerBackAction?.(null);},[registerBackAction,session.finished,memorizing,displayingResults]);
  const [feedbackConsent,setFeedbackConsent]=useState(false),[history,setHistory]=useState<string|null>(null),[more,setMore]=useState(false),[answerSheet,setAnswerSheet]=useState(false),[sharing,setSharing]=useState(false),[confirmHandIn,setConfirmHandIn]=useState(false);
  const [preferences,setPreferences]=useState<{font:'small'|'standard'|'large';autoExpand:boolean;autoNext:boolean}>({font:'standard',autoExpand:true,autoNext:false});
  const preferencesLoaded=useRef(false);
  useEffect(()=>{
    try{const saved=JSON.parse(localStorage.getItem('lms.practice.preferences')??'{}');setPreferences({font:['small','standard','large'].includes(saved.font)?saved.font:'standard',autoExpand:typeof saved.autoExpand==='boolean'?saved.autoExpand:true,autoNext:saved.autoNext===true});}catch{/* Defaults work without browser storage. */}
  },[]);
  useEffect(()=>{if(!preferencesLoaded.current){preferencesLoaded.current=true;return;}try{localStorage.setItem('lms.practice.preferences',JSON.stringify(preferences));}catch{/* Settings remain usable for this visit. */}},[preferences]);
  const [expanded,setExpanded]=useState(true),reviewRequested=useRef(false);
  useEffect(()=>{setExpanded(reviewRequested.current||preferences.autoExpand);reviewRequested.current=false;},[current?.id,preferences.autoExpand]);
  const [countdown,setCountdown]=useState<number|null>(null),advanceTimer=useRef<ReturnType<typeof setInterval>|null>(null),advanceGeneration=useRef(0);
  const heading=useRef<HTMLHeadingElement>(null);
  const [restartMode,setRestartMode]=useState(session.mode);
  const [variantConsent,setVariantConsent]=useState(false),[pendingVariants,setPendingVariants]=useState<string[]>([]),[variantError,setVariantError]=useState('');
  const generating=useRef(false);
  const variantCount=data.questions.filter(q=>q.origin==='variant').length,remainingVariants=5-variantCount;
  const currentBank=banks.find(b=>!b.stale&&b.questions.some(q=>q.id===current?.id));
  const liveQuestion=currentBank?.questions.find(question=>question.id===current?.id);
  const [answerPolicy,setAnswerPolicy]=useState<'ask'|'on'|'off'>(()=>{try{const value=localStorage.getItem(`lms.answer.consent:${courseId}`);return value==='true'?'on':value==='false'?'off':'ask';}catch{return 'ask';}}),[answerConsent,setAnswerConsent]=useState(false),[answerError,setAnswerError]=useState('');
  const requestedAnswers=useRef(new Set<string>()),synchronizing=useRef(false),refreshRef=useRef(refreshAnswers);refreshRef.current=refreshAnswers;
  const answerConsentKey=`lms.answer.consent:${courseId}`;
  useEffect(()=>{try{const preference=localStorage.getItem(answerConsentKey);setAnswerPolicy(preference==='true'?'on':preference==='false'?'off':'ask');}catch{/* Explain the send scope before generating. */}},[answerConsentKey]);
  function answerPreference(value:boolean){setAnswerPolicy(value?'on':'off');setAnswerConsent(false);try{localStorage.setItem(answerConsentKey,String(value));}catch{/* The setting still applies to this visit. */}}
  async function ensureAnswer(retry=false){
    if(!currentBank||!current||session.finished||session.submitted)return;
    const key=`${currentBank.id}:${current.id}`;if(requestedAnswers.current.has(key)&&!retry)return;requestedAnswers.current.add(key);setAnswerError('');
    try{onBanks(await bankRequest('POST',{action:'ensure-answer',courseId,bankId:currentBank.id,questionId:current.id,confirmed:true,retry}));}
    catch(reason){setAnswerError(reason instanceof Error?reason.message:'后台补答案未完成，仍可继续作答。');}
  }
  useEffect(()=>{
    if(!configured||!currentBank||!current||current.answer.trim()||liveQuestion?.answer.trim()||session.finished||session.submitted)return;
    if(answerPolicy==='ask'){setAnswerConsent(true);return;}
    if(answerPolicy==='on'&&!liveQuestion?.answerGeneration)void ensureAnswer();
    // Only the open question is submitted; switching questions never submits the whole set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[current?.id,answerPolicy,configured,currentBank?.id,liveQuestion?.answer,liveQuestion?.answerGeneration?.state,session.finished,session.submitted]);
  useEffect(()=>{
    if(synchronizing.current||busy||session.finished||session.submitted)return;
    if(!data.questions.some(question=>!question.answer.trim()&&banks.some(bank=>!bank.stale&&bank.questions.some(live=>live.id===question.id&&live.answer.trim()))))return;
    synchronizing.current=true;void refreshRef.current().finally(()=>{synchronizing.current=false;});
  },[banks,data.questions,busy,session.finished,session.submitted]);
  const canGenerate=!!current&&!memorizing&&current.origin==='original'&&!!session.answers[current.id]?.trim()&&!!current.answer.trim()&&!!current.explanation.trim()&&!!currentBank&&remainingVariants>0&&!session.finished&&!session.submitted;
  function cancelAdvance(){advanceGeneration.current++;if(advanceTimer.current)clearInterval(advanceTimer.current);advanceTimer.current=null;setCountdown(null);}
  useEffect(()=>{cancelAdvance();return()=>{advanceGeneration.current++;if(advanceTimer.current)clearInterval(advanceTimer.current);};},[current?.id,session.roundId,session.mode,session.finished,session.submitted,error,preferences.autoNext,busy]);
  useEffect(()=>{const pause=()=>{if(document.hidden)cancelAdvance();};document.addEventListener('visibilitychange',pause);return()=>document.removeEventListener('visibilitychange',pause);},[]);
  useEffect(()=>{onState(data);registerFlush(flush);});
  useEffect(()=>{if(initialQuestion!==undefined){const index=initial.questions.findIndex(q=>q.id===String(initialQuestion)||q.number===String(initialQuestion));if(index>=0)update(s=>({...s,index}));}
    // Deep links select the initial question once and keep subsequent navigation local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{if(!displayingResults){heading.current?.focus({preventScroll:true});heading.current?.closest('article')?.scrollIntoView({behavior:'instant',block:'start'});}},[current?.id,displayingResults]);
  function move(index:number){cancelAdvance();update(s=>({...s,index}));}
  function autoAdvance(correct:boolean|null){
    if(correct!==true||!preferences.autoNext||session.mode!=='practice'||session.finished||session.index>=session.ids.length-1||!current)return;
    const generation=advanceGeneration.current,roundId=session.roundId,index=session.index,id=current.id;
    void flush().then(saved=>{
      if(!saved||generation!==advanceGeneration.current||document.hidden)return;
      let remaining=3;setCountdown(remaining);
      advanceTimer.current=setInterval(()=>{
        remaining--;setCountdown(remaining||null);
        if(!remaining){if(advanceTimer.current)clearInterval(advanceTimer.current);advanceTimer.current=null;update(s=>s.roundId===roundId&&s.index===index&&!s.finished&&!s.submitted&&s.mode==='practice'&&s.results[id]?.correct===true?{...s,index:index+1}:s);}
      },1000);
    });
  }
  function answer(value:string|((previous:string)=>string)){
    if(!current||memorizing||busy||error||session.finished||!!result&&!hidden)return;
    cancelAdvance();let correct:boolean|null=null;
    update(s=>{
      const text=typeof value==='function'?value(s.answers[current.id]??''):value;
      const next={...s,answers:{...s.answers,[current.id]:text}};
      if(s.mode==='practice'&&['single','judge'].includes(current.kind)){correct=gradeOriginal(current,text);next.results={...s.results,[current.id]:{answer:text,correct,source:current.answerSource}};}
      return next;
    });autoAdvance(correct);
  }
  function confirmAnswer(){
    if(!current||hidden||memorizing||result||!session.answers[current.id]?.trim()||busy||error||session.finished)return;
    cancelAdvance();const text=session.answers[current.id],correct=gradeOriginal(current,text);
    update(s=>({...s,results:{...s.results,[current.id]:{answer:text,correct,source:current.answerSource}}}));autoAdvance(correct);
  }
  async function handIn(){
    cancelAdvance();setConfirmHandIn(false);setSubmitting(true);
    try{
      if(!await flush())return;
      update(s=>{const results={...s.results};for(const id of s.ids){const q=data.questions.find(q=>q.id===id);if(q&&!results[id]){const text=s.answers[id]??'';results[id]={answer:text,correct:gradeOriginal(q,text),source:q.answerSource};}}return {...s,results,submitted:true,finished:true};});
      if(await flush()){setShowResults(true);setCelebrateResults(true);}
    }finally{setSubmitting(false);}
  }
  function assess(correct:boolean|null){if(current&&result&&!memorizing){cancelAdvance();update(s=>({...s,results:{...s.results,[current.id]:{...s.results[current.id],answer:s.answers[current.id]??'',correct,source:'self'}}}));}}
  const unanswered=session.ids.filter(id=>!session.answers[id]?.trim()).length;
  const summary={correct:session.ids.filter(id=>session.answers[id]?.trim()&&session.results[id]?.correct===true).length,wrong:session.ids.filter(id=>session.answers[id]?.trim()&&session.results[id]?.correct===false).length,pending:session.ids.filter(id=>session.answers[id]?.trim()&&session.results[id]?.correct==null).length};
  const archived=data.rounds.find(r=>r.id===history);
  const variantNumber=(id:string)=>data.questions.filter(q=>q.origin==='variant').findIndex(q=>q.id===id)+1;
  async function action(name:string,extra:object){cancelAdvance();onBusy(true);try{return await sessionAction(name,extra);}finally{onBusy(false);}}
  async function appendVariants(ids=pendingVariants){const ok=await action('original-append',{questionIds:ids});if(ok){setPendingVariants([]);setVariantError('');}return ok;}
  async function generateVariants(){
    if(!canGenerate||!current||!currentBank||busy||generating.current)return;
    generating.current=true;cancelAdvance();onBusy(true);setVariantError('');
    try{
      if(!await flush())return;
      const previousIds=new Set(currentBank.questions.map(q=>q.id));
      const generated=await bankRequest('POST',{action:'variants',courseId,bankId:currentBank.id,questionId:current.id,count:remainingVariants,confirmed:true});
      onBanks(generated);
      const ids=generated.bank?.questions.filter(q=>q.origin==='variant'&&!previousIds.has(q.id)&&q.id.startsWith(`${current.id}:variant:`)).map(q=>q.id)??[];
      if(!ids.length||ids.length>remainingVariants)throw Error('返回的变式数量不符合本轮范围，请在题库核对后重试。');
      setPendingVariants(ids);setVariantConsent(false);await appendVariants(ids);
    }catch(e){setVariantError(e instanceof Error?e.message:'生成失败，请重试。');}finally{generating.current=false;onBusy(false);}
  }
  const assessmentControls=<div className="self-assess original-actions"><Button aria-pressed={result?.source==='self'&&result.correct===true} disabled={busy||!!error} onClick={()=>assess(true)}>{compact?'我答对了':'自评正确'}</Button><Button aria-pressed={result?.source==='self'&&result.correct===false} disabled={busy||!!error} onClick={()=>assess(false)}>{compact?'还需练习':'自评需巩固'}</Button><Button aria-pressed={result?.source==='self'&&result.correct===null} disabled={busy||!!error} onClick={()=>assess(null)}>{compact?'暂不确定':'保留待核对'}</Button></div>;
  const variantTools=data.context==='knowledge'&&!memorizing&&<div className="original-actions"><span>本轮已追加 {variantCount} / 5 道 AI 自编变式</span>{pendingVariants.length?<Button disabled={busy} onClick={()=>void appendVariants()}>重试追加已生成变式（{pendingVariants.length} 题）</Button>:<Button disabled={busy||!configured||!canGenerate||!!error} onClick={()=>{cancelAdvance();setVariantConsent(true);}}>追加本轮 AI 变式（最多 {Math.max(0,remainingVariants)} 题）</Button>}<p className="muted small">选择本轮已作答且参考答案、解析完整的原题。追加保留当前作答与位置。</p>{variantError&&<p role="alert">{variantError}</p>}</div>;
  const historyTools=!!data.rounds.length&&<details><summary>历史轮次（{data.rounds.length}）</summary>{data.rounds.map((r,i)=><Button key={r.id} size="sm" onClick={()=>{cancelAdvance();setHistory(r.id);}}>第 {i+1} 轮 · {new Date(r.createdAt).toLocaleString('zh-CN')} · {r.session.ids.length} 题{r.session.mode==='memorize'?' · 背题':''}</Button>)}</details>;
  const completionPanel=session.finished&&<div className="original-round-summary"><p>{memorizing?'本轮背题已结束 · 未产生作答判定':`本轮已交卷 · 正确 ${summary.correct} · 需巩固 ${summary.wrong} · 未答 ${unanswered} · 待核对 / 自评 ${summary.pending}`}</p><div className="original-actions"><label>重新练习模式<select aria-label="重新练习模式" value={restartMode} onChange={e=>setRestartMode(e.target.value as OriginalMode)}><option value="practice">逐题练习</option><option value="memorize">背题 · 直接查看答案</option><option value="exam">模拟考试</option></select></label><Button disabled={busy||!!error} onClick={()=>void action('original-restart',{mode:restartMode})}>重新练习并保留历史</Button></div></div>;
  function reviewResult(id?:string){const index=id?session.ids.indexOf(id):0;reviewRequested.current=index>=0&&index!==session.index;setShowResults(false);setCelebrateResults(false);setExpanded(true);if(index>=0)move(index);}
  return <section className={`original-round practice-font-${preferences.font} ${compact?'is-answer-board':''}`}>
    {!compact&&<div className="original-round-status"><span>{memorizing?'背题浏览':session.mode==='exam'?'模拟考试':'逐题练习'} · {session.finished?'本轮已完成':memorizing?'正在浏览':'正在作答'} · {session.ids.length} 题</span><span role="status">{message}</span></div>}
    {!compact&&!displayingResults&&variantTools}
    {error&&<div className="original-error" role="alert"><p>{error} 当前答案仍保留在本页。</p><Button disabled={busy} onClick={()=>void retry()}>重试保存</Button></div>}
    {displayingResults&&<OriginalPracticeResults session={session} questions={data.questions} celebrate={celebrateResults} disabled={busy||!!error} restartMode={restartMode} onRestartMode={setRestartMode} onRestart={()=>{setCelebrateResults(false);void action('original-restart',{mode:restartMode}).then(ok=>{if(ok)setShowResults(false);});}} onReview={reviewResult}/>}
    {!displayingResults&&current&&<article className="practice-paper original-paper"><div className="practice-paper-meta"><span>{compact?originalKindNames[current.kind]:`${current.origin==='variant'?'知识点变式':current.section} · ${originalKindNames[current.kind]}`} · {current.origin==='variant'?'AI 自编':'原题'}</span><div className="original-paper-tools">{compact&&<span className="answer-board-save" role="status" title={error||message}>{error?'保存失败':message.startsWith('等待保存')?'待保存':message.startsWith('正在保存')?'保存中':busy?'处理中':message.startsWith('已保存')?'已保存':''}</span>}<span>{session.index+1} / {session.ids.length}</span><>{compact&&<Button variant="ghost" size="sm" aria-label="打开答题卡" onClick={()=>{cancelAdvance();setAnswerSheet(true);}}><ListChecks size={17}/>答题卡</Button>}</><Button variant="ghost" size="sm" aria-label="更多设置" onClick={()=>{cancelAdvance();setMore(true);}}><MoreHorizontal size={17}/>更多</Button></div></div><h2 ref={heading} tabIndex={-1}>{current.origin==='variant'?`AI 变式 ${variantNumber(current.id)}`:`第 ${current.number} 题`}</h2>
      {!compact&&<QuestionStudyControls question={{engine:'original',questionId:current.id,materialId:current.materialId}}/>}
      {current.context&&<div className="original-context"><Markdown text={current.context}/></div>}<Markdown text={current.prompt}/>{current.media?.map((m,i)=><figure key={i}><img src={m.url} alt={m.label}/><figcaption>{m.label}</figcaption></figure>)}
      {!memorizing&&<fieldset className="original-answer" disabled={busy||!!error||session.finished||!!result&&!hidden}><legend>我的答案</legend>
        {current.kind==='single'||current.kind==='multiple'?<div className="practice-options">{current.options.map(o=><label key={o.label}><input type={current.kind==='multiple'?'checkbox':'radio'} name={`answer-${current.id}`} value={o.label} checked={current.kind==='multiple'?(session.answers[current.id]??'').split(',').includes(o.label):session.answers[current.id]===o.label} onChange={e=>{const checked=e.target.checked;answer(current.kind==='multiple'?previous=>[...new Set(checked?[...previous.split(',').filter(Boolean),o.label]:previous.split(',').filter(v=>v!==o.label))].sort().join(','):o.label);}}/><div className="original-option-content"><span className="original-option-label">{o.label}.</span><Markdown text={o.text}/></div></label>)}</div>:current.kind==='judge'?<div className="practice-options">{['对','错'].map(label=><label key={label}><input type="radio" name={`answer-${current.id}`} value={label} checked={session.answers[current.id]===label} onChange={()=>answer(label)}/>{label}</label>)}</div>:current.kind==='fill'?<input aria-label="填空答案" value={session.answers[current.id]??''} maxLength={8000} onChange={e=>answer(e.target.value)}/>:<><label htmlFor={`original-answer-${current.id}`}>写下完整过程与结论</label><RichAnswerEditor key={current.id} id={`original-answer-${current.id}`} value={session.answers[current.id]??''} disabled={busy||!!error||session.finished||!!result&&!hidden} onChange={answer}/></>}
      </fieldset>}
      {memorizing&&!!current.options.length&&<div className="original-memorize-options">{current.options.map(option=><div className="original-option-content" key={option.label}><span className="original-option-label">{option.label}.</span><Markdown text={option.text}/></div>)}</div>}
      {!current.answer.trim()&&configured&&!session.finished&&<div className="original-answer-generation" role="status">{['queued','running'].includes(liveQuestion?.answerGeneration?.state??'')?<><LoaderCircle size={14} className="spin"/>后台生成本题参考答案，仍可作答或跳题。</>:liveQuestion?.answerGeneration?.state==='failed'||answerError?<><span>{answerError||liveQuestion?.answerGeneration?.error||'补答案失败，仍可继续作答。'}</span><Button size="sm" onClick={()=>answerPolicy==='on'?void ensureAnswer(true):setAnswerConsent(true)}>重试补答案</Button></>:answerPolicy==='off'?<Button size="sm" variant="ghost" onClick={()=>setAnswerConsent(true)}>开启本题后台补答案</Button>:null}</div>}
      {referenceError&&<p className="original-answer-generation" role="status">{referenceError} 作答仍保留。<button type="button" onClick={()=>void refreshAnswers()}>重试同步参考答案</button></p>}
      {!hidden&&(result||memorizing)&&<section className="practice-feedback" aria-live="polite">
        <div className="original-feedback-heading"><h3>{memorizing?'参考答案与解析':result?.correct===null?'待自评 / 待核对':result?.correct?'已判为正确':'需要巩固'}</h3>{!memorizing&&<Button variant="ghost" size="sm" aria-expanded={expanded} onClick={()=>{cancelAdvance();setExpanded(!expanded);}}>{expanded?'收起答案与解析':'查看答案与解析'}</Button>}</div>
        {(expanded||memorizing)&&<><div className="original-solution"><div className="original-solution-answer"><strong>【答案】</strong><Markdown text={current.answer||'待补齐'}/><span className="original-solution-origin">{current.answerSource==='ai'?'AI 生成':current.answerSource==='manual'?'我的修订':current.answerSource==='supplement'?'补充资料':current.answerSource==='none'?'待核对':'资料提供'}</span></div><div className="original-solution-explanation"><strong>【解析】</strong><Markdown text={current.explanation||'暂无解析'}/>{current.explanationSource==='ai'&&current.answerSource!=='ai'&&<span className="original-solution-origin">AI 生成</span>}</div></div>{!!current.criteria.length&&<><h4>评分要点</h4><ul>{current.criteria.map((c,i)=><li key={i}>{c}</li>)}</ul></>}{!!current.warnings.length&&<p>{current.warnings.join(' ')}</p>}<AnswerSources question={current}/><Sources key={current.id} question={current} onOpen={cancelAdvance} onSource={onSource}/>
          {!memorizing&&result&&<>{compact?<details key={current.id} className="original-assessment" open={!['single','multiple','judge','fill'].includes(current.kind)||result.correct===null||undefined}><summary>{['single','multiple','judge','fill'].includes(current.kind)&&result.correct!==null?'修改判定':'自评本题'}</summary><p>对照参考答案，仅调整本题判定；答案与解析保留。</p>{assessmentControls}</details>:assessmentControls}{!['single','multiple','judge','fill'].includes(current.kind)&&<Button disabled={!configured||busy||!result.answer.trim()} onClick={()=>{cancelAdvance();setFeedbackConsent(true);}}>请求 AI 点评</Button>}{result.feedback&&<div className="original-feedback">{(['strengths','omissions','suggestions','uncertainty'] as const).map(key=><section key={key}><h4>{({strengths:'已覆盖',omissions:'遗漏',suggestions:'改进建议',uncertainty:'待核对'})[key]}</h4><ul>{result.feedback![key].map((text,i)=><li key={i}>{text}</li>)}</ul></section>)}</div>}</>}
        </>}
      </section>}
      {hidden&&<p className="answer-hint">交卷前只保存答案，不显示对错、参考答案或解析。可以返回修改或跳过未答题。</p>}
      {!hidden&&!memorizing&&!result&&<p className="answer-hint">{['single','judge'].includes(current.kind)?'选择后立即判定。':'完成作答后确认答案，也可以在交卷时统一确认。'}</p>}
      <footer className="original-navigation">
        <div className="original-navigation-pages"><Button disabled={session.index===0||busy} onClick={()=>move(session.index-1)}>上一题</Button><Button disabled={session.index>=session.ids.length-1||busy} onClick={()=>move(session.index+1)}>{!memorizing&&!session.answers[current.id]?'跳过 / 下一题':'下一题'}</Button></div>
        {countdown!==null&&<div className="original-countdown" role="status"><span>{countdown} 秒后下一题</span><Button size="sm" onClick={cancelAdvance}>停留本题</Button></div>}
        <div className="original-navigation-submit">{!hidden&&!memorizing&&!result&&!session.finished&&!['single','judge'].includes(current.kind)&&<Button disabled={busy||!!error||!session.answers[current.id]?.trim()} onClick={confirmAnswer}>确认答案</Button>}{!session.finished&&(memorizing?<Button variant="primary" disabled={busy||!!error} onClick={()=>{cancelAdvance();update(s=>({...s,finished:true}));void flush();}}>结束背题</Button>:<Button variant="primary" disabled={busy||!!error} onClick={()=>{cancelAdvance();if(unanswered)setConfirmHandIn(true);else void handIn();}}>交卷</Button>)}</div>
      </footer>
      {compact&&completionPanel}
    </article>}
    {!compact&&!displayingResults&&<details className="original-question-nav"><summary>本轮题目导航（{session.ids.length} 题）</summary><div className="original-actions">{session.ids.map((id,i)=>{const q=data.questions.find(q=>q.id===id);return <Button key={id} size="sm" aria-current={i===session.index?'step':undefined} disabled={busy} onClick={()=>move(i)}>{q?.origin==='variant'?`AI 变式 ${variantNumber(id)}`:`${q?.section??''} · ${q?.number??i+1}`}{memorizing?'':session.answers[id]?session.mode==='practice'&&!session.results[id]?' · 待确认':' · 已答':' · 未答'}</Button>;})}</div></details>}
    {!compact&&!displayingResults&&completionPanel}
    {!compact&&historyTools}
    <Modal open={more} onOpenChange={setMore} title="更多设置" description="调整本轮学习方式和阅读偏好。字号、解析与跳题偏好在本机记住。">
      <div className="practice-settings">
        {compact&&current&&<QuestionStudyControls question={{engine:'original',questionId:current.id,materialId:current.materialId}}/>}
        {compact&&variantTools}
        {compact&&historyTools}
        <label className="practice-setting-mode">本轮模式<select aria-label="本轮模式" value={session.mode} disabled={busy||!!error||session.finished||session.submitted} onChange={event=>{const mode=event.target.value as OriginalMode;void action('original-mode',{mode}).then(ok=>{if(ok)setMore(false);});}}><option value="practice">练习 · 即时反馈</option><option value="memorize">背题 · 直接查看答案</option><option value="exam">模拟考试 · 交卷后反馈</option></select></label>
        {!compact&&<p className="muted small">{memorizing?'只记录浏览位置，不计入作答。返回练习会开启新的作答轮次。':'切换时保存当前轮次和历史；进入背题后只记录浏览位置。'}</p>}
        <fieldset className="practice-setting-font"><legend>字号</legend>{(['small','standard','large'] as const).map(font=><Button key={font} size="sm" aria-pressed={preferences.font===font} onClick={()=>setPreferences(p=>({...p,font}))}>{font==='small'?'小':font==='standard'?'标准':'大'}</Button>)}</fieldset>
        <label className="practice-setting-check"><span>自动展开解析<small>{memorizing?'背题模式直接展示':hidden?'模拟考试交卷后可用':'关闭后仍显示对错，可手动展开'}</small></span><input type="checkbox" aria-label="自动展开解析" checked={preferences.autoExpand} disabled={memorizing||hidden} onChange={event=>setPreferences(p=>({...p,autoExpand:event.target.checked}))}/></label>
        <label className="practice-setting-check"><span>答对自动下一题<small>{memorizing||session.mode==='exam'?'练习模式可用':'保存后倒计时 3 秒，可选择停留'}</small></span><input type="checkbox" aria-label="答对自动下一题" checked={preferences.autoNext} disabled={memorizing||session.mode==='exam'} onChange={event=>setPreferences(p=>({...p,autoNext:event.target.checked}))}/></label>
        <label className="practice-setting-check"><span>缺答案时后台生成<small>仅发送当前题和共同材料；已确认的设置在本机记住</small></span><input type="checkbox" aria-label="缺答案时后台生成" checked={answerPolicy==='on'} onChange={event=>{if(event.target.checked)setAnswerConsent(true);else answerPreference(false);}}/></label>
        <Button className="practice-share-action" onClick={()=>{cancelAdvance();setMore(false);setSharing(true);}}><Share2 size={16}/>分享本题</Button>
      </div><div className="modal-footer"><Button onClick={()=>setMore(false)}>关闭更多设置</Button></div>
    </Modal>
    <Modal open={compact&&answerSheet} onOpenChange={setAnswerSheet} title="答题卡" description={`已答 ${session.ids.length-unanswered} / ${session.ids.length} 题`}>
      <div className="practice-answer-sheet"><div className="answer-sheet-legend"><span>未答</span><span>已答</span><span>当前题</span></div><div className="answer-sheet-grid">{session.ids.map((id,index)=>{const question=data.questions.find(question=>question.id===id),answered=!!session.answers[id]?.trim(),feedback=!hidden?session.results[id]:undefined;return <button key={id} type="button" aria-label={`第 ${question?.number??index+1} 题，${answered?'已答':'未答'}`} aria-current={index===session.index?'step':undefined} data-answered={answered} data-result={feedback?.correct===true?'correct':feedback?.correct===false?'wrong':undefined} disabled={busy} onClick={()=>{move(index);setAnswerSheet(false);}}>{index+1}</button>;})}</div></div>
    </Modal>
    {current&&<QuestionShare key={current.id} question={current} open={sharing} onOpenChange={setSharing} hideAnswers={hidden}/>}
    <Modal open={confirmHandIn} onOpenChange={setConfirmHandIn} title="确认交卷" description={`还有 ${unanswered} 题未答，可以返回补答，或保留未答题继续交卷。`}><p>当前已填写但尚未确认的答案，会在交卷时统一确认。未答题单独列出。</p><div className="modal-footer"><Button onClick={()=>setConfirmHandIn(false)}>返回补答</Button><Button variant="primary" disabled={busy||!!error} onClick={()=>void handIn()}>仍然交卷</Button></div></Modal>
    <Modal open={answerConsent} onOpenChange={value=>{if(!value)answerPreference(false);}} title="开启单题后台参考答案" description="沿用当前 AI 助手 服务，只处理当前打开且缺答案的题目。" error={answerError}><p>将发送本题题干、选项和共同材料，不发送你的作答，也不提前生成整套答案。生成结果缓存为「AI 参考答案」，已有原文、补充或人工答案保留。</p><p>后续打开缺答案的题目会按此设置后台生成。仍可作答、跳题；练习确认答案后或模拟考试交卷后才显示结果。可在更多设置中关闭。</p><div className="modal-footer"><Button onClick={()=>answerPreference(false)}>暂不开启</Button><Button variant="primary" onClick={()=>{answerPreference(true);void ensureAnswer(liveQuestion?.answerGeneration?.state==='failed');}}>同意并开启</Button></div></Modal>
    <Modal open={feedbackConsent} onOpenChange={open=>{if(!busy)setFeedbackConsent(open);}} title="请求 AI 点评" description="将题目、参考要点和你的作答发送给 AI 助手，会产生 API 费用。" error={error}><p>点评仅用于对照复习，不自动改变自评结果。当前答案先保存，再请求点评。</p><div className="modal-footer"><Button disabled={busy} onClick={()=>setFeedbackConsent(false)}>取消</Button><Button variant="primary" disabled={busy} onClick={()=>void action('original-feedback',{questionId:current?.id,confirmed:true}).then(ok=>{if(ok)setFeedbackConsent(false);})}>同意发送并点评</Button></div></Modal>
    <Modal open={variantConsent} onOpenChange={open=>{if(!busy)setVariantConsent(open);}} title="追加本轮 AI 自编变式" description="将当前原题、参考答案与解析发送给 AI 助手，会产生 API 费用。" error={variantError||error}><p>生成至多 {remainingVariants} 道 AI 自编变式，并追加到当前轮次。已有答案、位置和模式保留；AI 题目与解析需要核对。</p><div className="modal-footer"><Button disabled={busy} onClick={()=>setVariantConsent(false)}>取消</Button><Button variant="primary" disabled={busy||!canGenerate} onClick={()=>void generateVariants()}>同意发送并追加</Button></div></Modal>
    <Modal open={!!archived} onOpenChange={open=>{if(!open)setHistory(null);}} title="历史原题轮次" description="只读快照，保留当时的题目与作答。" wide>{archived?.questions.map(q=>{const r=archived.session.results[q.id],show=!hidden&&(archived.session.mode==='memorize'||(archived.session.mode==='exam'?archived.session.submitted:!!r));return <section key={q.id}><h3>{q.section} · 第 {q.number} 题</h3>{q.context&&<Markdown text={q.context}/>}<Markdown text={q.prompt}/>{q.options.map(o=><p key={o.label}>{o.label}. {o.text}</p>)}<p>{archived.session.mode==='memorize'?'背题浏览 · 无作答判定':`我的作答：${archived.session.answers[q.id]||'未答'}`}</p>{show&&<>{archived.session.mode!=='memorize'&&<p>{r?.correct===true?'正确':r?.correct===false?'需巩固':'待核对'} · {provenance[q.answerSource]}</p>}<Markdown text={q.answer}/><>{(q.explanationSource==='ai'||q.answerSource==='ai')&&<p className="muted small">AI 补充解析</p>}<Markdown text={q.explanation}/></><Sources question={q} onSource={onSource}/></>}</section>;})}</Modal>
  </section>;
}
