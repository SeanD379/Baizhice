// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WrongBook } from './wrong-book';
import type { Material } from '@/lib/types';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('shows knowledge and paper mistakes together and opens the exact paper question', async () => {
  const at = '2026-09-27T10:00:00.000Z';
  const material: Material = { id: 'paper-1', courseId: 'course', name: '语文套卷.pdf', mime: 'application/pdf', size: 100, fixture: null, chapter: '历年套卷', status: 'extracted', excluded: false, origin: 'test', createdAt: at };
  const history = { courseName: '语文', entries: [{
    id: 'set-1', version: { id: 'version-1', courseId: 'course', number: 1, title: '提纲', sections: [], sourceIds: [], summary: '', createdAt: at }, createdAt: at,
    model: null, reviewed: true, sourceHash: null, snapshot: 'saved',
    questions: [{ id: 'q1', kind: 'short', topic: '阅读理解', prompt: '概括文章中心思想', answer: '中心思想', explanation: '结合原文', reference: { materialId: 'note-1', name: '笔记.docx', page: 1, snippet: '文章表达了...' } }],
    session: { id: 'session-1', updatedAt: at, state: { mode: 'practice', submitted: false, ids: ['q1'], index: 0, answers: { q1: '旧答案' }, results: { q1: { answer: '旧答案', correct: false } }, finished: false, attempts: [{ id: 'q1', correct: false, at }] } },
  }] };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/practice/history') ? history : { record: { answers: { '3': '我的作答' }, marks: { '3': 'wrong' }, annotations: {} }, revision: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  const openPaper = vi.fn(), openKnowledge = vi.fn();
  await act(async () => root.render(<WrongBook courseId="course" materials={[material]} onOpenKnowledge={openKnowledge} onOpenPaper={openPaper}/>));
  await vi.waitFor(() => expect(container.textContent).toContain('概括文章中心思想'));
  expect(container.textContent).toContain('语文套卷.pdf · 第 3 题');
  expect(container.querySelector('.training-section-heading>span')?.textContent).toBe('2 题待巩固');
  await act(async () => (container.querySelector('.wrong-book-paper') as HTMLButtonElement).click());
  expect(openPaper).toHaveBeenCalledWith('paper-1', 3);
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.wrong-book-filters button')].find(button => button.textContent?.includes('知识点'))!.click());
  expect(container.querySelector('.wrong-book-paper')).toBeNull();
  expect(container.textContent).toContain('概括文章中心思想');
});

const originalQuestion={id:'original-word-q',materialId:'word-bank',number:'12',section:'第二部分',kind:'single' as const,prompt:'原题 Word 完整题干',context:'这是跨页原题共同材料',options:[{label:'A',text:'完整选项甲'},{label:'B',text:'完整选项乙'}],sources:[{name:'学科练习.docx',page:18,snippet:'实际原文依据',location:'paragraph' as const}],topics:['原文知识点'],answer:'B',answerSource:'supplement' as const,explanation:'对应补充答案的解析',criteria:['说明论证'],warnings:[],origin:'original' as const};
const at='2026-10-01T01:00:00.000Z';
const originalMistake={question:originalQuestion,answer:'A',at,context:'knowledge'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
const emptyHistory={courseName:'课程',entries:[]};

it('renders complete original Word mistakes without any legacy material version or PDF and opens the exact original ID',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>json(url.includes('source=original')?{entries:[],mistakes:[originalMistake]}:emptyHistory)));
  const openOriginal=vi.fn();await act(async()=>root.render(<WrongBook courseId="course" materials={[]} onOpenKnowledge={()=>{}} onOpenPaper={()=>{}} onOpenOriginal={openOriginal}/>));
  expect(container.textContent).toContain('原题 Word 完整题干');expect(container.textContent).toContain('这是跨页原题共同材料');expect(container.textContent).toContain('完整选项甲');expect(container.textContent).toContain('我的作答');expect(container.textContent).toContain('对应补充答案的解析');expect(container.textContent).toContain('补充');
  expect(container.querySelector('a[href="/api/files/word-bank"]')?.textContent).toContain('第 18 段');expect(container.querySelector('.training-section-heading>span')?.textContent).toBe('1 题待巩固');
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent?.includes('回到原题练习'))!.click());expect(openOriginal).toHaveBeenCalledWith('word-bank','original-word-q','knowledge');
});

it('keeps original history successes visible when legacy history fails',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('source=original')?json({entries:[],mistakes:[originalMistake]}):json({error:'旧练习记录读取失败'},503)));
  await act(async()=>root.render(<WrongBook courseId="course" materials={[]} onOpenKnowledge={()=>{}} onOpenPaper={()=>{}}/>));expect(container.textContent).toContain('原题 Word 完整题干');expect(container.textContent).toContain('旧练习记录读取失败');
});

it('keeps successful individual legacy paper records when another paper and original history fail',async()=>{
  const papers=['good','bad'].map(id=>({id,courseId:'course',name:`${id}.pdf`,mime:'application/pdf',size:10,fixture:null,chapter:'历年套卷',status:'ready',excluded:false,origin:'test',createdAt:at}));
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('materialId=good')?json({record:{answers:{'4':'保存的答案'},marks:{'4':'wrong'},annotations:{}}}):url.startsWith('/api/practice/history')?json(emptyHistory):json({error:'部分来源读取失败'},503)));
  await act(async()=>root.render(<WrongBook courseId="course" materials={papers} onOpenKnowledge={()=>{}} onOpenPaper={()=>{}}/>));expect(container.textContent).toContain('good.pdf · 第 4 题');expect(container.querySelector('.training-section-heading>span')?.textContent).toBe('1 题待巩固');expect(container.textContent).toContain('部分来源读取失败');
});

it('filters original knowledge and paper mistakes by their saved context',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>json(url.includes('source=original')?{entries:[],mistakes:[originalMistake,{...originalMistake,context:'paper',question:{...originalQuestion,id:'paper-word-q',materialId:'paper-word',prompt:'Word 套卷原题'}}]}:emptyHistory)));
  await act(async()=>root.render(<WrongBook courseId="course" materials={[]} onOpenKnowledge={()=>{}} onOpenPaper={()=>{}}/>));
  await act(async()=>[...container.querySelectorAll('.wrong-book-filters button')].find(b=>b.textContent?.startsWith('套卷'))!.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(container.textContent).toContain('Word 套卷原题');expect(container.textContent).not.toContain('原题 Word 完整题干');
});

it('respects the service latest self-correction rather than resurrecting archived wrong answers',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>json(url.includes('source=original')?{entries:[{id:'new',at,context:'knowledge',questions:[originalQuestion],session:{results:{'original-word-q':{answer:'B',correct:true,source:'self'}}}},{id:'old',at:'2026-09-30T01:00:00.000Z',context:'knowledge',questions:[originalQuestion],session:{results:{'original-word-q':{answer:'A',correct:false,source:'supplement'}}}}],mistakes:[]}:emptyHistory)));
  await act(async()=>root.render(<WrongBook courseId="course" materials={[]} onOpenKnowledge={()=>{}} onOpenPaper={()=>{}}/>));expect(container.textContent).toContain('还没有待巩固的题');expect(container.textContent).not.toContain('原题 Word 完整题干');
});

it('shows manual latest assessment provenance while retaining the saved reference answer source',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>json(url.includes('source=original')?{entries:[{id:'latest',at,context:'knowledge',questions:[originalQuestion],session:{results:{'original-word-q':{answer:'A',correct:false,source:'self'}}}}],mistakes:[originalMistake]}:emptyHistory)));
  await act(async()=>root.render(<WrongBook courseId="course" materials={[]} onOpenKnowledge={()=>{}} onOpenPaper={()=>{}}/>));expect(container.textContent).toContain('答案来源：补充');expect(container.textContent).toContain('本次判定：我的自评');
});

it('uses the latest judgment provenance when navigating an older wrong round updates its save time',async()=>{
  const judgedAt='2026-10-01T02:00:00.000Z';
  const entries=[{id:'reopened',at:'2026-10-01T03:00:00.000Z',context:'knowledge',questions:[originalQuestion],session:{results:{[originalQuestion.id]:{answer:'旧的错误作答',correct:false,source:'self',judgedAt:at}}}},{id:'latest-judgment',at:judgedAt,context:'knowledge',questions:[originalQuestion],session:{results:{[originalQuestion.id]:{answer:'最新的错误作答',correct:false,source:'ai',judgedAt}}}}];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>json(url.includes('source=original')?{entries,mistakes:[{...originalMistake,answer:'最新的错误作答',at:judgedAt}]}:emptyHistory)));
  await act(async()=>root.render(<WrongBook courseId="course" materials={[]} onOpenKnowledge={()=>{}} onOpenPaper={()=>{}}/>));
  expect(container.textContent).toContain('最新的错误作答');expect(container.textContent).toContain('本次判定：AI参考');expect(container.textContent).not.toContain('本次判定：我的自评');
});
