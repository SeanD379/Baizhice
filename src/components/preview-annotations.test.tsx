// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { previewQuoteRange, previewRegionText } from './preview-annotations';
import { PreviewAnnotations } from './preview-annotations';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

it('drags the reading viewport in the grab direction and stops after releasing the pointer',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  const viewport=document.createElement('div'),page=document.createElement('section'),mount=document.createElement('div');
  viewport.className='material-preview-scroll';viewport.style.overflowX='auto';viewport.style.overflowY='auto';viewport.append(page);document.body.append(viewport,mount);
  Object.defineProperties(viewport,{scrollHeight:{value:1600},clientHeight:{value:500},scrollWidth:{value:1200},clientWidth:{value:600}});
  viewport.scrollTop=200;viewport.scrollLeft=100;
  const root=createRoot(mount);
  try{
    await act(async()=>root.render(<PreviewAnnotations root={page} page={1} mode="pan"/>));
    const handle=page.querySelector('.file-annotation-pan');expect(handle).toBeTruthy();
    const pointer=async(type:string,screenX:number,screenY:number,button=0)=>act(async()=>{handle!.dispatchEvent(new MouseEvent(type,{bubbles:true,button,screenX,screenY}));});
    await pointer('pointerdown',300,300);await pointer('pointermove',260,240);
    expect(viewport.scrollLeft).toBe(140);expect(viewport.scrollTop).toBe(260);
    await pointer('pointerup',260,240);await pointer('pointermove',200,180);
    expect(viewport.scrollLeft).toBe(140);expect(viewport.scrollTop).toBe(260);
    await pointer('pointerdown',260,240,2);await pointer('pointermove',200,180);
    expect(viewport.scrollTop).toBe(260);
  }finally{await act(async()=>root.unmount());viewport.remove();mount.remove();vi.unstubAllGlobals();}
});

it('uses nearby text to anchor the selected occurrence of a repeated quotation',()=>{
  const root=document.createElement('section');root.innerHTML='<p>先前定义：相同摘录，条件甲。</p><p>当前定义：相同摘录，条件乙。</p>';
  const range=previewQuoteRange(root,{quote:'相同摘录',prefix:'当前定义：',suffix:'，条件乙。'});
  expect(range?.startContainer.parentElement).toBe(root.lastElementChild);expect(range?.toString()).toBe('相同摘录');
  expect(previewQuoteRange(root,{quote:'相同摘录',prefix:'',suffix:''})).toBeNull();
});
it('locates a quote across formatted text nodes without counting annotation labels',()=>{
  const root=document.createElement('section');root.innerHTML='<p>前文：概念 <b>甲\n 成立</b> 时可以解释关系乙。后文</p><div class="file-annotation-ui">概念甲成立时可以解释关系乙。</div>';
  const range=previewQuoteRange(root,{quote:'概念甲成立时可以解释关系乙。',prefix:'前文：',suffix:'后文'});
  expect(range?.toString().replace(/\s/g,'')).toBe('概念甲成立时可以解释关系乙。');expect(range?.startContainer.parentElement?.tagName).toBe('P');
});
it('does not relocate an old quote when its surrounding text has changed',()=>{
  const root=document.createElement('section');root.textContent='新版：同一概念用于不同条件。';
  expect(previewQuoteRange(root,{quote:'同一概念',prefix:'旧版：',suffix:''})).toBeNull();
});
it('clips a region to the characters inside it rather than taking an intersecting paragraph',()=>{
  const root=document.createElement('section');root.innerHTML='<p>上一题这一题下一题</p><div class="file-annotation-ui">批注</div>';
  vi.spyOn(root,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:90,height:20} as DOMRect);
  const create=document.createRange.bind(document);
  const mock=vi.spyOn(document,'createRange').mockImplementation(()=>{const range=create();Object.defineProperty(range,'getClientRects',{value:()=>[{left:range.startOffset*10,right:range.endOffset*10,top:0,bottom:20,width:(range.endOffset-range.startOffset)*10,height:20}]});return range;});
  try {expect(previewRegionText(root,{x:1/3,y:0,width:1/3,height:1})).toBe('这一题');} finally {mock.mockRestore();}
});
