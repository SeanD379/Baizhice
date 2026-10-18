'use client';
import { useEffect, useRef, useState } from 'react';
import type { OriginalQuestion } from '@/lib/question-bank-types';
import { originalKindNames } from '@/lib/question-bank-types';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { Markdown } from './markdown';

function ShareContent({question,includeAnswer}:{question:OriginalQuestion;includeAnswer:boolean}) {
  return <div className="question-share-card">
    <header><span>学习资料 · {question.origin==='variant'?'AI 自编变式':'原题'}</span><small>{originalKindNames[question.kind]} · 第 {question.number} 题</small></header>
    {question.context&&<div className="original-context"><Markdown text={question.context}/></div>}
    <Markdown text={question.prompt}/>
    {question.media?.map((media,i)=><figure key={i}><img src={media.url} alt={media.label}/><figcaption>{media.label}</figcaption></figure>)}
    {question.options.map(option=><div className="question-share-option" key={option.label}><b>{option.label}.</b><Markdown text={option.text}/></div>)}
    {includeAnswer&&<section className="question-share-solution"><h3>参考答案{question.answerSource==='ai'?'（AI 参考）':''}</h3><Markdown text={question.answer||'尚无可用参考答案，待核对。'}/>{question.explanation&&<><h3>解析</h3><Markdown text={question.explanation}/></>}{!!question.criteria.length&&<><h3>评分要点</h3><ul>{question.criteria.map((item,i)=><li key={i}>{item}</li>)}</ul></>}{!!question.warnings.length&&<p>{question.warnings.join(' ')}</p>}</section>}
  </div>;
}

export function QuestionShare({question,open,onOpenChange,hideAnswers}:{question:OriginalQuestion;open:boolean;onOpenChange:(open:boolean)=>void;hideAnswers:boolean}) {
  const [includeAnswer,setIncludeAnswer]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[working,setWorking]=useState(false),[fallback,setFallback]=useState(false);
  const card=useRef<HTMLDivElement>(null);
  useEffect(()=>{setIncludeAnswer(false);setError('');setStatus('');setFallback(false);},[open,question.id]);
  const withAnswer=includeAnswer&&!hideAnswers;
  const text=[`学习资料 · ${originalKindNames[question.kind]} · 第 ${question.number} 题`,question.origin==='variant'?'AI 自编变式':'原题',question.context,question.prompt,...question.options.map(option=>`${option.label}. ${option.text}`),...(question.media??[]).map(media=>`[配图：${media.label}]`),...(withAnswer?[`参考答案${question.answerSource==='ai'?'（AI 参考）':''}：${question.answer||'待核对'}`,question.explanation?`解析：${question.explanation}`:'',...question.criteria.map(item=>`评分要点：${item}`),...question.warnings]:[])].filter(Boolean).join('\n\n');
  async function copy(){
    setError('');setStatus('');
    try{await navigator.clipboard.writeText(text);setFallback(false);setStatus('题目文字已复制');}
    catch{setFallback(true);setError('复制失败，可以在下方选取文字后手动复制。');}
  }
  async function saveImage(){
    if(!card.current||working)return;
    const node=card.current.querySelector<HTMLElement>('.question-share-card');if(!node)return;
    setWorking(true);setError('');setStatus('');
    try{
      await document.fonts?.ready;
      await Promise.all([...node.querySelectorAll('img')].map(img=>img.decode()));
      const {toBlob}=await import('html-to-image');
      const blob=await toBlob(node,{pixelRatio:2,backgroundColor:'#ffffff'});
      if(!blob)throw Error('图片生成失败，请重试。');
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`学习资料-第${question.number.replace(/[^\w\u4e00-\u9fff-]/g,'_')}题.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setStatus('题目图片已生成并开始下载');
    }catch{setError('图片生成失败，请重试；也可以复制题目文字。');}finally{setWorking(false);}
  }
  return <Modal open={open} onOpenChange={value=>{if(!working)onOpenChange(value);}} title="分享本题" description="复制题目文字，或保存包含公式和配图的题目图片。" error={error} wide>
    <label className="practice-setting-check"><span>附带答案与解析{hideAnswers&&<small>模拟考试交卷后可用</small>}</span><input type="checkbox" aria-label="附带答案与解析" checked={withAnswer} disabled={hideAnswers||working} onChange={event=>setIncludeAnswer(event.target.checked)}/></label>
    <div className="question-share-preview" aria-label="分享预览"><ShareContent question={question} includeAnswer={withAnswer}/></div>
    <div ref={card} className="question-share-export" aria-hidden="true"><ShareContent question={question} includeAnswer={withAnswer}/></div>
    {fallback&&<textarea className="question-share-text" aria-label="可手动复制的题目文字" readOnly value={text} onFocus={event=>event.target.select()}/>}
    <p role="status">{status}</p>
    <div className="modal-footer"><Button disabled={working} onClick={()=>void copy()}>复制文字</Button><Button variant="primary" disabled={working} onClick={()=>void saveImage()}>{working?'正在生成图片…':'保存题目图片'}</Button></div>
  </Modal>;
}
