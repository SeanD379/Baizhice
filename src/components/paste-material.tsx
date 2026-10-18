'use client';
import { useState } from 'react';
import { Button } from './ui/button';

export function PasteMaterial({disabled,onAdd}:{disabled:boolean;onAdd:(file:File)=>void}) {
  const [title,setTitle]=useState(''),[text,setText]=useState('');
  return <details className="generation-setup"><summary>也可以粘贴课堂笔记或文字</summary>
    <label className="form-field">资料名称<input value={title} maxLength={100} disabled={disabled} placeholder="例如：第二章课堂笔记" onChange={e=>setTitle(e.target.value)}/></label>
    <label className="generation-text-label">资料正文<textarea value={text} maxLength={40000} disabled={disabled} placeholder="粘贴文字，空行分隔段落；请在正文注明来源。" onChange={e=>setText(e.target.value)}/></label>
    <p className="muted small">{text.length} / 40000 字 · 保存为本机文字资料，不会自动发送给 AI。</p>
    <Button disabled={disabled||!title.trim()||!text.trim()} onClick={()=>{onAdd(new File([text],`${title.trim().replace(/[\\/:*?"<>|]/g,'-')}.txt`,{type:'text/plain'}));setTitle('');setText('');}}>加入上传队列</Button>
  </details>;
}
