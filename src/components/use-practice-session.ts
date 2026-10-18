'use client';
import { useEffect, useRef, useState } from 'react';
import { blankSession, validateSession, type PracticeSession } from '@/lib/practice-session';
import type { PracticeData } from '@/lib/practice-store';

export function usePracticeSession(data:PracticeData,courseId:string,versionId:string) {
  const [session,setSession]=useState<PracticeSession>(()=>{
    if(data.session)return data.session;
    if(!data.set)try {
      const legacy=`study-practice-v1:${courseId}:${versionId}:${data.questions.map(q=>q.reference.materialId+q.id).join(',')}`;
      const text=localStorage.getItem(legacy);if(text)return validateSession(JSON.parse(text),data.questions);
    }catch{/* Old browser data stays untouched if it cannot be migrated. */}
    return blankSession();
  });
  const [saveMessage,setSaveMessage]=useState('记录保存在本机数据库'),[saveError,setSaveError]=useState('');
  const latest=useRef(session),saved=useRef(JSON.stringify(data.session??blankSession())),revision=useRef(data.revision);
  const queue=useRef(Promise.resolve(true)),blocked=useRef(false),active=useRef(true),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  latest.current=session;
  function flush(){
    clearTimeout(timer.current);
    queue.current=queue.current.then(async()=>{
      if(blocked.current)return false;
      while(saved.current!==JSON.stringify(latest.current)) {
      const content=JSON.stringify(latest.current);
      try {
        if(active.current)setSaveMessage('正在保存到本机…');
        const response=await fetch('/api/practice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',courseId,versionId,scope:data.scope,revision:revision.current,session:JSON.parse(content),...(data.dailyTaskId?{dailyTaskId:data.dailyTaskId}:{})})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'记录保存失败。');
        revision.current=result.revision;saved.current=content;
        if(active.current)setSaveMessage(JSON.stringify(latest.current)===content?'已保存到本机数据库':'还有改动正在保存…');
      }catch(e){blocked.current=true;if(active.current)setSaveError(e instanceof Error?e.message:'保存失败，请保留本页答案。');return false;}
      }
      return true;
    });
    return queue.current;
  }
  const flushRef=useRef(flush);flushRef.current=flush;
  function retrySave(){
    clearTimeout(timer.current);
    blocked.current=false;setSaveError('');
    return flushRef.current();
  }
  useEffect(()=>{
    if(JSON.stringify(session)===saved.current)return;
    setSaveMessage('等待保存…');timer.current=setTimeout(()=>void flushRef.current(),350);
    return()=>clearTimeout(timer.current);
  },[session]);
  useEffect(()=>{
    active.current=true;
    const warn=(e:BeforeUnloadEvent)=>{if(JSON.stringify(latest.current)!==saved.current){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',warn);
    return()=>{active.current=false;clearTimeout(timer.current);void flushRef.current();window.removeEventListener('beforeunload',warn);};
  },[]);
  return {session,setSession,saveMessage,saveError,retrySave,flush:()=>flushRef.current(),isSaved:!saveError&&JSON.stringify(session)===saved.current};
}
