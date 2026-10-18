'use client';
import { useEffect, useRef, useState } from 'react';
import type { OriginalSessionData, OriginalSessionState } from '@/lib/question-bank-types';

export async function originalRequest(body:object):Promise<OriginalSessionData> {
  const response=await fetch('/api/practice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'操作失败，请保留本页答案后重试。');return result;
}

export function useOriginalSession(initial:OriginalSessionData,courseId:string) {
  const [data,setData]=useState(initial),[error,setError]=useState(''),[message,setMessage]=useState('已保存到本机数据库'),[busy,setBusy]=useState(false);
  const [referenceError,setReferenceError]=useState('');
  const latest=useRef(initial),saved=useRef(JSON.stringify(initial.session)),queue=useRef(Promise.resolve(true)),blocked=useRef(false),active=useRef(true),operation=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const pendingReference=useRef<OriginalSessionData|null>(null);
  async function syncReferences(snapshot:OriginalSessionData){
    const result=await originalRequest({action:'original-refresh-answers',courseId,scope:snapshot.scope,revision:snapshot.revision,session:snapshot.session});
    if(latest.current.scope!==snapshot.scope||latest.current.session.roundId!==snapshot.session.roundId)throw new Error('当前轮次已变化，参考答案未覆盖本页作答。');
    const localChanged=JSON.stringify(latest.current.session)!==JSON.stringify(snapshot.session);
    latest.current={...result,session:localChanged?latest.current.session:result.session};saved.current=JSON.stringify(result.session);pendingReference.current=null;
    if(active.current){setReferenceError('');setData(latest.current);setMessage(localChanged?'等待保存…':'已保存到本机数据库');}
  }
  function update(change:(session:OriginalSessionState)=>OriginalSessionState){const next={...latest.current,session:change(latest.current.session)};latest.current=next;setData(next);setMessage('等待保存…');}
  function flush():Promise<boolean>{
    clearTimeout(timer.current);
    queue.current=queue.current.then(async()=>{
      if(blocked.current)return false;
      if(pendingReference.current){
        try{await syncReferences(pendingReference.current);}catch(e){if(active.current)setReferenceError(e instanceof Error?e.message:'参考答案暂时无法同步。');return false;}
      }
      while(saved.current!==JSON.stringify(latest.current.session)) {
        const snapshot=latest.current,content=JSON.stringify(snapshot.session);
        try {
          if(active.current)setMessage('正在保存到本机…');
          const result=await originalRequest({action:'original-save',courseId,scope:snapshot.scope,revision:snapshot.revision,session:snapshot.session});
          saved.current=content;latest.current={...latest.current,revision:result.revision,rounds:result.rounds};
          if(active.current){setData(latest.current);setMessage('已保存到本机数据库');}
        }catch(e){blocked.current=true;if(active.current)setError(e instanceof Error?e.message:'保存失败，请保留本页答案。');return false;}
      }
      return true;
    });return queue.current;
  }
  const flushRef=useRef(flush);flushRef.current=flush;
  async function refreshAnswers(){
    if(operation.current||blocked.current||!active.current||latest.current.session.finished)return false;
    if(!await flushRef.current()||operation.current)return false;
    queue.current=queue.current.then(async()=>{
      const snapshot=latest.current;
      pendingReference.current=snapshot;
      try{
        await syncReferences(snapshot);return true;
      }catch(e){if(active.current)setReferenceError(e instanceof Error?e.message:'参考答案暂时无法同步。');return false;}
    });return queue.current;
  }
  function retry(){blocked.current=false;setError('');return flushRef.current();}
  async function action(actionName:string,extra:object={}) {
    if(operation.current)return false;
    operation.current=true;
    setBusy(true);
    try {
      if(!await flushRef.current())return false;
      const snapshot=latest.current;
      const result=await originalRequest({action:actionName,courseId,scope:snapshot.scope,revision:snapshot.revision,...extra});
      if(!active.current)return false;
      if(latest.current.scope!==snapshot.scope||latest.current.revision!==snapshot.revision||JSON.stringify(latest.current.session)!==JSON.stringify(snapshot.session))throw Error('操作期间本轮作答已变化，请保留本页答案并刷新后继续。');
      latest.current=result;saved.current=JSON.stringify(result.session);blocked.current=false;setData(result);setError('');setMessage('已保存到本机数据库');return true;
    }catch(e){if(active.current)setError(e instanceof Error?e.message:'操作失败，请重试。');return false;}finally{operation.current=false;if(active.current)setBusy(false);}
  }
  useEffect(()=>{if(JSON.stringify(data.session)===saved.current||blocked.current)return;timer.current=setTimeout(()=>void flushRef.current(),350);return()=>clearTimeout(timer.current);},[data.session]);
  useEffect(()=>{
    active.current=true;
    const warn=(e:BeforeUnloadEvent)=>{if(JSON.stringify(latest.current.session)!==saved.current){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',warn);
    return()=>{active.current=false;clearTimeout(timer.current);void flushRef.current();window.removeEventListener('beforeunload',warn);};
  },[]);
  return {data,update,flush,retry,action,refreshAnswers,referenceError,error,message,busy,isSaved:!error&&JSON.stringify(data.session)===saved.current};
}
