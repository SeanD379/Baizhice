// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OriginalPracticeCenter } from './original-practice-center';
import { ThemeProvider, ThemeToggle } from './ui-theme';
import type { Material } from '@/lib/types';
import type { OriginalQuestion, OriginalSessionData, QuestionBankData } from '@/lib/question-bank-types';
vi.mock('./react-bits/CountUp',()=>({default:({to}:{to:number})=><span>{to}</span>}));
vi.mock('./react-bits/SpotlightCard',()=>({default:({children,className}:{children:React.ReactNode;className?:string})=><div className={className}>{children}</div>}));

const q:OriginalQuestion={id:'q1',materialId:'m',number:'7',section:'第一部分',kind:'multiple',prompt:'选择完整的选项',context:'共同材料：完整段落',options:[{label:'A',text:'选项一'},{label:'B',text:'选项二'},{label:'C',text:'选项三'}],sources:[{page:4,name:'题目.docx',snippet:'绝不能提前显示的答案摘录',location:'paragraph'}],topics:['概念'],answer:'AC',answerSource:'ai',explanation:'答案解析秘密',criteria:[],warnings:[],origin:'original'};
const materials:Material[]=[{id:'m',courseId:'c',name:'题目.docx',mime:'application/docx',size:20,fixture:null,chapter:'',status:'ready',excluded:false,origin:'upload',createdAt:''}];
const bank:QuestionBankData={id:'b',materialId:'m',name:'题目.docx',sourceHash:'hash',revision:1,state:'ready',questions:[q,{...q,id:'q2',number:'8',kind:'short',prompt:'解释概念',answer:'主观参考',criteria:['完整论述']}],progress:{done:2,total:2},error:'',updatedAt:''};

it('keeps paper preparation compact, defaults to exam, and starts every original question without requiring analysis',async()=>{
  const originals=Array.from({length:52},(_,i)=>({...q,id:`whole-${i}`,number:String(i+1),answer:'',explanation:''}));
  const selectedBank={...bank,state:'raw',questions:[...originals,{...q,id:'q1:variant:old',origin:'variant'}]};
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.startsWith('/api/question-banks'))return response({banks:[selectedBank],configured:false});
    if(url.startsWith('/api/practice-hub'))return response({withheldMaterials:[]});
    const body=JSON.parse(init!.body as string);calls.push(body);return response(stored);
  }));
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context="paper" selectionOnlyOnEntry onStart={()=>{}}/>));
  expect(calls).toHaveLength(0);
  expect(button('开始 52 题').disabled).toBe(false);
  expect((container.querySelector('[aria-label="下一轮模式"]') as HTMLSelectElement).value).toBe('exam');
  expect(container.querySelector('.original-paper-tools')?.getAttribute('open')).toBeNull();
  expect(container.querySelector('.original-paper-structure')?.getAttribute('open')).toBeNull();
  expect(container.textContent).toContain('交卷后');
  await chooseMode('下一轮模式','practice');expect(container.querySelector('.original-mode-hint')?.textContent).toContain('逐题');
  await chooseMode('下一轮模式','memorize');expect(container.querySelector('.original-mode-hint')?.textContent).toContain('直接查看答案');
  await chooseMode('下一轮模式','exam');await click('开始 52 题');
  expect(calls.at(-1)).toMatchObject({action:'original-load',context:'paper',mode:'exam',newRound:true,questionIds:originals.map(v=>v.id)});
});

it.each([false,true])('reads an unread or stale paper explicitly before starting (stale=%s)',async(stale)=>{
  let loaded:QuestionBankData[]=stale?[{...bank,stale:true}]:[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.startsWith('/api/practice-hub'))return response({withheldMaterials:[]});
    if(init?.method==='POST'){const body=JSON.parse(init.body as string);calls.push(body);if(body.action==='prepare')loaded=[bank];}
    return response({banks:loaded,configured:false});
  }));
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context="paper" selectionOnlyOnEntry onStart={()=>{}}/>));
  expect(calls).toHaveLength(0);
  await click(stale?'重新读取试卷':'读取试卷');
  expect(calls).toEqual([{action:'prepare',courseId:'c',materialIds:['m']}]);
  expect(button('开始 2 题').disabled).toBe(false);
});
let root:Root,container:HTMLDivElement,stored:OriginalSessionData,calls:Record<string,unknown>[];
let practiceBack:{label:string;onClick:()=>void}|null=null;
const registerPracticeBack=(action:typeof practiceBack)=>{practiceBack=action;};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
function button(text:string){const buttons=[...document.querySelectorAll('button')],el=buttons.find(el=>el.textContent===text)??buttons.find(el=>el.textContent?.includes(text));if(!el)throw Error('Missing button '+text);return el;}
async function click(text:string){await act(async()=>button(text).click());}
async function render(context:'knowledge'|'paper'='paper'){await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context={context} registerBackAction={registerPracticeBack}/>));}
async function returnToDashboard(){expect(practiceBack?.label).toBe('返回看板');await act(async()=>practiceBack!.onClick());}
async function tick(){await act(async()=>{await vi.advanceTimersByTimeAsync(400);});}
async function chooseMode(label:string,value:string){await act(async()=>{const select=document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});}
async function handInRound(){await click('交卷');if(document.querySelector('[role="dialog"]'))await click('仍然交卷');await tick();}
beforeEach(()=>{
  practiceBack=null;
  localStorage.clear();
  vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);Element.prototype.scrollIntoView=vi.fn();
  container=document.createElement('div');document.body.append(container);root=createRoot(container);calls=[];
  stored={scope:'scope',revision:3,context:'paper',questions:structuredClone(bank.questions),session:{roundId:'round',mode:'exam',ids:['q1','q2'],index:0,answers:{},results:{},submitted:false,finished:false},rounds:[]};
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.startsWith('/api/question-banks'))return response({banks:[bank],configured:true,model:'DeepSeek'});
    const body=JSON.parse(init?.body as string);calls.push(body);
    if(body.action==='original-save'){stored={...stored,revision:stored.revision+1,session:body.session};}
    if(body.action==='original-feedback'){stored={...stored,revision:stored.revision+1,session:{...stored.session,results:{...stored.session.results,q2:{...stored.session.results.q2,feedback:{strengths:['论述完整'],omissions:[],suggestions:[],uncertainty:[]}}}}};}
    return response(stored);
  }));
});

it.each(['single','judge'] as const)('grades %s immediately after a selection and removes the per-question submit action',async(kind)=>{
  stored.session.mode='practice';stored.questions[0]={...q,kind,answer:kind==='single'?'A':'对'};await render('knowledge');
  await act(async()=>{(container.querySelector(`input[value="${kind==='single'?'A':'对'}"]`) as HTMLInputElement).click();});
  expect(container.querySelector('.practice-feedback')?.textContent).toContain('已判为正确');expect(container.textContent).not.toContain('提交本题');await tick();expect(stored.session.results.q1.correct).toBe(true);
});
it('keeps an unconfirmed answer and the active round when the theme changes', async () => {
  document.documentElement.dataset.theme = 'light';
  stored.session.mode = 'practice';
  await act(async () => root.render(<ThemeProvider><ThemeToggle/><OriginalPracticeCenter courseId="c" materials={materials} context="knowledge"/></ThemeProvider>));
  const choice = container.querySelector<HTMLInputElement>('input[value="A"]')!;
  await act(async () => choice.click());
  expect(choice.checked).toBe(true);
  const round = container.querySelector('.original-round');
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="切换到夜间模式"]')!.click());
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(container.querySelector('input[value="A"]')).toBe(choice);
  expect(choice.checked).toBe(true);
  expect(container.querySelector('.original-round')).toBe(round);
  expect(container.querySelector('.practice-feedback')).toBeNull();
  await tick();
  expect(stored.session.answers.q1).toBe('A');
  expect(stored.session.roundId).toBe('round');
});
it('waits for multi-answer confirmation and refuses an empty confirmation',async()=>{
  stored.session.mode='practice';await render('knowledge');expect(button('确认答案').disabled).toBe(true);
  await act(async()=>{(container.querySelector('input[value="A"]') as HTMLInputElement).click();(container.querySelector('input[value="C"]') as HTMLInputElement).click();});
  expect(container.querySelector('.practice-feedback')).toBeNull();await click('确认答案');expect(container.querySelector('.practice-feedback')?.textContent).toContain('已判为正确');
});
it('keeps correctness visible but conceals the answer and explanation when automatic expansion is off',async()=>{
  stored.session.mode='practice';stored.questions[0]={...q,kind:'single',answer:'A'};await render('knowledge');await click('更多');
  await act(async()=>{(document.querySelector('input[aria-label="自动展开解析"]') as HTMLInputElement).click();});await click('关闭更多设置');
  await act(async()=>{(container.querySelector('input[value="A"]') as HTMLInputElement).click();});
  expect(container.querySelector('.practice-feedback')?.textContent).toContain('已判为正确');expect(container.textContent).not.toContain('答案解析秘密');await click('查看答案与解析');expect(container.textContent).toContain('答案解析秘密');
  expect(JSON.parse(localStorage.getItem('lms.practice.preferences')!).autoExpand).toBe(false);
});
it('auto advances only a freshly correct answer after saving and supports staying on the question',async()=>{
  stored.session.mode='practice';stored.questions[0]={...q,kind:'single',answer:'A'};await render('knowledge');await click('更多');
  await act(async()=>{(document.querySelector('input[aria-label="答对自动下一题"]') as HTMLInputElement).click();});await click('关闭更多设置');
  await act(async()=>{(container.querySelector('input[value="A"]') as HTMLInputElement).click();});await tick();expect(button('停留本题')).toBeDefined();
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(container.querySelector('.original-paper h2')?.textContent).toBe('第 8 题');await click('上一题');await act(async()=>{await vi.advanceTimersByTimeAsync(4000);});expect(container.querySelector('.original-paper h2')?.textContent).toBe('第 7 题');
});
it('cancels a pending automatic advance when More is opened',async()=>{
  localStorage.setItem('lms.practice.preferences',JSON.stringify({font:'standard',autoExpand:true,autoNext:true}));stored.session.mode='practice';stored.questions[0]={...q,kind:'single',answer:'A'};await render('knowledge');
  await act(async()=>{(container.querySelector('input[value="A"]') as HTMLInputElement).click();});await tick();await click('更多');await act(async()=>{await vi.advanceTimersByTimeAsync(4000);});expect(container.querySelector('.original-paper h2')?.textContent).toBe('第 7 题');
});
it('does not start a countdown when saving the immediate grade fails',async()=>{
  localStorage.setItem('lms.practice.preferences',JSON.stringify({font:'standard',autoExpand:true,autoNext:true}));stored.session.mode='practice';stored.questions[0]={...q,kind:'single',answer:'A'};const normal=global.fetch;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>JSON.parse(init?.body as string||'{}').action==='original-save'?response({error:'暂时保存失败'},503):normal(url,init));
  await render('knowledge');await act(async()=>{(container.querySelector('input[value="A"]') as HTMLInputElement).click();});await act(async()=>{await vi.advanceTimersByTimeAsync(4000);});expect(container.querySelector('.original-paper h2')?.textContent).toBe('第 7 题');expect(container.textContent).toContain('暂时保存失败');expect(document.body.textContent).not.toContain('停留本题');
});
it('hands in selected but unconfirmed answers and retains existing self-assessment and feedback',async()=>{
  stored.session.mode='practice';stored.session.answers={q1:'A,C',q2:'我的回答'};stored.session.results={q2:{answer:'我的回答',correct:true,source:'self',feedback:{strengths:['论述完整'],omissions:[],suggestions:[],uncertainty:[]}}};
  await render('knowledge');await click('交卷');await tick();expect(stored.session.submitted).toBe(true);expect(stored.session.results.q1.correct).toBe(true);expect(stored.session.results.q2.source).toBe('self');expect(stored.session.results.q2.feedback?.strengths).toEqual(['论述完整']);expect(container.querySelector('.original-round-summary')?.textContent).toContain('未答 0');
});
it('warns about unanswered questions before hand-in without classifying them as wrong',async()=>{
  await render();await click('交卷');expect(stored.session.submitted).toBe(false);expect(document.body.textContent).toContain('还有 2 题未答');await click('仍然交卷');await tick();expect(stored.session.submitted).toBe(true);expect(container.querySelector('.original-round-summary')?.textContent).toContain('未答 2');expect(container.querySelector('.original-round-summary')?.textContent).toContain('错题 0');
});

it('opens a saved results dashboard after hand-in and allows returning to the answers',async()=>{
  stored.session.answers={q1:'AC',q2:'我的解释'};
  await render();await handInRound();
  expect(container.querySelector('[aria-label="本轮答题结果"]')).toBeTruthy();
  expect(container.textContent).toContain('参考得分');
  expect(container.textContent).toContain('正确率');
  expect(container.querySelector('.original-paper')).toBeNull();
  await click('查看全部解析');expect(container.querySelector('.original-paper')).toBeTruthy();
  expect(container.textContent).not.toContain('查看本轮看板');await returnToDashboard();expect(container.querySelector('[aria-label="本轮答题结果"]')).toBeTruthy();
});
it('uses compact multi-select file cards and keeps preparation details collapsed',async()=>{
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context="knowledge" selectionOnlyOnEntry compactRound onStart={()=>{}}/>));
  expect(container.querySelector('header.practice-heading')).toBeNull();
  expect(container.querySelector('.original-file-grid input[type="checkbox"]')).toBeTruthy();
  const details=container.querySelector<HTMLDetailsElement>('.original-material-details');
  expect(details).toBeTruthy();expect(details!.open).toBe(false);
  await act(async()=>{(container.querySelector('.original-file-grid input') as HTMLInputElement).click();});
  expect(button('读取完整原题').disabled).toBe(true);
});
it('restores a finished round directly to its dashboard without replaying celebration',async()=>{
  stored.session={...stored.session,submitted:true,finished:true,answers:{q1:'A',q2:'解释'},results:{q1:{answer:'A',correct:false,source:'ai'},q2:{answer:'解释',correct:null,source:'original'}}};
  await render();expect(container.querySelector('[aria-label="本轮答题结果"]')).toBeTruthy();
  expect(container.querySelector('.practice-result-confetti')).toBeNull();
  await click('复盘错题（1）');expect(container.querySelector('.original-paper h2')?.textContent).toBe('第 7 题');
});
it('keeps answers accessible and does not celebrate a failed hand-in save',async()=>{
  const normal=global.fetch;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
    const body=init?.body?JSON.parse(init.body as string):null;
    if(body?.action==='original-save'&&body.session.submitted)return new Response(JSON.stringify({error:'保存失败'}),{status:500});
    return normal(url,init);
  });
  await render();await handInRound();
  expect(container.querySelector('[aria-label="本轮答题结果"]')).toBeNull();
  expect(container.querySelector('.original-paper')).toBeTruthy();
  expect(container.querySelector('.practice-result-confetti')).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('保存失败');
});
it('preserves an explicit question link inside a finished round',async()=>{
  stored.session={...stored.session,submitted:true,finished:true,answers:{q1:'AC',q2:'解释'},results:{q1:{answer:'AC',correct:true,source:'ai'},q2:{answer:'解释',correct:null,source:'original'}}};
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context="paper" initialScope="scope" initialQuestion="q2"/>));
  await tick();
  expect(container.querySelector('[aria-label="本轮答题结果"]')).toBeNull();
  expect(container.querySelector('.original-paper h2')?.textContent).toBe('第 8 题');
});
it('opens the requested mistake analysis even when automatic expansion is disabled',async()=>{
  localStorage.setItem('lms.practice.preferences',JSON.stringify({autoExpand:false}));
  stored.session={...stored.session,submitted:true,finished:true,answers:{q1:'AC',q2:'解释'},results:{q1:{answer:'AC',correct:true,source:'ai'},q2:{answer:'解释',correct:false,source:'self'}}};
  await render();await click('复盘错题（1）');
  expect(container.querySelector('.original-paper h2')?.textContent).toBe('第 8 题');
  expect(container.querySelector('.original-solution')?.textContent).toContain('【解析】');
});
it('does not replay the celebration after a failed restart and recovery',async()=>{
  stored.session.answers={q1:'AC',q2:'我的解释'};
  await render();await handInRound();
  const normal=global.fetch;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
    if(init?.body&&JSON.parse(init.body as string).action==='original-restart')return response({error:'重开失败'},500);
    return normal(url,init);
  });
  await click('重新练习并保留历史');await click('重试保存');await tick();
  expect(container.querySelector('[aria-label="本轮答题结果"]')).toBeTruthy();
  expect(container.querySelector('.practice-result-confetti')).toBeNull();
});
it('shows memorize answers without creating results and finishes browsing without submitting',async()=>{
  stored.session.mode='memorize';await render('knowledge');expect(container.textContent).toContain('答案解析秘密');expect(container.querySelector('.original-answer')).toBeNull();expect(document.body.textContent).not.toContain('自评正确');await click('下一题');await click('结束背题');await tick();expect(stored.session.results).toEqual({});expect(stored.session.answers).toEqual({});expect(stored.session.finished).toBe(true);expect(stored.session.submitted).toBe(false);
});
it('retains choice text in memorize mode without interactive answer controls',async()=>{
  stored.session.mode='memorize';await render('knowledge');
  const paper=container.querySelector('.original-paper')!;
  for(const option of q.options)expect(paper.textContent).toContain(option.text);
  expect(paper.querySelectorAll('input,textarea')).toHaveLength(0);
  expect(stored.session.answers).toEqual({});expect(stored.session.results).toEqual({});
});
it.each([false,true])('cancels automatic advance when source comparison is opened with a pending save: %s',async(pendingSave)=>{
  localStorage.setItem('lms.practice.preferences',JSON.stringify({font:'standard',autoExpand:true,autoNext:true}));stored.session.mode='practice';stored.questions[0]={...q,kind:'single',answer:'A'};
  const normal=global.fetch;let release:()=>void=()=>{};
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
    if(url.includes('/extraction'))return response({result:null,running:false});
    const body=JSON.parse(init?.body as string||'{}');
    if(pendingSave&&body.action==='original-save')await new Promise<void>(resolve=>{release=resolve;});
    return normal(url,init);
  });
  await render('knowledge');await act(async()=>{(container.querySelector('input[value="A"]') as HTMLInputElement).click();});
  if(!pendingSave)await tick();await click('对照完整原文');
  await act(async()=>{release();await vi.advanceTimersByTimeAsync(4000);});
  expect(container.querySelector('.original-paper h2')?.textContent).toBe('第 7 题');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('完整原文对照');
  expect(container.querySelector('.original-countdown')).toBeNull();
});
it('disables answer sharing before exam hand-in and exposes text and image sharing',async()=>{
  await render();await click('更多');await click('分享本题');const include=document.querySelector('input[aria-label="附带答案与解析"]') as HTMLInputElement;expect(include.disabled).toBe(true);expect(include.checked).toBe(false);expect(document.body.textContent).not.toContain('答案解析秘密');expect(button('复制文字')).toBeDefined();expect(button('保存题目图片')).toBeDefined();
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});

it('explicit Start requests a fresh round with the selected next mode',async()=>{
  stored.session.mode='practice';await render('knowledge');await chooseMode('下一轮模式','exam');await click('开始 2 题');
  expect(calls.filter(c=>c.action==='original-load').at(-1)).toMatchObject({mode:'exam',newRound:true});
});
it('keeps file practice inside one answer board with a connected answer sheet and settings',async()=>{
  stored.context='knowledge';stored.session.mode='practice';
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context="knowledge" initialScope="scope" compactRound/>));
  expect(container.querySelector('.is-answer-board .original-paper')).toBeTruthy();
  expect(container.querySelector('.original-round-status')).toBeNull();
  expect(container.querySelector('.original-setup')).toBeNull();
  expect(container.querySelector('.original-round>.original-question-nav')).toBeNull();
  await click('答题卡');
  const sheet=document.querySelector('[role="dialog"]');expect(sheet?.textContent).toContain('答题卡');expect(sheet?.textContent).not.toContain('答案解析秘密');
  await act(async()=>sheet!.querySelector<HTMLButtonElement>('[aria-label="第 8 题，未答"]')!.click());
  expect(container.querySelector('.original-paper h2')?.textContent).toBe('第 8 题');expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('更多');await click('大');await click('关闭更多设置');
  expect(container.querySelector('.is-answer-board')?.classList.contains('practice-font-large')).toBe(true);
});
it('shows pending and in-flight answer saves in the compact board',async()=>{
  stored.context='knowledge';stored.session.mode='practice';stored.questions[0]={...q,kind:'single',answer:'A'};
  const normal=global.fetch;let finish!:()=>void;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
    const body=init?.body?JSON.parse(init.body as string):null;
    if(body?.action==='original-save')return new Promise<Response>(resolve=>{finish=()=>{stored={...stored,revision:stored.revision+1,session:body.session};resolve(response(stored));};});
    return normal(url,init);
  });
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context="knowledge" initialScope="scope" compactRound/>));
  await act(async()=>container.querySelector<HTMLInputElement>('input[value="A"]')!.click());
  expect(container.querySelector('.answer-board-save')?.textContent).toBe('待保存');
  await tick();expect(container.querySelector('.answer-board-save')?.textContent).toBe('保存中');
  await act(async()=>finish());expect(container.querySelector('.answer-board-save')?.textContent).toBe('已保存');
});
it('replaces duplicate source links with one original-preview action after answering',async()=>{
  const onSource=vi.fn();stored.session.mode='practice';stored.questions[0]={...q,kind:'single',answer:'A'};
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context="knowledge" initialScope="scope" compactRound onSource={onSource}/>));
  expect(container.querySelector('.original-sources')).toBeNull();
  await act(async()=>container.querySelector<HTMLInputElement>('input[value="A"]')!.click());
  expect(container.querySelectorAll('.original-sources a')).toHaveLength(0);
  await click('查看出处');
  expect(onSource).toHaveBeenCalledWith(expect.objectContaining({materialId:'m',name:'题目.docx',page:4,location:'paragraph',snippet:q.sources[0].snippet}));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('collapses objective answer overrides and saves the explicit manual judgment',async()=>{
  stored.session.mode='practice';stored.questions[0]={...q,kind:'single',answer:'A'};
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context="knowledge" initialScope="scope" compactRound/>));
  await act(async()=>container.querySelector<HTMLInputElement>('input[value="A"]')!.click());
  const assessment=container.querySelector<HTMLDetailsElement>('.original-assessment');expect(assessment).toBeTruthy();expect(assessment!.open).toBe(false);expect(assessment!.querySelector('summary')?.textContent).toBe('修改判定');
  await act(async()=>{assessment!.open=true;});await click('还需练习');await tick();
  expect(stored.session.results.q1).toMatchObject({answer:'A',correct:false,source:'self'});
  expect(stored.questions[0].answer).toBe('A');
  expect([...assessment!.querySelectorAll('button')].find(button=>button.textContent==='还需练习')?.getAttribute('aria-pressed')).toBe('true');
});
it('shows explanatory self-assessment for subjective answers and supports pending review',async()=>{
  stored.session.mode='practice';stored.session.index=1;
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context="knowledge" initialScope="scope" compactRound/>));
  await typeInto(container.querySelector('textarea') as HTMLTextAreaElement,'我的论述');await click('确认答案');
  const assessment=container.querySelector<HTMLDetailsElement>('.original-assessment');expect(assessment?.open).toBe(true);expect(assessment?.querySelector('summary')?.textContent).toBe('自评本题');
  expect(assessment?.textContent).toContain('参考答案');await click('暂不确定');await tick();
  expect(stored.session.results.q2).toMatchObject({answer:'我的论述',correct:null,source:'self'});
});
it.each(['paper','knowledge'] as const)('switches current %s drafts after saving and hides current and historical exam feedback',async(context)=>{
  stored.session.mode='practice';stored.session.results={q1:{answer:'A',correct:false,source:'self'}};stored.session.answers={q1:'A'};
  const normal=global.fetch;vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{const body=init?.body?JSON.parse(init.body as string):null;if(body?.action==='original-mode'){calls.push(body);const previous=stored;stored={...stored,revision:stored.revision+1,rounds:[{id:'old-mode',createdAt:'2026-09-30',questions:stored.questions,session:stored.session}],session:{...stored.session,mode:body.mode,results:{}}};expect(body.revision).toBe(previous.revision);return response(stored);}return normal(url,init);});
  await render(context);await click('下一题');await click('更多');await chooseMode('本轮模式','exam');
  expect(stored.session.answers.q1).toBe('A');expect(stored.session.index).toBe(1);expect(calls.find(c=>c.action==='original-mode')?.revision).toBe(4);expect(container.textContent).not.toContain('主观参考');await click('第 1 轮');expect(document.body.textContent).not.toContain('答案解析秘密');
});
it('generates consented current-round variants and retries only append with saved revision and unchanged progress',async()=>{
  stored.context='knowledge';stored.session.mode='practice';let fails=true;
  const variants=Array.from({length:5},(_,i)=>({...q,id:`q1:variant:new-${i}`,origin:'variant' as const,prompt:`变式 ${i}`}));
  const normal=global.fetch;vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{const body=init?.body?JSON.parse(init.body as string):null;
    if(body?.action==='variants'){calls.push(body);return response({bank:{...bank,questions:[...bank.questions,...variants]}});}
    if(body?.action==='original-append'){calls.push(body);if(fails){fails=false;return response({error:'追加暂时失败'},409);}expect(body.revision).toBe(stored.revision);stored={...stored,revision:stored.revision+1,questions:[...stored.questions,...variants],session:{...stored.session,ids:[...stored.session.ids,...variants.map(q=>q.id)]}};return response(stored);}return normal(url,init);
  });
  await render('knowledge');await act(async()=>{(container.querySelector('input[value="A"]') as HTMLInputElement).click();});await click('确认答案');await click('追加本轮 AI 变式');expect(calls.some(c=>c.action==='variants')).toBe(false);expect(document.body.textContent).toContain('AI 助手');expect(document.body.textContent).not.toContain('DeepSeek');await click('同意发送并追加');
  expect(stored.session.answers.q1).toBe('A');expect(container.textContent).toContain('重试追加已生成变式');await click('重试追加已生成变式');expect(calls.filter(c=>c.action==='variants')).toHaveLength(1);expect(calls.filter(c=>c.action==='original-append')).toHaveLength(2);expect(stored.session.ids).toHaveLength(7);expect(stored.session.results.q1).toBeDefined();expect(stored.session.index).toBe(0);expect(stored.session.mode).toBe('practice');expect(container.textContent).toContain('本轮已追加 5 / 5');
  const navigation=container.querySelector('.original-question-nav');for(const index of [1,2,3,4,5])expect(navigation?.textContent).toContain(`AI 变式 ${index}`);
});
it.each(['paper','knowledge'] as const)('does not allow %s round append for an unanswered original',async(context)=>{
  stored.context=context;stored.session.mode=context==='paper'?'exam':'practice';await render(context);
  if(context==='paper')expect([...document.querySelectorAll('button')].some(b=>b.textContent?.includes('追加本轮 AI 变式'))).toBe(false);else expect(button('追加本轮 AI 变式').disabled).toBe(true);
});
it('requests only remaining variant capacity and leaves unrelated bank variants outside the round',async()=>{
  const existing=Array.from({length:3},(_,i)=>({...q,id:`q1:variant:old-${i}`,origin:'variant' as const,prompt:`已有变式 ${i}`})),fresh=Array.from({length:2},(_,i)=>({...q,id:`q1:variant:fresh-${i}`,origin:'variant' as const,prompt:`新变式 ${i}`}));
  stored={...stored,context:'knowledge',questions:[...bank.questions,...existing],session:{...stored.session,mode:'practice',ids:['q1','q2',...existing.map(q=>q.id)],answers:{q1:'A'}}};
  const normal=global.fetch;vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{const body=init?.body?JSON.parse(init.body as string):null;if(url.startsWith('/api/question-banks')){if(body){calls.push(body);return response({bank:{...bank,questions:[...bank.questions,...existing,...fresh]}});}return response({banks:[{...bank,questions:[...bank.questions,...existing]}],configured:true});}if(body?.action==='original-append'){calls.push(body);stored={...stored,questions:[...stored.questions,...fresh],session:{...stored.session,ids:[...stored.session.ids,...fresh.map(q=>q.id)]}};return response(stored);}return normal(url,init);});
  await render('knowledge');await click('追加本轮 AI 变式');await click('同意发送并追加');expect(calls.find(c=>c.action==='variants')).toMatchObject({count:2,confirmed:true});expect(calls.find(c=>c.action==='original-append')?.questionIds).toEqual(fresh.map(q=>q.id));expect(stored.session.ids).toHaveLength(7);
});
it('limits standalone variant selection to five while original selection remains ten',async()=>{
  const variants=Array.from({length:7},(_,i)=>({...q,id:`q1:variant:${i}`,number:String(i+1),origin:'variant' as const}));
  const normal=global.fetch;vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>url.startsWith('/api/question-banks')?response({banks:[{...bank,questions:[...bank.questions,...variants]}],configured:true}):normal(url,init));
  stored.context='knowledge';await render('knowledge');await chooseMode('题目来源','variant');await click('开始 5 题');expect(calls.filter(c=>c.action==='original-load').at(-1)?.questionIds).toEqual(variants.slice(0,5).map(q=>q.id));
});

it('restores a round and hides all answers, explanations and source snippets before whole-paper submission',async()=>{
  await render();expect(container.textContent).toContain('共同材料：完整段落');expect(container.textContent).toContain('第 7 题');
  expect(container.textContent).not.toContain('答案解析秘密');expect(container.textContent).not.toContain('绝不能提前显示');expect(container.querySelector('a[href="/api/files/m"]')).toBeNull();
  await handInRound();await click('查看全部解析');expect(container.textContent).toContain('答案解析秘密');expect(container.textContent).toContain('待自评');expect(container.querySelector('.practice-feedback a[href="/api/files/m"]')).not.toBeNull();
  await tick();expect(stored.session.results.q1.correct).toBeNull();expect(stored.session.results.q2.correct).toBeNull();expect(stored.session.submitted).toBe(true);
});

it('shows sources only in per-question review and hides them again on an unanswered question',async()=>{
  stored.context='knowledge';stored.session.mode='practice';await render('knowledge');expect(container.querySelector('.original-sources')).toBeNull();
  await act(async()=>{(container.querySelector('input[value="A"]') as HTMLInputElement).click();});expect(container.querySelector('.original-sources')).toBeNull();
  await click('确认答案');expect(container.querySelector('.practice-feedback .original-sources')).not.toBeNull();expect(container.querySelector('.original-overview .original-sources')).toBeNull();
  await click('下一题');expect(container.querySelector('.original-sources')).toBeNull();await click('上一题');expect(container.querySelector('.practice-feedback .original-sources')).not.toBeNull();
});

it('does not expose source links from history during a current unsubmitted exam',async()=>{
  const reviewed={...stored.session,mode:'practice' as const,results:{q1:{answer:'A',correct:false,source:'self' as const}}};
  stored.rounds=[{id:'old',createdAt:'2026-09-30',questions:bank.questions,session:reviewed}];await render();await click('第 1 轮');
  expect(document.querySelector('.original-sources')).toBeNull();expect(document.querySelector('a[href="/api/files/m"]')).toBeNull();
});

it('keeps source links for submitted historical practice questions and hides them for unfinished ones',async()=>{
  stored.session.mode='practice';stored.rounds=[{id:'old',createdAt:'2026-09-30',questions:bank.questions,session:{...stored.session,results:{q1:{answer:'A',correct:false,source:'self'}}}}];
  await render('knowledge');await click('第 1 轮');expect(document.querySelectorAll('.original-sources')).toHaveLength(1);
});

it('persists sorted multiple labels and keeps the answer through next and previous navigation',async()=>{
  await render();await act(async()=>{(container.querySelector('input[value="C"]') as HTMLInputElement).click();(container.querySelector('input[value="A"]') as HTMLInputElement).click();});
  await click('下一题');await click('上一题');expect((container.querySelector('input[value="A"]') as HTMLInputElement).checked).toBe(true);await tick();expect(stored.session.answers.q1).toBe('A,C');
});

it('retains unsaved answers and explicitly retries a failed save at the same revision',async()=>{
  await render();const normal=global.fetch;let failed=false;vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{const body=JSON.parse(init.body as string);if(body.action==='original-save'&&!failed){failed=true;calls.push(body);return response({error:'暂时保存失败'},503);}return normal(url,init);});
  await act(async()=>{(container.querySelector('input[value="A"]') as HTMLInputElement).click();});await tick();expect(container.textContent).toContain('暂时保存失败');
  await click('重试保存');expect(stored.session.answers.q1).toBe('A');expect(calls.filter(c=>c.action==='original-save').map(c=>c.revision)).toEqual([3,3]);
});

it('flushes submitted subjective results before feedback and preserves feedback through self-assessment',async()=>{
  await render();await click('下一题');await typeInto(container.querySelector('textarea') as HTMLTextAreaElement,'我的论述');await handInRound();await click('核对答案（1）');await click('请求 AI 点评');await click('同意发送并点评');
  const operations=calls.filter(c=>c.action==='original-save'||c.action==='original-feedback');expect(operations.at(-2)).toMatchObject({action:'original-save',session:{submitted:true,results:{q2:{answer:'我的论述'}}}});expect(operations.at(-1)?.action).toBe('original-feedback');expect(container.textContent).toContain('论述完整');
  await click('自评正确');await tick();expect(stored.session.results.q2.source).toBe('self');expect(stored.session.results.q2.feedback?.strengths).toEqual(['论述完整']);
});

it('uses at most ten filtered knowledge questions and never calls analysis automatically',async()=>{
  const questions=Array.from({length:13},(_,i)=>({...q,id:`k${i}`}));vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{if(url.startsWith('/api/question-banks'))return response({banks:[{...bank,questions}],configured:true,model:'DeepSeek'});const body=JSON.parse(init?.body as string);calls.push(body);return response({...stored,context:'knowledge',questions,session:{...stored.session,ids:body.questionIds,mode:'practice'}});}));
  await render('knowledge');await click('开始 10 题');expect(calls.filter(c=>c.action==='original-load').at(-1)?.questionIds).toHaveLength(10);expect(calls.some(c=>c.action==='analyze')).toBe(false);
});


it('restores a saved round even if fetching the current question banks fails',async()=>{
  const normal=global.fetch;vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>url.startsWith('/api/question-banks')?response({error:'资料暂时不可用'},503):normal(url,init));
  await render();expect(container.textContent).toContain('第 7 题');expect(container.textContent).toContain('资料暂时不可用');
});

it('does not reload or replace the active round when next-round filters change',async()=>{
  await render('knowledge');const before=calls.filter(c=>c.action==='original-load').length;
  await act(async()=>{const select=container.querySelector('select[aria-label="题型"]') as HTMLSelectElement;select.value='short';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.textContent).toContain('第 7 题');expect(calls.filter(c=>c.action==='original-load')).toHaveLength(before);
});

it('keeps the editor disabled while a new group is being loaded to protect the flushed answer',async()=>{
  await render();let resolve!:(r:Response)=>void;const normal=global.fetch;vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{const body=init?.body?JSON.parse(init.body as string):null;if(body?.action==='original-load'&&body.questionIds.length)return new Promise<Response>(r=>{resolve=r;});return normal(url,init);});
  await click('开始 2 题');expect((container.querySelector('input[value="A"]') as HTMLInputElement).matches(':disabled')).toBe(true);
  await act(async()=>resolve(response(stored)));
});

it('starts without model calls and excludes conflict and excluded files from preparation',async()=>{
  const inputs=[...materials,{...materials[0],id:'conflict',status:'review'},{...materials[0],id:'excluded',excluded:true}];
  const normal=global.fetch;vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{if(url.startsWith('/api/question-banks')){if(!init?.body)return response({banks:[],configured:false,model:''});calls.push(JSON.parse(init.body as string));return response({banks:[bank],configured:false,model:''});}return normal(url,init);});
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={inputs} context="knowledge"/>));expect(calls.find(c=>c.action==='prepare')?.materialIds).toEqual(['m']);expect(calls.some(c=>c.action==='analyze')).toBe(false);
});

it('allows selecting later knowledge questions instead of limiting all future rounds to the first ten',async()=>{
  const questions=Array.from({length:13},(_,i)=>({...q,id:`k${i}`,number:String(i+1)}));const normal=global.fetch;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{if(url.startsWith('/api/question-banks'))return response({banks:[{...bank,questions}],configured:true,model:'DeepSeek'});return normal(url,init);});
  await render('knowledge');const input=container.querySelector('input[aria-label="选择第 13 题"]') as HTMLInputElement;expect(input).not.toBeNull();
  await act(async()=>{(container.querySelector('input[aria-label="选择第 1 题"]') as HTMLInputElement).click();input.click();});await click('开始 10 题');
  expect(calls.filter(c=>c.action==='original-load').at(-1)?.questionIds).toContain('k12');expect(calls.filter(c=>c.action==='original-load').at(-1)?.questionIds).not.toContain('k0');
});

it('requests explicit consent before analysis and sends whole selected files only after consent',async()=>{
  stored.session.mode='practice';const normal=global.fetch;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{if(url.startsWith('/api/question-banks')&&init?.body){calls.push(JSON.parse(init.body as string));return response({banks:[bank],configured:true,model:'DeepSeek'});}return normal(url,init);});
  await render('knowledge');await click('整理原题与解析');expect(calls.some(c=>c.action==='analyze')).toBe(false);expect(document.body.textContent).toContain('API 费用');await click('同意发送并整理');
  expect(calls.find(c=>c.action==='analyze')).toMatchObject({confirmed:true,courseId:'c',materialIds:['m']});
});

it('archives a completed round and sends the newly chosen mode for restart',async()=>{
  stored.session={...stored.session,submitted:true,finished:true};await render();
  await act(async()=>{const select=container.querySelector('select[aria-label="重新练习模式"]') as HTMLSelectElement;expect(select).not.toBeNull();select.value='practice';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await click('重新练习并保留历史');expect(calls.find(c=>c.action==='original-restart')).toMatchObject({scope:'scope',revision:3,mode:'practice'});
});

it('serializes changes typed during an in-flight save using the returned revision',async()=>{
  await render();const normal=global.fetch;let finish!:(r:Response)=>void;let pendingBody:Record<string,unknown>|null=null;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{const body=JSON.parse(init?.body as string);if(body.action==='original-save'&&!pendingBody){pendingBody=body;calls.push(body);return new Promise<Response>(resolve=>{finish=resolve;});}return normal(url,init);});
  await act(async()=>{(container.querySelector('input[value="A"]') as HTMLInputElement).click();});await tick();
  await act(async()=>{(container.querySelector('input[value="C"]') as HTMLInputElement).click();});
  await act(async()=>{stored={...stored,revision:4,session:(pendingBody as unknown as {session:OriginalSessionData['session']}).session};finish(response(stored));});
  expect(calls.filter(c=>c.action==='original-save').map(c=>c.revision)).toEqual([3,4]);expect(stored.session.answers.q1).toBe('A,C');
});

it('conceals historical answers while the current exam is unsubmitted',async()=>{
  stored.rounds=[{id:'old',createdAt:'2026-09-30',questions:bank.questions,session:{...stored.session,mode:'practice',submitted:true,finished:true}}];
  await render();await click('第 1 轮');
  expect(document.body.textContent).not.toContain('答案解析秘密');
  expect(document.body.textContent).not.toContain('主观参考');
});

it('adopts authoritative answers and revision when loading the same question group again',async()=>{
  await render();stored={...stored,revision:8,session:{...stored.session,answers:{q1:'C'}}};
  await click('开始 2 题');
  expect((container.querySelector('input[value="C"]') as HTMLInputElement).checked).toBe(true);
  await act(async()=>{(container.querySelector('input[value="A"]') as HTMLInputElement).click();});await tick();
  expect(calls.filter(c=>c.action==='original-save').at(-1)?.revision).toBe(8);
});

it('associates an optional answer file with its selected bank and displays matching status',async()=>{
  stored.session.mode='practice';const normal=global.fetch;vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{if(url.startsWith('/api/question-banks')&&init?.body){calls.push(JSON.parse(init.body as string));return response({bank:{...bank,error:'已匹配 1 题，1 题待核对'},configured:true,model:'DeepSeek'});}return normal(url,init);});
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={[...materials,{...materials[0],id:'answer',name:'答案.docx'}]} context="knowledge"/>));
  await act(async()=>{const select=container.querySelector('select[aria-label="题目.docx 补充答案文件"]') as HTMLSelectElement;expect(select).not.toBeNull();select.value='answer';select.dispatchEvent(new Event('change',{bubbles:true}));});await click('关联补充答案');
  expect(calls.find(c=>c.action==='supplement')).toMatchObject({courseId:'c',bankId:'b',answerMaterialId:'answer'});expect(container.textContent).toContain('已匹配 1 题，1 题待核对');
});

async function typeInto(input:HTMLInputElement|HTMLTextAreaElement,value:string) {
  await act(async()=>{Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
}
function editor(label:string){const el=[...document.querySelectorAll('label')].find(l=>l.textContent?.startsWith(label));if(!el)throw Error('Missing editor '+label);return el.querySelector('textarea,input,select')!;}

it('preserves typed topic separators and option newlines until saving the correction',async()=>{
  stored.session.mode='practice';await render('knowledge');await click('修订题目与答案');
  const topics=editor('知识点（以逗号分隔）') as HTMLInputElement;await typeInto(topics,'概念,');expect(topics.value).toBe('概念,');
  const options=editor('选项（每行') as HTMLTextAreaElement;await typeInto(options,'A. 第一项\n');expect(options.value).toBe('A. 第一项\n');
});

it('splits a selected complete question by blank lines using its bank revision',async()=>{
  stored.session.mode='practice';const normal=global.fetch;vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{if(url.startsWith('/api/question-banks')&&init?.body){calls.push(JSON.parse(init.body as string));return response({bank,configured:true,model:'DeepSeek'});}return normal(url,init);});
  await render('knowledge');await click('修订题目与答案');await typeInto(editor('完整题目之间空一行') as HTMLTextAreaElement,'第一道完整题目\n\n第二道完整题目');await click('拆为独立题目');
  expect(calls.find(c=>c.action==='split')).toMatchObject({courseId:'c',bankId:'b',revision:1,questionId:'q1',parts:['第一道完整题目','第二道完整题目']});
});

it('does not expose correction controls while the saved exam visibility state is loading',async()=>{
  let resolve!:(r:Response)=>void;const normal=global.fetch;vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>url==='/api/practice'?new Promise<Response>(r=>{resolve=r;}):normal(url,init));
  await render();expect([...document.querySelectorAll('button')].some(b=>b.textContent?.includes('修订题目与答案'))).toBe(false);await act(async()=>resolve(response(stored)));
});


it('retries bank reads with the course query and no GET request body',async()=>{
  const normal=global.fetch;let first=true;const reads:{url:string;init?:RequestInit}[]=[];
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{if(url.startsWith('/api/question-banks')){reads.push({url,init});if(first){first=false;return response({error:'暂时不可用'},503);}}return normal(url,init);});
  await render();await click('重试读取');expect(reads.at(-1)?.url).toBe('/api/question-banks?courseId=c');expect(reads.at(-1)?.init?.body).toBeUndefined();
});

it('opens an explicit target in another paper instead of restoring the unrelated latest paper',async()=>{
  const target={...q,id:'target-paper-q',materialId:'target-paper',number:'24',prompt:'目标试卷完整原题'};
  const normal=global.fetch;vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
    if(url.startsWith('/api/question-banks'))return response({banks:[bank,{...bank,id:'target-bank',materialId:'target-paper',questions:[target]}],configured:true,model:'DeepSeek'});
    const body=JSON.parse(init?.body as string);if(body.action==='original-load'&&body.questionIds.includes(target.id)){calls.push(body);return response({...stored,scope:'target-scope',questions:[target],session:{...stored.session,ids:[target.id]}});}return normal(url,init);
  });
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={[...materials,{...materials[0],id:'target-paper',name:'另一份试卷.docx'}]} context="paper" initialMaterialId="target-paper" initialQuestion="target-paper-q"/>));
  expect(container.textContent).toContain('目标试卷完整原题');expect(calls.find(c=>c.action==='original-load')?.questionIds).toEqual(['target-paper-q']);expect(container.textContent).not.toContain('选择完整的选项');
});

it('loads a knowledge group containing the exact targeted ID beyond the first ten questions',async()=>{
  const questions=Array.from({length:23},(_,i)=>({...q,id:`target-${i}`,number:String(i+1),prompt:`完整原题 ${i+1}`}));const normal=global.fetch;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{if(url.startsWith('/api/question-banks'))return response({banks:[{...bank,questions}],configured:true,model:'DeepSeek'});const body=JSON.parse(init?.body as string);if(body.action==='original-load'&&body.questionIds.length){calls.push(body);return response({...stored,scope:'target-knowledge',context:'knowledge',questions:questions.filter(q=>body.questionIds.includes(q.id)),session:{...stored.session,mode:'practice',ids:body.questionIds}});}return normal(url,init);});
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context="knowledge" initialMaterialId="m" initialQuestion="target-17"/>));
  expect(calls.find(c=>c.action==='original-load')?.questionIds).toContain('target-17');expect((calls.find(c=>c.action==='original-load')?.questionIds as string[]).length).toBeLessThanOrEqual(10);expect(container.querySelector('.original-paper h2')?.textContent).toBe('第 18 题');
});

it('opens grouped full Word source only on deliberate post-submission comparison and uses a real document link',async()=>{
  const normal=global.fetch,reads:string[]=[];
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{if(url.includes('/extraction')){reads.push(url);return response({result:{state:'complete',pages:[{page:1,text:'阅读材料第一段全文',method:'docx-text',state:'extracted',warnings:[]},{page:4,text:'7. 原题的完整开头',method:'docx-text',state:'extracted',warnings:[]},{page:5,text:'跨段选项与题目后半部分',method:'docx-text',state:'extracted',warnings:[]},{page:6,text:'原文件参考答案秘密',method:'docx-text',state:'extracted',warnings:[]}]}});}return normal(url,init);});
  await render();expect(reads).toHaveLength(0);expect(document.body.textContent).not.toContain('原文件参考答案秘密');expect(container.querySelector('a[href="/api/files/m"]')).toBeNull();await handInRound();await click('查看全部解析');const link=container.querySelector('a[href="/api/files/m"]');expect(link?.textContent).toContain('第 4 段');
  await click('对照完整原文');expect(reads).toEqual(['/api/materials/m/extraction']);expect(document.body.textContent).toContain('阅读材料第一段全文');expect(document.body.textContent).toContain('跨段选项与题目后半部分');expect(document.body.textContent).toContain('原文件参考答案秘密');expect(document.querySelector('[data-source-current="true"]')?.textContent).toContain('跨段选项与题目后半部分');
});

it.each([{name:'原题.txt',location:'paragraph' as const,label:'第 4 段'},{name:'原题.pptx',location:'slide' as const,label:'第 4 张幻灯片'}])('does not invent a PDF page anchor for $name',async({name,location,label})=>{
  stored.questions=[{...q,sources:[{...q.sources[0],name,location}]}];stored.session.ids=['q1'];await render();await handInRound();await click('查看全部解析');const link=container.querySelector('a[href="/api/files/m"]');expect(link?.textContent).toContain(label);expect(container.querySelector('a[href*="#page="]')).toBeNull();
});
it('generates only the open missing-answer question while allowing answers and fast navigation',async()=>{
  localStorage.setItem('lms.answer.consent:c','true');stored.session.mode='practice';stored.questions[0]={...q,kind:'single',answer:'',answerSource:'none',explanation:''};
  let live:QuestionBankData={...bank,questions:structuredClone(stored.questions)},ready=false;const sent:Record<string,unknown>[]=[];const normal=global.fetch;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
    const body=init?.body?JSON.parse(init.body as string):null;
    if(url.startsWith('/api/question-banks')){
      if(body?.action==='ensure-answer'){sent.push(body);live={...live,revision:live.revision+1,questions:live.questions.map(item=>item.id===body.questionId?{...item,answerGeneration:{state:'running' as const}}:item)};return response({bank:live,configured:true});}
      if(ready)live={...live,questions:live.questions.map(item=>item.id==='q1'?{...item,answer:'A',answerSource:'ai' as const,explanation:'后台解析秘密',answerGeneration:{state:'ready' as const}}:item)};
      return response({banks:[live],configured:true,model:'test'});
    }
    if(body?.action==='original-refresh-answers'){stored={...stored,revision:stored.revision+1,questions:stored.questions.map(item=>item.answer?item:live.questions.find(current=>current.id===item.id)??item),session:{...stored.session,results:{...stored.session.results,q1:{answer:stored.session.answers.q1,correct:true,source:'ai'}}}};return response(stored);}
    return normal(url,init);
  });
  await render('knowledge');expect(document.querySelector('[role="dialog"]')).toBeNull();expect(sent).toHaveLength(1);expect(sent[0].questionId).toBe('q1');
  const choice=container.querySelector('input[value="A"]') as HTMLInputElement;expect(choice.disabled).toBe(false);await act(async()=>choice.click());await click('下一题');await tick();expect(stored.session.answers.q1).toBe('A');expect(stored.session.index).toBe(1);expect(container.textContent).not.toContain('后台解析秘密');
  ready=true;await act(async()=>{await vi.advanceTimersByTimeAsync(3200);});expect(sent).toHaveLength(1);expect(stored.questions[0].answerSource).toBe('ai');expect(stored.session.answers.q1).toBe('A');expect(stored.session.index).toBe(1);
  await click('上一题');expect(container.textContent).toContain('后台解析秘密');expect(container.querySelector('.original-solution-answer')?.textContent).toContain('AI 生成');expect(stored.session.results.q1.source).toBe('ai');
});
it('asks once for the send scope and honors a declined background-answer setting',async()=>{
  stored.session.mode='practice';stored.questions=stored.questions.map(item=>({...item,answer:'',answerSource:'none',explanation:''}));const normal=global.fetch;let ensureCalls=0;const live={...bank,questions:structuredClone(stored.questions)};
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{if(url.startsWith('/api/question-banks')){if(JSON.parse(init?.body as string||'{}').action==='ensure-answer')ensureCalls++;return response({banks:[live],configured:true});}return normal(url,init);});
  await render('knowledge');expect(document.body.textContent).toContain('开启单题后台参考答案');await click('暂不开启');expect(localStorage.getItem('lms.answer.consent:c')).toBe('false');await click('下一题');expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(ensureCalls).toBe(0);
});
it('recovers a lost background-sync response before saving the new local answer',async()=>{
  localStorage.setItem('lms.answer.consent:c','true');stored.session.mode='practice';stored.questions[0]={...q,kind:'single',answer:'',answerSource:'none',explanation:''};
  const normal=global.fetch,live={...bank,questions:stored.questions.map(item=>({...item,answer:'A',answerSource:'ai' as const}))};let attempts=0;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
    if(url.startsWith('/api/question-banks'))return response({banks:[live],configured:true});
    const body=JSON.parse(init?.body as string);
    if(body.action==='original-refresh-answers'){
      attempts++;if(attempts===1){stored={...stored,revision:stored.revision+1,questions:live.questions};throw new Error('同步连接暂时中断');}
      expect(body.revision).toBe(3);expect(body.session.answers).toEqual({});return response(stored);
    }
    if(body.action==='original-save')expect(body.revision).toBe(stored.revision);
    return normal(url,init);
  });
  await render('knowledge');expect(container.textContent).toContain('同步连接暂时中断');expect(button('重试同步参考答案')).toBeDefined();
  const choice=container.querySelector('input[value="B"]') as HTMLInputElement;expect(choice.disabled).toBe(false);await act(async()=>choice.click());await tick();
  expect(attempts).toBe(2);expect(stored.session.answers.q1).toBe('B');expect(container.textContent).not.toContain('同步连接暂时中断');expect(stored.session.roundId).toBe('round');
});
it('hides answer citations before exam hand-in and keeps source quotes separate from the stem',async()=>{
  stored.questions[0]={...q,answerRefs:[{materialId:'answers-file',name:'独立答案.docx',page:4,location:'paragraph',snippet:'原答案的保密摘录'}]};
  await render();expect(container.textContent).not.toContain('原答案的保密摘录');expect(container.querySelector('.original-answer-citations')).toBeNull();
  await click('交卷');await click('仍然交卷');await tick();await click('查看全部解析');expect(container.querySelector('.original-answer-citations')?.textContent).toContain('原答案的保密摘录');expect(container.querySelector('.original-answer-citations a')?.getAttribute('href')).toContain('answers-file');
});
it('opens an imported file list without restoring or creating a practice round',async()=>{
  await act(async()=>root.render(<OriginalPracticeCenter courseId="c" materials={materials} context="knowledge" listMaterialId="m"/>));
  expect(container.querySelector('.original-overview')?.getAttribute('open')).not.toBeNull();expect(container.querySelector('.original-round')).toBeNull();expect(calls.some(call=>call.action==='original-load')).toBe(false);
});
it('retains the AI explanation label alongside an original supplied answer during review', async () => {
  stored.session.mode = 'memorize';
  stored.questions[0] = { ...q, answerSource: 'original', explanationSource: 'ai' };
  await render('knowledge');
  const answer = container.querySelector('.original-solution-answer'), explanation = container.querySelector('.original-solution-explanation');
  expect(answer?.textContent).toContain('资料提供');
  expect(answer?.textContent).not.toContain('AI 生成');
  expect(explanation?.textContent).toContain('AI 生成');
});
