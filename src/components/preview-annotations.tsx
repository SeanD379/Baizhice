'use client';
import { useEffect,useState,useRef,type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnnotationPresetPicker } from './annotation-preset-picker';
import type { AnnotationAnchor,MaterialAnnotation,PreviewSelection } from '@/lib/material-study';
type Rect=AnnotationAnchor['rects'][number];
export type PreviewAnnotationProps={mode?:'browse'|'pan'|'text'|'region';annotations?:(MaterialAnnotation&{number?:number})[];pending?:(PreviewSelection&{number?:number});onPick?:(selection:PreviewSelection)=>void;onAnnotationOpen?:(annotation:MaterialAnnotation)=>void;focusAnchor?:AnnotationAnchor;highlightedId?:string;onExit?:()=>void;composer?:{instruction:string;busy:string;warning?:string;error?:string;onChange:(value:string)=>void;onCancel:()=>void;onSave:()=>void;onDetails:()=>void}};
const clamp=(value:number)=>Math.min(1,Math.max(0,value));
const layerCss='.file-annotation-ui{position:absolute;inset:0;z-index:8;pointer-events:none;font:12px Arial,sans-serif}.file-annotation-ui svg{position:absolute;width:100%;height:100%;inset:0;overflow:visible}.file-annotation-ui button{position:absolute;pointer-events:auto;width:24px;height:24px;padding:0;border:2px solid white;border-radius:50%;background:#1c5cff;color:white;cursor:pointer;box-shadow:0 1px 5px #0003;font:600 12px Arial,sans-serif}.file-annotation-ui button:focus-visible{outline:2px solid #1c5cff;outline-offset:2px}.file-annotation-region{position:absolute;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none}';
const composerCss='.file-annotation-composer{position:fixed;z-index:60;box-sizing:border-box;width:min(320px,calc(100vw - 24px));padding:14px;border:1px solid var(--theme-border);border-radius:10px;background:var(--theme-surface);color:var(--theme-text);box-shadow:0 8px 28px #0002;font:13px/1.6 Arial,"Microsoft YaHei",sans-serif}.file-annotation-composer header,.file-annotation-composer footer{display:flex;align-items:center;justify-content:space-between;gap:8px}.file-annotation-composer header{margin-bottom:10px}.file-annotation-composer strong{font-size:13px}.file-annotation-composer button{padding:5px 9px;border:1px solid var(--theme-border);border-radius:5px;background:var(--theme-surface);color:var(--theme-muted);font:inherit;cursor:pointer}.file-annotation-composer header button{border:0;padding:0 4px;font-size:19px}.file-annotation-composer textarea{box-sizing:border-box;width:100%;min-height:84px;padding:9px 10px;border:1px solid var(--theme-border);border-radius:6px;resize:vertical;color:var(--theme-text);background:var(--theme-surface);font:inherit;line-height:1.7}.file-annotation-composer :is(button,textarea):focus-visible{outline:2px solid var(--theme-focus);outline-offset:1px}.file-annotation-composer p{margin:7px 0 10px;font-size:11px;color:var(--theme-muted)}.file-annotation-composer p.is-warning{color:var(--theme-warning)}.file-annotation-composer p.is-error{color:var(--theme-danger)}.file-annotation-composer footer button:first-child{padding-left:0;border:0;color:var(--theme-muted);font-size:11px}.file-annotation-composer footer button:last-child{border-color:var(--theme-action);background:var(--theme-action);color:var(--theme-action-text)}.file-annotation-composer button:disabled{opacity:.45;cursor:default}';
export function previewQuoteRange(root:HTMLElement,anchor:Pick<AnnotationAnchor,'quote'|'prefix'|'suffix'>) {
  const document=root.ownerDocument,walker=document.createTreeWalker(root,4);const nodes:Text[]=[];let text='',node=walker.nextNode();
  while(node){if(!(node.parentElement?.closest('.file-annotation-ui,style,script'))){nodes.push(node as Text);text+=node.textContent??'';}node=walker.nextNode();}
  const compact=anchor.quote.replace(/\s/g,'');if(!compact)return null;
  const positions=[...text.matchAll(/\S/g)].map(match=>match.index),normalized=text.replace(/\s/g,''),prefix=(anchor.prefix??'').replace(/\s/g,''),suffix=(anchor.suffix??'').replace(/\s/g,'');const matches:number[]=[];
  let start=normalized.indexOf(compact);
  while(start>=0){if((!prefix||normalized.slice(Math.max(0,start-prefix.length),start)===prefix)&&(!suffix||normalized.slice(start+compact.length,start+compact.length+suffix.length)===suffix))matches.push(start);start=normalized.indexOf(compact,start+1);}
  if(matches.length!==1)return null;start=matches[0];
  const from=positions[start],to=positions[start+compact.length-1]+1;let offset=0;const range=document.createRange();
  for(const item of nodes){const end=offset+item.length;if(from>=offset&&from<end)range.setStart(item,from-offset);if(to>offset&&to<=end){range.setEnd(item,to-offset);break;}offset=end;}
  return range;
}
function relativeRects(root:HTMLElement,range:Range):Rect[]{const bounds=root.getBoundingClientRect();if(!bounds.width||!bounds.height)return [];return [...range.getClientRects()].filter(rect=>rect.width>0&&rect.height>0).map(rect=>{const x=clamp((rect.left-bounds.left)/bounds.width),y=clamp((rect.top-bounds.top)/bounds.height);return {x,y,width:Math.min(1-x,rect.width/bounds.width),height:Math.min(1-y,rect.height/bounds.height)};}).filter(rect=>rect.width>0&&rect.height>0);}
export function previewRegionText(root:HTMLElement,rect:Rect){
  const bounds=root.getBoundingClientRect(),left=bounds.left+rect.x*bounds.width,top=bounds.top+rect.y*bounds.height,right=left+rect.width*bounds.width,bottom=top+rect.height*bounds.height;
  const walker=root.ownerDocument.createTreeWalker(root,4),range=root.ownerDocument.createRange();let node=walker.nextNode(),text='',lastBlock:Element|null=null;
  while(node&&text.length<16000){
    if(!node.parentElement?.closest('.file-annotation-ui,style,script')){
      range.selectNodeContents(node);const boxes=[...range.getClientRects()].filter(box=>box.width&&box.height);
      if(boxes.some(box=>box.right>left&&box.left<right&&box.bottom>top&&box.top<bottom)){
        let fragment='';
        if(boxes.every(box=>box.left>=left&&box.right<=right&&box.top>=top&&box.bottom<=bottom))fragment=node.textContent??'';
        else {let offset=0;for(const character of node.textContent??''){range.setStart(node,offset);offset+=character.length;range.setEnd(node,offset);if([...range.getClientRects()].some(box=>box.width>0&&box.height>0&&(box.left+box.right)/2>=left&&(box.left+box.right)/2<=right&&(box.top+box.bottom)/2>=top&&(box.top+box.bottom)/2<=bottom))fragment+=character;}}
        if(fragment){const block=node.parentElement?.closest('p,li,tr,td,h1,h2,h3,pre')??null;text+=(text&&block!==lastBlock?'\n':'')+fragment;lastBlock=block;}
      }
    }
    node=walker.nextNode();
  }
  return text.trim().slice(0,16000);
}
async function cropRegion(root:HTMLElement,rect:Rect) {
  let source=root.querySelector('canvas') as HTMLCanvasElement|null;
  if(!source){const {toCanvas}=await import('html-to-image');source=await toCanvas(root,{pixelRatio:1,backgroundColor:'#ffffff',filter:node=>!(node instanceof root.ownerDocument.defaultView!.Element&&node.closest('.file-annotation-ui'))});}
  const width=Math.max(1,Math.round(source.width*rect.width)),height=Math.max(1,Math.round(source.height*rect.height)),scale=Math.min(1,1600/Math.max(width,height));
  const output=root.ownerDocument.createElement('canvas');output.width=Math.max(1,Math.round(width*scale));output.height=Math.max(1,Math.round(height*scale));output.getContext('2d')!.drawImage(source,rect.x*source.width,rect.y*source.height,width,height,0,0,output.width,output.height);return output.toDataURL('image/png');
}
export function PreviewAnnotations({root,page,paragraph=false,mode='browse',annotations=[],pending,onPick,onAnnotationOpen,focusAnchor,highlightedId,onExit,composer}:PreviewAnnotationProps&{root:HTMLElement|null;page:number;paragraph?:boolean}) {
  const [tick,setTick]=useState(0),[drawing,setDrawing]=useState<Rect|null>(null),start=useRef<{x:number;y:number}|null>(null),captureEpoch=useRef(0),capturing=useRef(false),popup=useRef<HTMLFormElement>(null);
  const [position,setPosition]=useState({left:12,top:12});
  const panStart=useRef<{pointerId:number;x:number;y:number;horizontal:HTMLElement|null;vertical:HTMLElement|null;left:number;top:number}|null>(null);
  useEffect(()=>{panStart.current=null;},[root,page,mode]);
  function beginPan(event:PointerEvent<HTMLDivElement>){
    if(event.button!==0||!root||panStart.current)return;
    let horizontal:HTMLElement|null=null,vertical:HTMLElement|null=null;
    for(let element:HTMLElement|null=root;element;element=element.parentElement??element.ownerDocument.defaultView?.frameElement as HTMLElement|null){
      const style=element.ownerDocument.defaultView?.getComputedStyle(element);
      const frameViewport=element===element.ownerDocument.scrollingElement&&!!element.ownerDocument.defaultView?.frameElement;
      if(!horizontal&&(/(auto|scroll)/.test(style?.overflowX||style?.overflow||'')||frameViewport)&&element.scrollWidth>element.clientWidth)horizontal=element;
      if(!vertical&&/(auto|scroll)/.test(style?.overflowY||style?.overflow||'')&&element.scrollHeight>element.clientHeight)vertical=element;
      if(element.classList.contains('material-preview-scroll'))break;
    }
    event.preventDefault();
    // Screen coordinates stay stable when scrolling moves a Word preview iframe.
    panStart.current={pointerId:event.pointerId,x:event.screenX,y:event.screenY,horizontal,vertical,left:horizontal?.scrollLeft??0,top:vertical?.scrollTop??0};
    event.currentTarget.dataset.dragging='true';event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function movePan(event:PointerEvent<HTMLDivElement>){
    const from=panStart.current;if(!from||event.pointerId!==from.pointerId)return;
    if(from.horizontal)from.horizontal.scrollLeft=from.left+from.x-event.screenX;
    if(from.vertical)from.vertical.scrollTop=from.top+from.y-event.screenY;
  }
  function stopPan(event:PointerEvent<HTMLDivElement>){
    panStart.current=null;delete event.currentTarget.dataset.dragging;
    if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  useEffect(()=>{captureEpoch.current++;capturing.current=false;start.current=null;setDrawing(null);},[root,page,mode]);
  useEffect(()=>{if(!composer||!popup.current)return;const observer=new ResizeObserver(()=>setTick(value=>value+1));observer.observe(popup.current);return()=>observer.disconnect();},[!!composer,root,page]);
  useEffect(()=>{captureEpoch.current++;capturing.current=false;start.current=null;setDrawing(null);},[root,page,mode]);
  useEffect(()=>{if(!composer||!popup.current)return;const observer=new ResizeObserver(()=>setTick(value=>value+1));observer.observe(popup.current);return()=>observer.disconnect();},[!!composer,root,page]);
  useEffect(()=>{if(!root)return;const previous=root.style.position;root.style.position='relative';const measure=()=>setTick(value=>value+1),observer=new ResizeObserver(measure);observer.observe(root);const documents=[...new Set([document,root.ownerDocument])];documents.forEach(doc=>doc.addEventListener('scroll',measure,true));window.addEventListener('resize',measure);return()=>{observer.disconnect();documents.forEach(doc=>doc.removeEventListener('scroll',measure,true));window.removeEventListener('resize',measure);root.style.position=previous;captureEpoch.current++;};},[root]);
  useEffect(()=>{if(!root||!onExit)return;const documents=[...new Set([document,root.ownerDocument])],exit=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&(mode!=='browse'||composer)){event.preventDefault();start.current=null;captureEpoch.current++;capturing.current=false;setDrawing(null);onExit();}};documents.forEach(doc=>doc.addEventListener('keydown',exit));return()=>documents.forEach(doc=>doc.removeEventListener('keydown',exit));},[root,mode,onExit,composer]);
  useEffect(()=>{if(!root||mode!=='text'||!onPick)return;const capture=()=>{const selection=root.ownerDocument.getSelection();if(!selection?.rangeCount||!selection.anchorNode||!selection.focusNode||!root.contains(selection.anchorNode)||!root.contains(selection.focusNode)||selection.anchorNode.parentElement?.closest('.file-annotation-ui'))return;const quote=selection.toString().trim();if(!quote)return;const range=selection.getRangeAt(0),before=range.cloneRange(),after=range.cloneRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);after.selectNodeContents(root);after.setStart(range.endContainer,range.endOffset);const context=(range:Range)=>{const fragment=range.cloneContents();fragment.querySelectorAll('.file-annotation-ui,style,script').forEach(node=>node.remove());return fragment.textContent??'';},prefix=context(before).slice(-32),suffix=context(after).slice(0,32);onPick({kind:'text',page:paragraph?undefined:page,displayPage:page,quote,prefix,suffix,rects:relativeRects(root,range)});};root.addEventListener('mouseup',capture);return()=>root.removeEventListener('mouseup',capture);},[root,page,paragraph,mode,onPick]);
  useEffect(()=>{if(!root||!focusAnchor)return;const range=previewQuoteRange(root,focusAnchor),target=highlightedId?root.querySelector<SVGRectElement>('rect[data-highlighted="true"]'):range?.startContainer.parentElement;target?.scrollIntoView?.({block:'center',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});setTick(value=>value+1);},[root,focusAnchor,highlightedId]);
  useEffect(()=>{
    if(!root||!pending||!composer)return;const rect=pending.rects.at(-1);if(!rect)return;
    const bounds=root.getBoundingClientRect();let left=bounds.left+rect.x*bounds.width,top=bounds.top+rect.y*bounds.height,bottom=top+rect.height*bounds.height,view=root.ownerDocument.defaultView;
    while(view?.frameElement){const frame=view.frameElement.getBoundingClientRect();left+=frame.left;top+=frame.top;bottom+=frame.top;view=view.frameElement.ownerDocument.defaultView;}
    const width=popup.current?.offsetWidth??320,height=popup.current?.offsetHeight??220;
    const next={left:Math.max(12,Math.min(window.innerWidth-width-12,left)),top:Math.max(12,Math.min(window.innerHeight-height-12,bottom+10+height<window.innerHeight?bottom+10:top-height-10))};
    setPosition(old=>old.left===next.left&&old.top===next.top?old:next);
  },[root,pending,!!composer,tick,composer?.busy,composer?.warning,composer?.error]);
  if(!root)return null;
  void tick;
  const marks=annotations.map((annotation,index)=>{const range=annotation.anchor.kind==='text'?previewQuoteRange(root,annotation.anchor):null;const visible=paragraph?!!range||annotation.anchor.kind==='region'&&annotation.anchor.displayPage===page:annotation.anchor.page===page;return {annotation,number:annotation.number??index+1,rects:range?relativeRects(root,range):annotation.anchor.rects,visible};}).filter(mark=>mark.visible&&mark.rects.length);
  const pendingRange=pending?.kind==='text'?previewQuoteRange(root,pending):null,pendingVisible=pending&&(paragraph?!!pendingRange||pending.displayPage===page:pending.page===page),pendingRects=pendingRange?relativeRects(root,pendingRange):pending?.rects??[];
  return <>{createPortal(<div className="file-annotation-ui"><style>{layerCss}</style>{mode==='pan'&&<><style>{'.file-annotation-pan{position:absolute;inset:0;pointer-events:auto;cursor:grab;touch-action:none;user-select:none}.file-annotation-pan[data-dragging=true]{cursor:grabbing}'}</style><div className="file-annotation-pan" onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={stopPan} onPointerCancel={stopPan} onLostPointerCapture={stopPan}/></>}<svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">{marks.flatMap(mark=>mark.rects.map((rect,index)=><rect key={`${mark.annotation.id}:${index}`} {...rect} data-highlighted={mark.annotation.id===highlightedId?'true':undefined} fill={mark.annotation.id===highlightedId?'rgba(28,92,255,.2)':'rgba(28,92,255,.06)'} stroke={mark.annotation.id===highlightedId?'#1c5cff':'rgba(28,92,255,.3)'} strokeWidth={mark.annotation.id===highlightedId?'.003':'.0015'}/>))}{pendingVisible&&pendingRects.map((rect,index)=><rect key={`pending:${index}`} {...rect} fill="rgba(28,92,255,.12)" stroke="#1c5cff" strokeWidth=".0015"/>)}{drawing&&<rect {...drawing} fill="rgba(28,92,255,.1)" stroke="#1c5cff" strokeWidth=".002"/>}</svg>{marks.map(mark=><button key={mark.annotation.id} type="button" aria-label={`批注 ${mark.number}：${mark.annotation.instruction}`} style={{left:`${mark.rects[0].x*100}%`,top:`${mark.rects[0].y*100}%`}} onClick={()=>onAnnotationOpen?.(mark.annotation)}>{mark.number}</button>)}{pendingVisible&&pendingRects[0]&&<button type="button" disabled aria-label={`正在编写批注 ${pending?.number??annotations.length+1}`} style={{left:`${pendingRects[0].x*100}%`,top:`${pendingRects[0].y*100}%`}}>{pending?.number??annotations.length+1}</button>}{mode==='region'&&<div className="file-annotation-region" onPointerDown={event=>{if(event.button!==0||capturing.current)return;event.preventDefault();const bounds=root.getBoundingClientRect();start.current={x:clamp((event.clientX-bounds.left)/bounds.width),y:clamp((event.clientY-bounds.top)/bounds.height)};event.currentTarget.setPointerCapture?.(event.pointerId);}} onPointerMove={event=>{if(!start.current)return;const bounds=root.getBoundingClientRect(),x=clamp((event.clientX-bounds.left)/bounds.width),y=clamp((event.clientY-bounds.top)/bounds.height);setDrawing({x:Math.min(x,start.current.x),y:Math.min(y,start.current.y),width:Math.abs(x-start.current.x),height:Math.abs(y-start.current.y)});}} onPointerUp={event=>{
    event.currentTarget.releasePointerCapture?.(event.pointerId);const bounds=root.getBoundingClientRect(),from=start.current,now={x:clamp((event.clientX-bounds.left)/bounds.width),y:clamp((event.clientY-bounds.top)/bounds.height)};start.current=null;if(!from)return;
    const rect={x:Math.min(now.x,from.x),y:Math.min(now.y,from.y),width:Math.abs(now.x-from.x),height:Math.abs(now.y-from.y)};if(rect.width<.005||rect.height<.005){setDrawing(null);return;}
    const capture=++captureEpoch.current;capturing.current=true;setDrawing(rect);const selection:PreviewSelection={kind:'region',page:paragraph?undefined:page,displayPage:page,quote:previewRegionText(root,rect),prefix:'',suffix:'',rects:[rect]};
    void cropRegion(root,rect).then(image=>{if(capture===captureEpoch.current)onPick?.({...selection,image});}).catch(()=>{if(capture===captureEpoch.current)onPick?.(selection);}).finally(()=>{if(capture===captureEpoch.current){capturing.current=false;setDrawing(null);}});
  }} onPointerCancel={()=>{start.current=null;setDrawing(null);}}/>}</div>,root)}{pendingVisible&&composer&&createPortal(<><style>{composerCss}</style><form ref={popup} className="file-annotation-composer" style={position} aria-label={`编写批注 ${pending?.number??annotations.length+1}`} onSubmit={event=>{event.preventDefault();composer.onSave();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();composer.onCancel();}else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();if(!composer.busy&&composer.instruction.trim())composer.onSave();}}}>
    <header><strong>批注 {pending?.number??annotations.length+1}</strong><button type="button" aria-label="取消批注" disabled={composer.busy==='保存批注'} onClick={composer.onCancel}>×</button></header><AnnotationPresetPicker instruction={composer.instruction} disabled={!!composer.busy} onChange={composer.onChange} autoFocus/><p role="status" className={composer.error?'is-error':composer.warning?'is-warning':''}>{composer.error||composer.busy||composer.warning||(pending?.kind==='region'?(pending.image?(pending.quote.trim()?'已选区域 · 图片与文字':'已选区域 · 图片'):'截图未成功，仅保留选区文字'):'已选原文文字')}</p><footer><button type="button" onClick={composer.onDetails}>查看识别详情</button><button type="submit" disabled={!!composer.busy||!composer.instruction.trim()}>保存批注</button></footer>
  </form></>,document.fullscreenElement??document.body)}</>;
}
