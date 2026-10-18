// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Workspace } from '@/lib/types';
import Workbench from './workbench';
import { ThemeProvider } from './ui-theme';
vi.mock('./use-notebook', () => ({ useNotebookStore: () => ({ data: { courseId: 'probability', revision: 1, updatedAt: '2026-09-29', document: { chapters: [], pages: [], inbox: [], trash: [] } }, status: '已保存', error: '', conflict: null, setEditingActive: vi.fn(), update: vi.fn(), flush: async () => true, reload: async () => {}, getCurrent: () => ({ revision: 1 }) }) }));
vi.mock('./material-study-reader', () => ({ MaterialStudyReader: () => <div>原文件阅读与批注</div> }));
vi.mock('./file-practice', () => ({ FilePractice: ({onSource}:{onSource:(ref:{materialId:string;name:string;page:number;snippet:string;location:'paragraph'})=>void}) => <button onClick={()=>onSource({materialId:'preview-file',name:'讲义.docx',page:12,snippet:'原文件中的题目',location:'paragraph'})}>查看出处</button> }));
vi.mock('./original-file-preview', () => ({ OriginalFilePreview: ({material,initialPage,studyAnnotations}:{material:{id:string};initialPage:number;studyAnnotations:{focusAnchor:{quote:string}}}) => <div data-original-preview={material.id} data-preview-page={initialPage} data-preview-quote={studyAnnotations.focusAnchor.quote}/> }));
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

const hubResponse = (url: string) => response({courseId:'probability',courseName:'概率论与数理统计',section:new URLSearchParams(url.split('?')[1]).get('section'),day:'2026-10-04',configured:false,materials:[],knowledge:[],catalog:[],records:[],withheldMaterials:[],daily:null,dailyCount:0,recommendation:null});

async function renderWorkbench() {
  await act(async () => root.render(<ThemeProvider><Workbench /></ThemeProvider>));
  await vi.waitFor(() => expect(container.textContent).toContain('今天想怎么学习？'));
}

beforeEach(() => {
  currentWorkspace = workspace;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/practice-hub')) return hubResponse(url);
    if (url.startsWith('/api/practice-state')) return response({states:[]});
    if (url.startsWith('/api/workspace')) return response(currentWorkspace);
    if (url.startsWith('/api/materials/')) return response(currentWorkspace.materials.find(material => url.endsWith(material.id)));
    return response({ conversations: [], messages: [] });
  }));
  window.localStorage.clear();
  document.documentElement.dataset.theme = 'light';
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
it('offers a theme switch without clearing an unsent question', async () => {
  await renderWorkbench();
  const question = container.querySelector<HTMLTextAreaElement>('textarea')!;
  const draft = '切换主题后仍然保留的问题';
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(question, draft);
    question.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="切换到夜间模式"]');
  expect(toggle).not.toBeNull();
  await act(async () => toggle!.click());
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(window.localStorage.getItem('lms.theme')).toBe('dark');
  expect(container.querySelector('textarea')).toBe(question);
  expect(question.value).toBe(draft);
  expect(container.querySelector('button[aria-label="切换到白天模式"]')).not.toBeNull();
});
it('opens the original Word preview from file practice and retains the original-file fallback link',async()=>{
  currentWorkspace={...workspace,materials:[{id:'preview-file',courseId:'probability',name:'讲义.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:20,fixture:null,chapter:'',status:'extracted',excluded:false,origin:'本机上传',createdAt:''}]};
  window.history.replaceState(null,'','/?course=probability&view=practice&section=knowledge&activity=file&paper=preview-file');
  await act(async()=>root.render(<Workbench/>));
  await vi.waitFor(()=>expect([...container.querySelectorAll('button')].some(button=>button.textContent==='查看出处')).toBe(true));
  await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='查看出处')!.click());
  expect(container.querySelector('[data-original-preview]')?.getAttribute('data-preview-page')).toBe('1');
  expect(container.querySelector('[data-original-preview]')?.getAttribute('data-preview-quote')).toBe('原文件中的题目');
  expect(container.querySelector('.practice-source-preview a[href="/api/files/preview-file"]')?.textContent).toContain('打开原文件');
});

it('opens a knowledge homepage first and enters question selection after choosing a practice tool', async () => {
  window.history.replaceState(null, '', '/?course=probability&view=practice&section=knowledge');
  await act(async () => root.render(<Workbench/>));
  await vi.waitFor(() => expect(container.textContent).toContain('资料与知识点库'));
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

it('starts with the original navigation collapsed and no persistent content list', async () => {
  await renderWorkbench();
  expect(container.querySelector('.shell-list-pane')).toBeNull();
  expect(container.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(true);
  const navigation = container.querySelector('aside[aria-label="学习导航"]')!;
  expect([...navigation.querySelectorAll('.nav-item')].map(button => button.getAttribute('aria-label'))).toEqual(['新对话', '学习分析', '我的资料', '我的活页笔记', '练习中心']);
  expect(container.querySelector('.chat-heading button[aria-label="对话历史"]')).toBeTruthy();
  expect(container.querySelector('button[aria-label="展开侧边栏"]')).toBeTruthy();
});

it('expands navigation names, collapses them again and restores the preference', async () => {
  await renderWorkbench();
  await act(async () => (container.querySelector('button[aria-label="展开侧边栏"]') as HTMLButtonElement).click());
  expect(container.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(false);
  expect(container.querySelector('.nav-item[aria-current="page"]')?.textContent).toContain('新对话');
  expect(window.localStorage.getItem('lms.app-shell-5.navigation-collapsed')).toBe('false');
  await act(async () => (container.querySelector('button[aria-label="收起侧边栏"]') as HTMLButtonElement).click());
  expect(container.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(true);
  expect(window.localStorage.getItem('lms.app-shell-5.navigation-collapsed')).toBe('true');
  await act(async () => root.unmount());
  root = createRoot(container);
  await renderWorkbench();
  expect(container.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(true);
  expect(container.querySelector('button[aria-label="展开侧边栏"]')).toBeTruthy();
});

it.each(['home', 'practice'])('opens searchable conversation history in chat after entering from %s and closes it after selecting a chat', async initialView => {
  const conversations = [
    { id: 'chat-probability', title: '复习条件概率', updatedAt: '2026-10-01T08:00:00Z', messageCount: 2 },
    { id: 'chat-independence', title: '理解事件独立性', updatedAt: '2026-10-02T08:00:00Z', messageCount: 2 },
  ];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/practice-hub')) return hubResponse(url);
    if (url.startsWith('/api/practice-state')) return response({states:[]});
    if (url.startsWith('/api/workspace')) return response(workspace);
    const selected = url.includes('conversationId=chat-probability');
    return response({ conversations, messages: selected ? [{ id: 'message-probability', role: 'user', content: '请解释条件概率的含义', status: 'complete', attachments: [], createdAt: '2026-10-01T08:00:00Z' }] : [] });
  }));
  window.history.replaceState(null, '', `/?course=probability&view=${initialView}`);
  await act(async () => root.render(<Workbench/>));
  await vi.waitFor(() => expect(initialView === 'practice' ? container.querySelector('.practice-center-options') : container.textContent?.includes('今天想怎么学习？')).toBeTruthy());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('#shell-navigation button[aria-label="对话历史"]')).toBeNull();
  if (initialView !== 'home') {
    await act(async () => (container.querySelector('#shell-navigation button[aria-label="新对话"]') as HTMLButtonElement).click());
    await vi.waitFor(() => expect(container.querySelector('.chat-heading')).toBeTruthy());
  }
  const historyButton = container.querySelector('.chat-heading button[aria-label="对话历史"]') as HTMLButtonElement;
  await act(async () => historyButton.click());
  expect(historyButton.getAttribute('aria-expanded')).toBe('true');
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('对话历史');
  await vi.waitFor(() => expect(dialog.querySelectorAll('.conversation-history-entry')).toHaveLength(2));
  const input = dialog.querySelector('input[aria-label="搜索对话历史"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '条件概率');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(dialog.querySelectorAll('.conversation-history-entry')).toHaveLength(1);
  await act(async () => (dialog.querySelector('.conversation-history-entry') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(container.textContent).toContain('请解释条件概率的含义'));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(new URLSearchParams(window.location.search).get('chat')).toBe('chat-probability');
  expect(new URLSearchParams(window.location.search).get('view')).toBe('home');
});

it('opens the selected original paper beyond the legacy 23-question limit', async () => {
  window.history.replaceState(null, '', '/?course=probability&view=practice&section=papers&paper=word&question=50');
  await act(async () => root.render(<Workbench/>));
  await vi.waitFor(() => expect(container.querySelector('[data-original-context="paper"]')?.textContent).toContain('50'));
});

it('collapses the desktop sidebar without changing the active view', async () => {
  await renderWorkbench();
  await act(async () => (container.querySelector('button[aria-label="展开侧边栏"]') as HTMLButtonElement).click());
  const toggle = container.querySelector('button[aria-label="收起侧边栏"]') as HTMLButtonElement;
  expect(toggle).toBeTruthy();
  expect(container.querySelector('.nav-item[aria-current="page"]')?.textContent).toContain('新对话');

  await act(async () => toggle.click());

  expect(container.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(true);
  expect(container.querySelector('.nav-item[aria-current="page"]')?.textContent).toContain('新对话');
  expect(window.localStorage.getItem('lms.app-shell-5.navigation-collapsed')).toBe('true');
});

it('restores a valid saved sidebar preference', async () => {
  window.localStorage.setItem('lms.app-shell-5.navigation-collapsed', 'false');
  await renderWorkbench();
  expect(container.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(false);
  expect(container.querySelector('button[aria-label="收起侧边栏"]')).toBeTruthy();
});

it('ignores an invalid saved sidebar preference', async () => {
  window.localStorage.setItem('lms.app-shell-5.navigation-collapsed', 'sometimes');
  await renderWorkbench();
  expect(container.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(true);
  expect(window.localStorage.getItem('lms.app-shell-5.navigation-collapsed')).toBe('sometimes');
});

it('opens practice sections as separate pages and keeps old exam links working', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/practice-hub') ? hubResponse(url) : url.startsWith('/api/practice-state') ? response({states:[]}) : url.startsWith('/api/workspace') ? response(currentWorkspace) : url.startsWith('/api/practice/history') ? response({ courseName: '课程', entries: [] }) : response({ conversations: [], messages: [] })));
  window.history.replaceState(null, '', '/?course=probability&view=exam');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.textContent).toContain('练习中心'));
  expect([...container.querySelectorAll('.nav-item')].filter(button => button.textContent?.includes('练习中心'))).toHaveLength(1);
  expect(container.querySelectorAll('.practice-center-options button')).toHaveLength(0);
  expect(container.querySelector('.practice-subpage-nav')?.textContent).toBe('返回练习中心');
  expect(new URLSearchParams(window.location.search).get('view')).toBe('practice');
  expect(new URLSearchParams(window.location.search).get('section')).toBe('papers');
  await act(async () => (container.querySelector('.practice-subpage-nav button') as HTMLButtonElement).click());
  expect(container.querySelectorAll('.practice-center-options button')).toHaveLength(3);
  expect(container.querySelector('.exam-workspace')).toBeNull();
  expect(new URLSearchParams(window.location.search).has('section')).toBe(false);
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.practice-center-options button')].find(button => button.textContent?.includes('错题复盘'))!.click());
  expect(container.querySelectorAll('.practice-center-options button')).toHaveLength(0);
  expect(container.querySelector('.hub-mistakes')).toBeTruthy();
  expect(container.querySelector('[data-original-context]')).toBeNull();
  expect(new URLSearchParams(window.location.search).get('section')).toBe('mistakes');
});

it('shows the current reading title and course in the shell toolbar', async () => {
  window.history.replaceState(null, '', '/?course=probability&view=home');
  await renderWorkbench();
  expect(container.querySelector('.breadcrumb-course')).toBeNull();
  expect(container.querySelector('.topbar h1')?.textContent).toBe('AI 学习');
  expect(container.querySelector('.shell-reader-actions>span')?.textContent).toBe('概率论与数理统计');
});

it('uses the sidebar new conversation entry without a duplicate guide card', async () => {
  window.history.replaceState(null, '', '/?course=probability&view=home&chat=old');
  await renderWorkbench();
  expect(container.querySelector('.sidebar-guide')).toBeNull();

  const newChat = container.querySelector('nav[aria-label="AI 学习"] button') as HTMLButtonElement;
  await act(async () => newChat.click());
  await vi.waitFor(() => expect(new URLSearchParams(window.location.search).has('chat')).toBe(false));
});

it('allows personal notes when a course contains only exam papers', async () => {
  currentWorkspace = { ...workspace, materials: [{ id: 'paper-1', courseId: 'probability', name: '试卷.pdf', mime: 'application/pdf', size: 1024, fixture: null, chapter: '历年套卷', status: 'extracted', excluded: false, origin: 'local', createdAt: '2026-09-25T00:00:00.000Z' }] };
  window.history.replaceState(null, '', '/?course=probability&view=outline');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.textContent).toContain('从第一张活页开始'));
  expect(container.querySelector('.loose-heading h1')?.textContent).toBe('我的活页笔记');
  expect(container.querySelector('.loose-empty')?.textContent).toContain('写第一张活页');
});

it('keeps an old exam-question summary in history instead of showing it as knowledge review', async () => {
  currentWorkspace = {
    ...workspace,
    materials: [{ id: 'paper-1', courseId: 'probability', name: '试卷.pdf', mime: 'application/pdf', size: 1024, fixture: null, chapter: '历年套卷', status: 'extracted', excluded: false, origin: 'local', createdAt: '2026-09-25T00:00:00.000Z' }],
    versions: [{ id: 'version-1', courseId: 'probability', number: 1, title: '复习提纲', sourceIds: ['paper-1'], summary: '旧摘要', createdAt: '2026-09-25T00:00:00.000Z', sections: [{ id: 'q17', title: '第17题', body: '只概述原题，没有答案或作答位置。', refs: [] }] }],
  };
  window.history.replaceState(null, '', '/?course=probability&view=outline');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.textContent).toContain('我的活页笔记'));
  expect(container.querySelector('.outline-notebook')).toBeNull();
  expect(container.querySelector('.loose-empty')).toBeTruthy();
  expect(container.textContent).not.toContain('只概述原题');
});

it('lets readers choose extracted notes on review and practice pages even with an old exam version', async () => {
  const base = { courseId: 'probability', mime: 'application/pdf', size: 1024, fixture: null, status: 'extracted', excluded: false, origin: 'local', createdAt: '2026-09-25T00:00:00.000Z' };
  currentWorkspace = {
    ...workspace,
    materials: [
      { ...base, id: 'paper-1', name: '试卷.pdf', chapter: '历年套卷' },
      { ...base, id: 'note-1', name: '练习题.docx', chapter: '未分类', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ],
    versions: [{ id: 'version-1', courseId: 'probability', number: 1, title: '旧摘要', sourceIds: ['paper-1'], summary: '旧摘要', createdAt: base.createdAt, sections: [] }],
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/practice-hub')) return hubResponse(url);
    if (url.startsWith('/api/practice-state')) return response({states:[]});
    if (url.startsWith('/api/practice-hub')) return hubResponse(url);
    if (url.startsWith('/api/practice-state')) return response({states:[]});
    if (url.startsWith('/api/workspace')) return response(currentWorkspace);
    if (url.startsWith('/api/generation') && url.includes('action=list')) return response({ previews: [] });
    if (url.startsWith('/api/generation')) return response({ configured: true, model: 'test', pages: [
      { materialId: 'paper-1', name: '试卷.pdf', page: 1, text: '试卷内容', extractionHash: 'a'.repeat(64), method: 'pdf-text', warnings: [] },
      { materialId: 'note-1', name: '练习题.docx', page: 1, text: '笔记内容', extractionHash: 'b'.repeat(64), method: 'docx-text', warnings: [] },
    ], unavailable: [] });
    return response({ conversations: [], messages: [] });
  }));
  window.history.replaceState(null, '', '/?course=probability&view=outline');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.textContent).toContain('我的活页笔记'));
  expect(container.querySelector('.view-outline .review-source-picker')).toBeNull();
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.loose-heading-actions button')].find(button => button.textContent?.includes('从资料整理'))!.click());
  await vi.waitFor(() => expect(document.body.querySelector('.generation-dialog')?.textContent).toContain('练习题.docx'));
  expect(document.body.querySelector('.generation-dialog')?.textContent).toContain('试卷.pdf');
  await act(async () => (document.body.querySelector('button[aria-label="关闭窗口"]') as HTMLButtonElement).click());
  const practiceNav = [...container.querySelectorAll<HTMLButtonElement>('.nav-item')].find(button => button.textContent?.includes('练习中心'))!;
  await act(async () => practiceNav.click());
  expect(container.querySelectorAll('.practice-center-options button')).toHaveLength(3);
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.practice-center-options button')].find(button => button.textContent?.includes('知识点巩固'))!.click());
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.hub-header button')].find(button => button.textContent?.includes('选择资料'))!.click());
  const practicePicker = container.querySelector('.view-practice .review-source-picker') as HTMLElement;
  expect(practicePicker.textContent).toContain('练习题.docx');
  expect(practicePicker.textContent).toContain('先选资料整理知识点');
  expect(container.textContent).toContain('从资料到知识点');
  await act(async () => (practicePicker.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  await act(async () => (practicePicker.querySelector('.btn-primary') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(document.body.querySelector('.generation-material')?.textContent).toContain('练习题.docx'));
});

it('removes the local-space status while retaining the mobile navigation control', async () => {
  await renderWorkbench();
  expect(container.querySelector('.topbar-status')).toBeNull();
  expect(container.textContent).not.toContain('本机空间');
  expect(container.querySelector('button[aria-label="展开课程导航"]')).toBeTruthy();
});

it('offers reference adoption and expands feedback before pausing a conflicting note', async () => {
  currentWorkspace = {
    ...workspace,
    materials: [{
      id: 'note-1', courseId: 'probability', name: '课堂笔记 · 冲突测试样例.pdf', mime: 'application/pdf',
      size: 1024, fixture: 'note', chapter: '事件独立性', status: 'review', excluded: false,
      origin: '自编中文演示资料', createdAt: '2026-09-09T13:28:00.000Z',
    }],
  };
  window.history.replaceState(null, '', '/?course=probability&view=library');

  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.textContent).toContain('课堂笔记 · 冲突测试样例.pdf'));
  const material = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('课堂笔记 · 冲突测试样例.pdf'));
  await act(async () => material?.click());

  expect(container.textContent).toContain('你的原始笔记保持不变');
  expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === '采纳参考结论')).toBe(true);
  const defer = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '暂不采纳');
  expect(defer).toBeTruthy();

  await act(async () => defer?.click());

  expect(container.textContent).toContain('为什么暂不采纳？');
  expect(container.textContent).toContain('参考资料可能有误');
  expect(container.textContent).toContain('参考资料已过时');
  expect(container.textContent).toContain('这份冲突资料将暂停用于生成提纲和练习');
  expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === '提交反馈并暂停使用')?.hasAttribute('disabled')).toBe(true);
});

it('submits the selected conflict decision without rewriting the note', async () => {
  currentWorkspace = {
    ...workspace,
    materials: [{
      id: 'note-1', courseId: 'probability', name: '课堂笔记 · 冲突测试样例.pdf', mime: 'application/pdf',
      size: 1024, fixture: 'note', chapter: '事件独立性', status: 'review', excluded: false,
      conflictResolution: null, conflictFeedbackReason: null, conflictFeedbackNote: null, conflictResolvedAt: null,
      origin: '自编中文演示资料', createdAt: '2026-09-09T13:28:00.000Z',
    }],
  };
  window.history.replaceState(null, '', '/?course=probability&view=library');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.textContent).toContain('课堂笔记 · 冲突测试样例.pdf'));
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('课堂笔记 · 冲突测试样例.pdf'))?.click());

  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '采纳参考结论')?.click());

  expect(vi.mocked(fetch).mock.calls.some(([url, options]) => url === '/api/materials/note-1' && options?.method === 'PATCH' && options.body === JSON.stringify({ action: 'accept-reference' }))).toBe(true);
});

it('submits one quick reason when pausing a conflict', async () => {
  currentWorkspace = {
    ...workspace,
    materials: [{
      id: 'note-1', courseId: 'probability', name: '课堂笔记 · 冲突测试样例.pdf', mime: 'application/pdf',
      size: 1024, fixture: 'note', chapter: '事件独立性', status: 'review', excluded: false,
      conflictResolution: null, conflictFeedbackReason: null, conflictFeedbackNote: null, conflictResolvedAt: null,
      origin: '自编中文演示资料', createdAt: '2026-09-09T13:28:00.000Z',
    }],
  };
  window.history.replaceState(null, '', '/?course=probability&view=library');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.textContent).toContain('课堂笔记 · 冲突测试样例.pdf'));
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('课堂笔记 · 冲突测试样例.pdf'))?.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '暂不采纳')?.click());
  const reason = container.querySelector('input[value="outdated"]') as HTMLInputElement;
  await act(async () => { reason.click(); });
  const submit = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '提交反馈并暂停使用');
  expect(submit?.hasAttribute('disabled')).toBe(false);

  await act(async () => submit?.click());

  expect(vi.mocked(fetch).mock.calls.some(([url, options]) => url === '/api/materials/note-1' && options?.method === 'PATCH' && options.body === JSON.stringify({ action: 'pause-conflict', reason: 'outdated', note: '' }))).toBe(true);
});

it('shows a paused conflict and its reason without blocking other materials', async () => {
  currentWorkspace = {
    ...workspace,
    materials: [{
      id: 'note-1', courseId: 'probability', name: '课堂笔记 · 冲突测试样例.pdf', mime: 'application/pdf',
      size: 1024, fixture: 'note', chapter: '事件独立性', status: 'review', excluded: false,
      conflictResolution: 'paused', conflictFeedbackReason: 'outdated', conflictFeedbackNote: '课程采用新版。', conflictResolvedAt: '2026-09-22T00:00:00.000Z',
      origin: '自编中文演示资料', createdAt: '2026-09-09T13:28:00.000Z',
    }],
  };
  window.history.replaceState(null, '', '/?course=probability&view=library');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.textContent).toContain('课堂笔记 · 冲突测试样例.pdf'));

  expect(container.textContent).toContain('冲突暂停');
  expect(container.textContent).not.toContain('1 份笔记需要你确认');
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('课堂笔记 · 冲突测试样例.pdf'))?.click());
  expect(container.textContent).toContain('因内容冲突已暂停');
  expect(container.textContent).toContain('参考资料已过时');
  expect(container.textContent).toContain('课程采用新版。');
  expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === '重新核对')).toBe(true);
});

it('shows when the reference conclusion has been adopted', async () => {
  currentWorkspace = {
    ...workspace,
    materials: [{
      id: 'note-1', courseId: 'probability', name: '课堂笔记 · 冲突测试样例.pdf', mime: 'application/pdf',
      size: 1024, fixture: 'note', chapter: '事件独立性', status: 'review', excluded: false,
      conflictResolution: 'accepted_reference', conflictFeedbackReason: null, conflictFeedbackNote: null, conflictResolvedAt: '2026-09-22T00:00:00.000Z',
      origin: '自编中文演示资料', createdAt: '2026-09-09T13:28:00.000Z',
    }],
  };
  window.history.replaceState(null, '', '/?course=probability&view=library');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.textContent).toContain('课堂笔记 · 冲突测试样例.pdf'));

  expect(container.textContent).toContain('已采纳参考结论');
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('课堂笔记 · 冲突测试样例.pdf'))?.click());
  expect(container.textContent).toContain('后续复习内容将采用参考结论，原始笔记未修改');
  expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === '重新核对')).toBe(true);
});

it('keeps an inbox file pending until its course is confirmed', async () => {
  currentWorkspace = { ...workspace, courses: [...workspace.courses, { id: 'chinese', name: '高中语文' }] };
  let item = { id: 'inbox-1', name: '课堂笔记.txt', mime: 'text/plain', size: 42, source: '本机上传', courseId: 'probability', createdAt: '2026-09-27T00:00:00.000Z' };
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/workspace') return response(currentWorkspace);
    if (url === '/api/import-inbox' && !options?.method) return response([item]);
    if (url === '/api/import-inbox/inbox-1' && options?.method === 'PATCH') {
      item = { ...item, courseId: JSON.parse(options.body as string).courseId };
      return response(item);
    }
    return response({ conversations: [], messages: [] });
  }));
  window.history.replaceState(null, '', '/?course=probability&view=library');
  await act(async () => root.render(<Workbench />));
  await vi.waitFor(() => expect(container.textContent).toContain('这里还没有资料'));
  await act(async () => (container.querySelector('.page-heading button') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(document.querySelector('.inbox-row')?.textContent).toContain('课堂笔记.txt'));
  expect(vi.mocked(fetch).mock.calls.some(([url, options]) => url === '/api/import-inbox/inbox-1' && options?.method === 'POST')).toBe(false);
  const select = document.querySelector('select[aria-label="课堂笔记.txt所属课程"]') as HTMLSelectElement;
  await act(async () => { select.value = 'chinese'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await vi.waitFor(() => expect(item.courseId).toBe('chinese'));
  await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === '稍后处理')?.click());
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('.nav-item')).find(button => button.textContent?.includes('我的资料'))?.click());
  await act(async () => (container.querySelector('.page-heading button') as HTMLButtonElement).click());
  await vi.waitFor(() => expect((document.querySelector('select[aria-label="课堂笔记.txt所属课程"]') as HTMLSelectElement).value).toBe('chinese'));
});
