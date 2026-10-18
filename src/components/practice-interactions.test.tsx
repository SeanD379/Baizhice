// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PracticeWorkspace } from './practice-workspace';
import { blankSession } from '@/lib/practice-session';
import type { PracticeData } from '@/lib/practice-store';
import type { Version } from '@/lib/types';

let root:Root,container:HTMLDivElement;
const question={id:'q',kind:'short' as const,prompt:'解释平均值',topic:'平均值',answer:'总和除以数量',explanation:'参考资料',criteria:['说明计算过程'],reference:{materialId:'m',name:'资料.pdf',page:1,snippet:'总和除以数量'}};
const data:PracticeData={scope:'scope',revision:3,set:null,configured:true,eligibleSections:[],questions:[question],session:{...blankSession(),ids:['q'],answers:{q:'先求总和，再除以数量'},results:{q:{answer:'先求总和，再除以数量',correct:null}}}};
const feedback={model:'test',reference:question.reference,feedback:{strengths:[{text:'保留这条反馈',evidence:'总和除以数量'}],omissions:[],suggestions:[],uncertainty:['请核对原文']}};
const response=(body:object,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function button(text:string){const found=[...container.querySelectorAll('button')].find(b=>b.textContent?.includes(text));if(!found)throw new Error(`Missing button: ${text}`);return found;}
async function click(text:string){await act(async()=>button(text).click());}
async function save(){await act(async()=>{await vi.advanceTimersByTimeAsync(350);});}
async function render(value=data){await act(async()=>root.render(<PracticeWorkspace courseId="c" version={{id:'v',number:1} as Version} data={value} onRead={()=>{}} onSource={()=>{}}/>));}
beforeEach(()=>{
  vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  Element.prototype.scrollIntoView=vi.fn();
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});

it('keeps received feedback through self-assessment and saving without another feedback request',async()=>{
  const fetch=vi.fn(async(url:string)=>response(url.endsWith('/feedback')?feedback:{revision:4}));vi.stubGlobal('fetch',fetch);
  await render();await click('同意发送');expect(container.textContent).toContain('保留这条反馈');
  await click('已符合参考答案');
  expect(container.textContent).toContain('保留这条反馈');expect(button('同意发送').disabled).toBe(true);
  await save();
  expect(container.textContent).toContain('保留这条反馈');expect(button('同意发送').disabled).toBe(false);
  expect(fetch.mock.calls.filter(([url])=>url.endsWith('/feedback'))).toHaveLength(1);
});

it('does not abort an in-flight feedback request when self-assessment becomes unsaved',async()=>{
  let finish!:(value:Response)=>void;let signal:AbortSignal|undefined;
  vi.stubGlobal('fetch',vi.fn((url:string,init:RequestInit)=>{
    if(url.endsWith('/feedback')){signal=init.signal as AbortSignal;return new Promise<Response>(resolve=>{finish=resolve;});}
    return Promise.resolve(response({revision:4}));
  }));
  await render();await click('同意发送');await click('已符合参考答案');
  expect(signal?.aborted).toBe(false);
  await act(async()=>finish(response(feedback)));expect(container.textContent).toContain('保留这条反馈');
  await save();expect(container.textContent).toContain('保留这条反馈');
});

it.each(['network','validation'])('retries a failed save explicitly with the same revision and retains the self-assessment: %s',async failure=>{
  const fetch=vi.fn();
  if(failure==='network')fetch.mockRejectedValueOnce(new Error('暂时保存失败'));
  else fetch.mockResolvedValueOnce(response({error:'暂时保存失败'},400));
  fetch.mockResolvedValue(response({revision:4}));vi.stubGlobal('fetch',fetch);
  await render();await click('已符合参考答案');await save();
  expect(container.textContent).toContain('暂时保存失败');expect(container.textContent).toContain('你的自评：已覆盖要点');
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(fetch).toHaveBeenCalledTimes(1);
  await click('重试保存');
  expect(container.textContent).toContain('已保存到本机数据库');expect(container.textContent).not.toContain('暂时保存失败');
  const requests=fetch.mock.calls.map(([,init])=>JSON.parse(init.body));
  expect(requests.map(r=>r.revision)).toEqual([3,3]);expect(requests[1].session).toEqual(requests[0].session);
  expect(requests[1].session.results.q).toEqual({answer:data.session!.answers.q,correct:true});
});

it('keeps conflicts blocked and never fetches a newer revision to overwrite it on retry',async()=>{
  const fetch=vi.fn(async()=>response({error:'另一个页面已保存更新'},400));vi.stubGlobal('fetch',fetch);
  await render();await click('尚未覆盖要点');await save();await click('重试保存');
  expect(container.textContent).toContain('另一个页面已保存更新');expect(container.textContent).toContain('你的自评：还需要巩固');
  expect(button('查看本组结果').disabled).toBe(true);expect(fetch).toHaveBeenCalledTimes(2);
  for(const [url,init] of fetch.mock.calls as unknown as [string,RequestInit][]){expect(url).toBe('/api/practice');expect(JSON.parse(init.body as string).revision).toBe(3);}
});

it('starts a fresh round with a UUID for archival',async()=>{
  const fetch=vi.fn(async()=>response({revision:4}));vi.stubGlobal('fetch',fetch);
  await render({...data,session:{...data.session!,finished:true,roundId:'3b29399d-16e2-4d07-842a-8fb5f3cc1e37',results:{q:{answer:data.session!.answers.q,correct:true}}}});
  await click('开始 1 题');await save();
  const state=JSON.parse((fetch.mock.calls as unknown as [string,RequestInit][])[0][1].body as string).session;
  expect(state.roundId).toMatch(/^[a-f0-9-]{36}$/);expect(state.roundId).not.toBe('3b29399d-16e2-4d07-842a-8fb5f3cc1e37');expect(state.answers).toEqual({});
});

it('waits for the final answers to save before allowing a new round',async()=>{
  const fetch=vi.fn(async()=>response({revision:4}));vi.stubGlobal('fetch',fetch);
  await render();await click('已符合参考答案');await click('查看本组结果');
  expect(button('开始 1 题').disabled).toBe(true);
  await click('开始 1 题');expect(container.textContent).toContain('本组练习完成');
  await save();expect(button('开始 1 题').disabled).toBe(false);
  const stored=JSON.parse((fetch.mock.calls as unknown as [string,RequestInit][])[0][1].body as string).session;
  expect(stored.finished).toBe(true);expect(stored.answers.q).toBe(data.session!.answers.q);
});
