// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExtractedContent } from './extracted-content';
import type { Material } from '@/lib/types';
import { chineseExamInfo } from '@/lib/content';

let root: Root;
let container: HTMLDivElement;
const material: Material = { id: 'material-1', courseId: 'probability', name: '课程讲义.pdf', mime: 'application/pdf', size: 1024, fixture: null, chapter: '第一章', status: 'ready', excluded: false, origin: 'local', createdAt: new Date(0).toISOString() };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: null, running: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('explains what extracted text enables instead of only describing OCR mechanics', async () => {
  await act(async () => root.render(<ExtractedContent material={material} onComplete={async () => undefined} onViewPage={() => undefined}/>));
  expect(container.textContent).toContain('后续才能用于生成复习材料和练习');
  expect(container.textContent).toContain('公式和图表请对照原文');
});

it('keeps the whole paper in one reader with collapsed pages and answer navigation', async () => {
  const pages = Array.from({ length: 11 }, (_, index) => ({ page: index + 1, text: index === 0 ? '第一篇原文' : index === 4 ? '第二篇原文结尾\n6. 下列关于文章的说法' : index === 8 ? '【1~5】参考答案\n【6~9】参考答案' : `第 ${index + 1} 页内容`, method: 'pdf-text', state: 'extracted', warnings: [] }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { state: 'complete', pageCount: 11, durationMs: 1000, updatedAt: '', pages }, running: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  await act(async () => root.render(<ExtractedContent material={{ ...material, name: chineseExamInfo['2024-new-i'].name }} onComplete={async () => undefined} onViewPage={() => undefined}/>));
  expect(container.querySelectorAll('.exam-reading-page')).toHaveLength(0);
  expect(container.querySelector('.exam-reading-landmarks')?.textContent).toContain('第 6–9 题');
  expect(container.querySelectorAll('.exam-reading-landmarks button:not(.exam-reading-more)')).toHaveLength(6);
  const more = container.querySelector('.exam-reading-more') as HTMLButtonElement;
  expect(more.textContent).toContain('其余 2 个入口及 11 页内容');
  await act(async () => more.click());
  expect(container.querySelectorAll('.exam-reading-landmarks button:not(.exam-reading-more)')).toHaveLength(8);
  expect(container.querySelectorAll('.exam-reading-page')).toHaveLength(11);
  expect(container.querySelector('.exam-reading-page')?.hasAttribute('open')).toBe(false);
  expect(container.textContent).toContain('第一篇原文');
  expect(container.textContent).toContain('6. 下列关于文章的说法');
  expect(container.textContent).toContain('【6~9】参考答案');
  expect(more.getAttribute('aria-expanded')).toBe('true');
  await act(async () => more.click());
  expect(container.querySelectorAll('.exam-reading-page')).toHaveLength(0);
});

it('shows whole Word questions and continues unprocessed source ranges without renumbering', async () => {
  const word={...material,name:'题目.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
  const result={state:'partial',pageCount:4,sourceCount:93,durationMs:100,updatedAt:'',continuation:{startSource:1,hasMore:true,nextSource:5},pages:['单选题','1.选择正确的选项。','A.甲 B.乙','C.丙 D.丁'].map((text,index)=>({page:index+1,text,method:'docx-text',state:'extracted',warnings:[]}))};
  const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>new Response(JSON.stringify({result:{...result,...(init?.method==='POST'?{continuation:{startSource:1,hasMore:false}}:{})},running:false}),{status:200}));vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<ExtractedContent material={word} onComplete={async()=>undefined} onViewPage={()=>undefined}/>));
  expect(container.querySelector('.extraction-group')?.textContent).toContain('A.甲 B.乙');
  expect(container.querySelector('.extraction-group')?.textContent).toContain('C.丙 D.丁');
  expect(container.textContent).toContain('第 5 段');expect(container.textContent).toContain('第 93 段');
  const next=[...container.querySelectorAll('button')].find(button=>button.textContent?.includes('继续处理'));expect(next).toBeTruthy();
  await act(async()=>next!.click());expect(fetcher.mock.calls.at(-1)?.[1]?.body).toBe(JSON.stringify({continue:true}));
});

it('lets the reader select the introductory raw content after defaulting to a complete question',async()=>{
  const pages=['导读：背景材料','单选题','1.选择正确选项。','A.甲 B.乙'].map((text,index)=>({page:index+1,text,method:'docx-text',state:'extracted',warnings:[]}));
  vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({result:{state:'complete',pageCount:4,durationMs:1,updatedAt:'',pages},running:false}),{status:200}));
  await act(async()=>root.render(<ExtractedContent material={{...material,name:'题目.docx'}} onComplete={async()=>undefined} onViewPage={()=>undefined}/>));
  await act(async()=>{const select=container.querySelector('select')!;select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.querySelector('.extraction-group')?.textContent).toContain('导读：背景材料');
});

it('reads all complete Word groups in source order with extraction tools collapsed',async()=>{
  const pages=['导读：背景材料','单选题','1.选择正确选项。','A.甲 B.乙','C.丙 D.丁','2.选择第二题答案。','A.一 B.二'].map((text,index)=>({page:index+1,text,method:'docx-text',state:'extracted',warnings:[]}));
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({result:{state:'complete',pageCount:7,durationMs:1,updatedAt:'',pages},running:false}),{status:200}));
  vi.stubGlobal('fetch',fetcher);
  const onViewPage=vi.fn();
  await act(async()=>root.render(<ExtractedContent material={{...material,name:'题目.docx'}} readingMode onComplete={async()=>undefined} onViewPage={onViewPage}/>));
  const body=container.querySelector('.extraction-reading-body')!;
  const groups=[...body.querySelectorAll('.extraction-group')];
  expect(groups).toHaveLength(4);
  expect(groups[0].textContent).toContain('导读：背景材料');
  expect(groups[2].textContent).toContain('A.甲 B.乙');
  expect(groups[2].textContent).toContain('C.丙 D.丁');
  expect(groups[3].textContent).toContain('A.一 B.二');
  expect(groups[2].querySelectorAll('details .extraction-text')).toHaveLength(3);
  expect(container.querySelector('.extraction-reading-tools')?.hasAttribute('open')).toBe(false);
  expect(container.querySelector('.extraction-reading-tools>summary')?.textContent).toBe('文字提取与原文位置');
  expect(fetcher.mock.calls).toHaveLength(1);
  await act(async()=>groups[2].querySelector('button')!.click());
  expect(onViewPage).toHaveBeenCalledWith(3);
});

it('opens the current real exam page for reading and keeps other pages expandable',async()=>{
  const pages=Array.from({length:11},(_,index)=>({page:index+1,text:`第 ${index+1} 页真实内容`,method:'pdf-text',state:'extracted',warnings:[]}));
  vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({result:{state:'complete',pageCount:11,durationMs:1,updatedAt:'',pages},running:false}),{status:200}));
  const onViewPage=vi.fn();
  await act(async()=>root.render(<ExtractedContent material={{...material,name:chineseExamInfo['2024-new-i'].name}} initialPage={5} readingMode onComplete={async()=>undefined} onViewPage={onViewPage}/>));
  const sections=[...container.querySelectorAll<HTMLDetailsElement>('.exam-reading-page')];
  expect(sections).toHaveLength(11);
  expect(sections.filter(section=>section.open)).toEqual([sections[4]]);
  expect(sections[4].querySelector('.extraction-text')?.textContent).toBe('第 5 页真实内容');
  await act(async()=>sections[4].querySelector('button')!.click());
  expect(onViewPage).toHaveBeenCalledWith(5);
});

it('keeps incomplete source warnings and continuation outside collapsed reading tools',async()=>{
  const result={state:'partial',pageCount:1,sourceCount:93,durationMs:1,updatedAt:'',continuation:{startSource:1,hasMore:true,nextSource:2},pages:[{page:1,text:'已提取的完整段落',method:'text',state:'extracted',warnings:[]}]};
  const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>new Response(JSON.stringify({result:{...result,...(init?.method==='POST'?{continuation:{startSource:1,hasMore:false}}:{})},running:false}),{status:200}));
  vi.stubGlobal('fetch',fetcher);
  await act(async()=>root.render(<ExtractedContent material={{...material,name:'讲义.txt',mime:'text/plain'}} readingMode onComplete={async()=>undefined} onViewPage={()=>undefined}/>));
  const warning=container.querySelector('.extraction-warning')!;
  expect(warning.closest('.extraction-reading-tools')).toBeNull();
  expect(container.textContent).toContain('第 2 段');
  expect(container.textContent).toContain('第 93 段');
  expect(fetcher.mock.calls).toHaveLength(1);
  const next=[...container.querySelectorAll('button')].find(button=>button.textContent?.includes('继续处理'))!;
  expect(next.closest('.extraction-reading-tools')).toBeNull();
  await act(async()=>next.click());
  expect(fetcher.mock.calls.at(-1)?.[1]?.body).toBe(JSON.stringify({continue:true}));
});

it('keeps missing-text extraction available without automatically starting it in reading mode',async()=>{
  const fetcher=vi.mocked(fetch);
  await act(async()=>root.render(<ExtractedContent material={material} readingMode onComplete={async()=>undefined} onViewPage={()=>undefined}/>));
  expect(container.querySelector('.extraction-reading-tools')?.hasAttribute('open')).toBe(true);
  const extract=[...container.querySelectorAll('button')].find(button=>button.textContent?.includes('提取文字'))!;
  expect(extract.disabled).toBe(false);
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(fetcher.mock.calls[0][1]?.method).not.toBe('POST');
  await act(async()=>extract.click());
  expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe('POST');
});

it('retains the selected PDF source text and page selection in reading mode',async()=>{
  const pages=Array.from({length:2},(_,index)=>({page:index+1,text:`课程讲义第 ${index+1} 页`,method:'pdf-text',state:'extracted',warnings:[]}));
  vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({result:{state:'complete',pageCount:2,durationMs:1,updatedAt:'',pages},running:false}),{status:200}));
  await act(async()=>root.render(<ExtractedContent material={material} initialPage={2} readingMode onComplete={async()=>undefined} onViewPage={()=>undefined}/>));
  expect(container.querySelector('.extraction-reading-body .extraction-text')?.textContent).toBe('课程讲义第 2 页');
  await act(async()=>{const select=container.querySelector('select')!;select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.querySelector('.extraction-reading-body .extraction-text')?.textContent).toBe('课程讲义第 1 页');
});
