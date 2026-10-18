'use client';
import { useEffect,useRef,useState,type RefObject } from 'react';
export function useLibrarySplit(courseId:string) {
  const [share,setShare]=useState(0.35),previous=useRef(0.35),key=`lms.library.split:${courseId}`;
  useEffect(()=>{try{previous.current=Number(localStorage.getItem(`${key}:expanded`)??'0.35')||0.35;const saved=Number(localStorage.getItem(key)??'0.35');if(Number.isFinite(saved)&&saved>=0&&saved<=1){setShare(saved);if(saved>0&&saved<1)previous.current=saved;}}catch{/* The splitter also works without browser storage. */}},[key]);
  function resize(value:number){const next=Math.min(1,Math.max(0,value));if(next>0&&next<1)previous.current=next;setShare(next);try{localStorage.setItem(key,String(next));localStorage.setItem(`${key}:expanded`,String(previous.current));}catch{/* Preserve this visit's layout. */}}
  const restore=()=>resize(previous.current);
  return {share,resize,restore};
}
export function LibrarySplitter({scope,share,onResize,onRestore}:{scope:RefObject<HTMLDivElement|null>;share:number;onResize:(value:number)=>void;onRestore:()=>void}) {
  const dragging=useRef(false);
  return <div className="library-pane-separator" role="separator" aria-label="调整文件夹和文件区域高度" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share*100)} aria-controls="library-master-folders" tabIndex={0} title={share===0?'文件夹已收起，拖动或按 Enter 恢复':share===1?'文件已收起，拖动或按 Enter 恢复':'上下拖动调整，Home / End 收起，Enter 恢复'} onKeyDown={event=>{if(!['ArrowUp','ArrowDown','Home','End','Enter'].includes(event.key))return;event.preventDefault();if(event.key==='Enter'){if(share===0||share===1)onRestore();else onResize(0);}else onResize(event.key==='Home'?0:event.key==='End'?1:Math.round((share+(event.key==='ArrowUp'?-0.05:0.05))*100)/100);}} onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();dragging.current=true;event.currentTarget.setPointerCapture?.(event.pointerId);}} onPointerMove={event=>{if(!dragging.current||!scope.current)return;const bounds=scope.current.getBoundingClientRect(),footer=scope.current.querySelector('.library-master-footer')?.getBoundingClientRect().height??60;const next=(event.clientY-bounds.top)/Math.max(1,bounds.height-footer-12);onResize(next<0.08?0:next>0.92?1:next);}} onPointerUp={event=>{dragging.current=false;event.currentTarget.releasePointerCapture?.(event.pointerId);}} onPointerCancel={()=>{dragging.current=false;}}><span/><small>{share===0?'拖动恢复文件夹':share===1?'拖动恢复文件':''}</small></div>;
}
