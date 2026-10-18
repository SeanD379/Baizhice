// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Workspace } from '@/lib/types';
import type { OriginalQuestion, OriginalSessionState } from '@/lib/question-bank-types';
import type { StudyQuestion } from '@/lib/practice-hub';
import Workbench from './workbench';
const notebookFlush = vi.hoisted(() => vi.fn(async () => true));
const notebookUnavailable = vi.hoisted(() => ({ value: false }));
vi.mock('./use-notebook', () => ({ useNotebookStore: () => ({ data: notebookUnavailable.value ? null : { courseId: 'probability', revision: 1, updatedAt: '2026-09-29', document: { chapters: [], pages: [], inbox: [], trash: [] } }, status: '已保存', error: '', conflict: null, setEditingActive: vi.fn(), update: vi.fn(), flush: notebookFlush, reload: async () => {}, getCurrent: () => ({ revision: 1 }) }) }));
vi.mock('./original-practice-center', () => ({ OriginalPracticeCenter: ({context,initialQuestion,initialMaterialId,initialScope,selectionOnlyOnEntry,onStart}:{context:string;initialQuestion?:number|string;initialMaterialId?:string;initialScope?:string;selectionOnlyOnEntry?:boolean;onStart?:(scope:string)=>void}) => <div data-original-context={context} data-original-selection-only={!!selectionOnlyOnEntry} data-original-material={initialMaterialId} data-original-scope={initialScope}>直接练原题 {initialQuestion}{selectionOnlyOnEntry && <button type="button" onClick={() => onStart?.('started-scope')}>开始选中的原题练习</button>}</div> }));

let root: Root;
let container: HTMLDivElement;

const workspace: Workspace = {
  courses: [{ id: 'probability', name: '概率论与数理统计' }],
  materials: [],
  versions: [],
};
let currentWorkspace = workspace;

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const hubResponse = (url: string) => response({courseId:'probability',courseName:'概率论与数理统计',section:new URLSearchParams(url.split('?')[1]).get('section'),day:'2026-10-02',configured:false,materials:[],knowledge:[],catalog:[],records:[],daily:null,dailyCount:0,recommendation:null});

it('groups the mistake homepage by material, collapses extra files, and opens material detail instead of a topic search', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  const question = (id: string, materialId: string): StudyQuestion => ({ key: id, ref: { engine: 'original', questionId: id, materialId }, prompt: id, topic: id, sourceName: `${materialId}.docx`, section: 'knowledge', origin: 'original', available: true, favorite: false, manualWrong: false, mistake: true, consolidated: false, tags: [], note: '' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.startsWith('/api/practice-hub') ? response({ courseId: 'probability', section: 'mistakes', day: '2026-10-13', configured: false, materials: [], knowledge: [], catalog: [question('topic-1', 'm1'), question('topic-2', 'm1'), ...['m2', 'm3', 'm4'].map(id => question(id, id))], records: [], daily: null, dailyCount: 0, withheldMaterials: [] }) : originalFetch(url, init)));
  window.history.replaceState(null, '', '/?course=probability&view=practice&section=mistakes');
  await act(async () => root.render(<Workbench/>));
  await vi.waitFor(() => expect(container.querySelector('.hub-more-files')).toBeTruthy());
  expect((container.querySelector('.hub-more-files') as HTMLDetailsElement).open).toBe(false);
  expect(container.querySelectorAll('.hub-main-surface .hub-file-row')).toHaveLength(4);
  await act(async () => (container.querySelector('.hub-file-row') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(container.querySelector('.mistake-file-practice')).toBeTruthy());
  expect(new URLSearchParams(window.location.search).get('activity')).toBe('file');
  expect(new URLSearchParams(window.location.search).get('paper')).toBe('m1');
});

it('returns from a saved mistake round to this material’s mistake detail', async () => {
  window.history.replaceState(null, '', '/?course=probability&view=practice&section=mistakes&activity=practice&paper=m1&scope=round&from=file');
  await act(async () => root.render(<Workbench/>));
  await vi.waitFor(() => expect(container.querySelector('.practice-subpage-nav button')?.textContent).toBe('返回资料错题'));
  await act(async () => (container.querySelector('.practice-subpage-nav button') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(container.querySelector('.mistake-file-practice')).toBeTruthy());
  expect(new URLSearchParams(window.location.search).get('section')).toBe('mistakes');
  expect(new URLSearchParams(window.location.search).get('paper')).toBe('m1');
});

async function renderWorkbench() {
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.textContent).toContain('今天想怎么学习？'));
}

beforeEach(() => {
  currentWorkspace = workspace;
  notebookUnavailable.value = false;
  notebookFlush.mockResolvedValue(true);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView=vi.fn();
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/practice-hub')) return hubResponse(url);
    if (url.startsWith('/api/practice-state')) return response({states:[]});
    if (url.startsWith('/api/workspace')) return response(currentWorkspace);
    if (url.startsWith('/api/materials/')) return response(currentWorkspace.materials.find(material => url.endsWith(material.id)));
    return response({ conversations: [], messages: [] });
  }));
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
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

it('opens a knowledge homepage first and enters question selection after choosing a practice tool', async () => {
  window.history.replaceState(null, '', '/?course=probability&view=practice&section=knowledge');
  await act(async () => root.render(<Workbench/>));
  await vi.waitFor(() => expect(container.textContent).toContain('资料与知识点库'));
  expect(container.querySelector('.hub-tools')?.querySelectorAll('button')).toHaveLength(5);
  expect(container.querySelector('.hub-tools')?.textContent).not.toContain('知识点整理');
  expect(container.textContent).toContain('编辑活页笔记');
  expect(container.querySelector('[data-original-context]')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  const practice = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('专项练习'))!;
  await act(async () => practice.click());
  await vi.waitFor(() => expect(container.querySelector('[data-original-context="knowledge"]')).toBeTruthy());
  expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-selection-only')).toBe('true');
  expect(new URLSearchParams(window.location.search).get('activity')).toBe('practice');
  window.history.replaceState(null, '', '/?course=probability&view=practice&section=knowledge');
  await act(async () => window.dispatchEvent(new PopStateEvent('popstate')));
  await vi.waitFor(() => expect(container.querySelector('[data-original-context]')).toBeNull());
  expect(container.textContent).toContain('资料与知识点库');
});

it('opens the selected original paper beyond the legacy 23-question limit', async () => {
  window.history.replaceState(null, '', '/?course=probability&view=practice&section=papers&paper=word&question=50');
  await act(async () => root.render(<Workbench/>));
  await vi.waitFor(() => expect(container.querySelector('[data-original-context="paper"]')?.textContent).toContain('50'));
  expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-selection-only')).toBe('false');
  expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-material')).toBe('word');
});

it.each(['knowledge', 'papers'])('opens generic %s practice at selection without the old bottom entry links', async section => {
  window.history.replaceState(null, '', `/?course=probability&view=practice&section=${section}&activity=practice`);
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.querySelector('[data-original-context]')).toBeTruthy());
  expect(container.querySelector('.practice-activity .hub-text-action')).toBeNull();
  expect(container.textContent).not.toContain('练习已核对知识点生成的题组');
  expect(container.textContent).not.toContain('打开已有 PDF 作答与原卷批注');
  expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-selection-only')).toBe('true');
});

it.each(['knowledge', 'papers'])('preserves a started %s practice scope in the URL and resumes it after reload', async section => {
  window.history.replaceState(null, '', `/?course=probability&view=practice&section=${section}&activity=practice`);
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-selection-only')).toBe('true'));
  await act(async () => (container.querySelector('[data-original-context] button') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(new URLSearchParams(window.location.search).get('scope')).toBe('started-scope'));
  expect(new URLSearchParams(window.location.search).get('section')).toBe(section);
  expect(new URLSearchParams(window.location.search).get('activity')).toBe('practice');
  expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-selection-only')).toBe('false');
  expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-scope')).toBe('started-scope');

  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-scope')).toBe('started-scope'));
  expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-selection-only')).toBe('false');
});

it.each([
  ['papers', 'paper=source-1', 'source-1', null],
  ['knowledge', 'question=17', null, null],
  ['knowledge', 'scope=archived-scope', null, 'archived-scope'],
])('keeps direct %s practice with %s in answering mode', async (section, params, material, scope) => {
  window.history.replaceState(null, '', `/?course=probability&view=practice&section=${section}&activity=practice&${params}`);
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.querySelector('[data-original-context]')).toBeTruthy());
  expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-selection-only')).toBe('false');
  expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-material')).toBe(material);
  expect(container.querySelector('[data-original-context]')?.getAttribute('data-original-scope')).toBe(scope);
});

it('keeps an existing legacy PDF answering link working after removing its inline entry', async () => {
  window.history.replaceState(null, '', '/?course=probability&view=practice&section=papers&activity=practice&paper=legacy-paper&legacy=1');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.querySelector('.exam-workspace')).toBeTruthy());
  expect(container.querySelector('[data-original-context]')).toBeNull();
  expect(new URLSearchParams(window.location.search).get('legacy')).toBe('1');
  expect(new URLSearchParams(window.location.search).get('paper')).toBe('legacy-paper');
});

it('opens the matching archived original snapshot from homepage history', async () => {
  const question: OriginalQuestion = { id: 'archived-question', materialId: 'paper-1', number: '50', section: '选择题', kind: 'single', prompt: '归档轮次中的原题', context: '', options: [{ label: 'A', text: '归档选项' }], sources: [], topics: [], answer: '归档参考答案', answerSource: 'original', explanation: '归档解析', criteria: [], warnings: [], origin: 'original' };
  const session: OriginalSessionState = { roundId: 'archived-round', mode: 'practice', ids: [question.id], index: 0, answers: { [question.id]: 'A' }, results: { [question.id]: { answer: 'A', correct: true, source: 'original' } }, submitted: true, finished: true };
  const normal = global.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/practice-hub')) return response({ courseId: 'probability', courseName: '概率论与数理统计', section: 'papers', day: '2026-10-02', configured: false, materials: [], knowledge: [], catalog: [], daily: null, dailyCount: 0, recommendation: null, records: [{ id: 'archived-record', engine: 'original', title: '已归档原题轮次', at: '2026-10-01T00:00:00.000Z', section: 'papers', total: 1, answered: 1, finished: true, materialId: 'paper-1' }] });
    if (url === '/api/practice?source=original&courseId=probability') return response({ entries: [
      { id: 'other-record', questions: [{ ...question, id: 'other-question', prompt: '另一个轮次的原题' }], session },
      { id: 'archived-record', questions: [question,{...question,id:'archived-question-2',number:'51',prompt:'同一轮中的第二道原题'}], session:{...session,ids:[question.id,'archived-question-2'],answers:{...session.answers,'archived-question-2':'A'},results:{...session.results,'archived-question-2':{answer:'A',correct:true,source:'original'}}} },
    ] });
    return normal(url, init);
  }));
  window.history.replaceState(null, '', '/?course=probability&view=practice&section=papers');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.querySelector('.hub-tools')).toBeTruthy());
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.hub-tools button')].find(button => button.textContent?.includes('套卷记录'))!.click());
  await vi.waitFor(() => expect(container.querySelector('.hub-record-list')).toBeTruthy());
  expect(new URLSearchParams(window.location.search).get('activity')).toBe('history');
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.hub-record-list button')].find(button => button.textContent === '回看快照')!.click());
  await vi.waitFor(()=>expect(container.querySelector('[aria-label="本轮答题结果"]')).toBeTruthy());
  expect(container.querySelector('.practice-result-score dd')?.getAttribute('aria-label')).toBe('100 分，满分 100 分');
  expect(container.querySelector('.practice-result-confetti')).toBeNull();
  expect(container.textContent).not.toContain('重新练习并保留历史');
  await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="查看正确题，共 2 题"]')!.click());
  expect(container.querySelectorAll('.hub-history-snapshot article')).toHaveLength(2);
  await act(async()=>container.querySelector<HTMLButtonElement>('.practice-back-button')!.click());
  await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='查看全部解析')!.click());
  await vi.waitFor(() => expect(container.querySelector('.hub-history-snapshot')?.textContent).toContain('归档轮次中的原题'));
  expect(container.querySelector('.hub-history-snapshot')?.textContent).toContain('当时的作答：A');
  expect(container.querySelector('.hub-history-snapshot')?.textContent).toContain('归档参考答案');
  expect(container.querySelector('.hub-history-snapshot')?.textContent).not.toContain('另一个轮次的原题');
  const back=container.querySelector<HTMLButtonElement>('.practice-back-button')!;
  expect(back.textContent).toBe('返回看板');
  await act(async()=>back.click());
  expect(container.querySelector('[aria-label="本轮答题结果"]')).toBeTruthy();
  expect(container.querySelector('.practice-back-button')?.textContent).toBe('返回练习记录');
  await act(async()=>container.querySelector<HTMLButtonElement>('.practice-back-button')!.click());
  expect(container.querySelector('.hub-record-list')).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
});

it.each(['knowledge', 'mistakes', 'papers'])('returns from the %s homepage to the practice overview with one back button', async section => {
  window.history.replaceState(null, '', `/?course=probability&view=practice&section=${section}`);
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.querySelector(`.hub-${section}`)).toBeTruthy());
  const buttons = container.querySelectorAll<HTMLButtonElement>('.practice-subpage-nav button');
  expect(buttons).toHaveLength(1);
  expect(buttons[0].textContent).toBe('返回练习中心');

  await act(async () => buttons[0].click());

  expect(container.querySelectorAll('.practice-center-options button')).toHaveLength(3);
  expect(container.querySelector('.practice-subpage-nav')).toBeNull();
  expect(window.location.search).toBe('?course=probability&view=practice');
});

it.each([
  ['knowledge', '知识点巩固'],
  ['mistakes', '错题复盘'],
  ['papers', '套卷练习'],
])('returns a direct %s activity link to its homepage and clears exercise parameters', async (section, title) => {
  window.history.replaceState(null, '', `/?course=probability&view=practice&section=${section}&activity=favorites&paper=source-1&question=17&scope=round-1&task=daily-1&version=version-1&set=set-1&page=page-1&legacy=1&variant=1`);
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.querySelector('.practice-activity')).toBeTruthy());
  const buttons = container.querySelectorAll<HTMLButtonElement>('.practice-subpage-nav button');
  expect(buttons).toHaveLength(1);
  expect(buttons[0].textContent).toBe(`返回${title}`);

  await act(async () => buttons[0].click());

  await vi.waitFor(() => expect(container.querySelector('.practice-hub')).toBeTruthy());
  expect(container.querySelector(`.practice-hub.hub-${section}`)).toBeTruthy();
  expect(container.querySelector('.practice-activity')).toBeNull();
  expect(window.location.search).toBe(`?course=probability&view=practice&section=${section}`);
  expect(container.querySelector('.practice-subpage-nav button')?.textContent).toBe('返回练习中心');
});

it('restores the activity and its parent homepage when navigating back and forward after returning', async () => {
  window.history.replaceState(null, '', '/?course=probability&view=practice&section=knowledge');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.querySelector('.hub-tools')).toBeTruthy());
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.hub-tools button')].find(button => button.textContent?.includes('收藏题目'))!.click());
  const activityUrl = window.location.search;
  expect(new URLSearchParams(activityUrl).get('activity')).toBe('favorites');
  await act(async () => (container.querySelector('.practice-subpage-nav button') as HTMLButtonElement).click());
  expect(window.location.search).toBe('?course=probability&view=practice&section=knowledge');

  await act(async () => window.history.back());
  await vi.waitFor(() => expect(container.querySelector('.practice-activity')).toBeTruthy());
  expect(window.location.search).toBe(activityUrl);
  expect(container.querySelector('.practice-subpage-nav button')?.textContent).toBe('返回知识点巩固');

  await act(async () => window.history.forward());
  await vi.waitFor(() => expect(container.querySelector('.practice-hub.hub-knowledge')).toBeTruthy());
  expect(window.location.search).toBe('?course=probability&view=practice&section=knowledge');
  expect(container.querySelector('.practice-subpage-nav button')?.textContent).toBe('返回练习中心');
});

it('keeps the activity and its URL when saving fails before returning, then allows retry', async () => {
  const activityUrl = '?course=probability&view=practice&section=papers&activity=favorites&scope=round-1';
  window.history.replaceState(null, '', `/${activityUrl}`);
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.querySelector('.practice-activity')).toBeTruthy());
  notebookFlush.mockResolvedValueOnce(false);

  await act(async () => (container.querySelector('.practice-subpage-nav button') as HTMLButtonElement).click());

  expect(notebookFlush).toHaveBeenCalledWith();
  expect(window.location.search).toBe(activityUrl);
  expect(container.querySelector('.practice-activity')).toBeTruthy();
  expect(container.textContent).toContain('笔记尚未保存，请重试保存后再离开。');
  await act(async () => (container.querySelector('.practice-subpage-nav button') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(container.querySelector('.practice-hub.hub-papers')).toBeTruthy());
  expect(window.location.search).toBe('?course=probability&view=practice&section=papers');
});

it('continues a generated daily round through its original daily task instead of an ordinary scope', async () => {
  const normal=global.fetch;
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>url.startsWith('/api/practice-daily')?response({id:'daily-task',courseId:'probability',section:'knowledge',day:'2026-10-02',createdAt:'2026-10-02',groups:[]}):url.startsWith('/api/practice-hub')?response({courseId:'probability',courseName:'概率论与数理统计',section:'knowledge',day:'2026-10-02',configured:false,materials:[],knowledge:[],catalog:[],daily:null,dailyCount:0,recommendation:null,records:[{id:'daily-scope',engine:'generated',title:'每日题组',at:'2026-10-02',section:'knowledge',total:5,answered:1,finished:false,versionId:'v',taskId:'daily-task'}]}):normal(url,init));
  window.history.replaceState(null,'','/?course=probability&view=practice&section=knowledge');
  await act(async()=>root.render(<Workbench/>));
  await vi.waitFor(()=>expect(container.textContent).toContain('每日题组'));
  await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent?.includes('接着练习'))!.click());
  expect(new URLSearchParams(window.location.search).get('activity')).toBe('daily');
  expect(new URLSearchParams(window.location.search).get('task')).toBe('daily-task');
});

it('opens a section while an untouched notebook is still loading', async () => {
  notebookUnavailable.value = true;
  notebookFlush.mockResolvedValue(false);
  window.history.replaceState(null, '', '/?course=probability&view=practice');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.querySelector('.practice-cover-knowledge')).toBeTruthy());
  await act(async () => (container.querySelector('.practice-cover-knowledge') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(container.querySelector('.practice-hub.hub-knowledge')).toBeTruthy());
  expect(notebookFlush).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('笔记尚未保存');
});
