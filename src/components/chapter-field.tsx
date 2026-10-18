'use client';
import { useState } from 'react';
import { Button } from './ui/button';

export function ChapterField({chapter,chapters,disabled,onSave}:{chapter:string;chapters:string[];disabled:boolean;onSave:(value:string)=>Promise<void>}) {
  const [value,setValue]=useState(chapter);
  return <form onSubmit={e=>{e.preventDefault();if(value.trim()&&value.trim()!==chapter)void onSave(value.trim());}}>
    <label className="form-field">章节归属<input list="course-chapters" value={value} maxLength={50} disabled={disabled} onChange={e=>setValue(e.target.value)} placeholder="输入这门课的章节名称"/></label>
    <datalist id="course-chapters">{[...new Set(['未分类',...chapters])].map(name=><option key={name} value={name}/>)}</datalist>
    <Button size="sm" type="submit" disabled={disabled||!value.trim()||value.trim()===chapter}>保存章节</Button>
  </form>;
}
