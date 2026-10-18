// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LearningHome } from './learning-home';

// Motion is exercised in the browser; keep these request-lifecycle tests deterministic.
vi.mock('motion/react', async importOriginal => ({
  ...await importOriginal<typeof import('motion/react')>(),
  useReducedMotion: () => true,
  animate: () => ({ stop() {}, then: (complete: () => void) => Promise.resolve().then(complete) }),
}));

let root: Root;
let container: HTMLDivElement;
const props = { courseId: 'course', initialConversationId: null, conversations: [], onConversationsChange: vi.fn(), onSelectConversation: vi.fn(), onOpenHistory: vi.fn() };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/chat?') ? response({ conversations: [], messages: [] }) : response({ conversation: { id: 'chat-1' }, userMessage: { id: 'u', role: 'user', content: '我想复习条件概率', status: 'complete', attachments: [], createdAt: new Date().toISOString() }, assistantMessage: { id: 'a', role: 'assistant', content: '可以从定义和使用前提开始。', status: 'complete', attachments: [], createdAt: new Date().toISOString() }, conversations: [{ id: 'chat-1', title: '我想复习条件概率', updatedAt: new Date().toISOString(), messageCount: 2 }] })));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('enables send for text-only questions and keeps quick tasks in the composer', async () => {
  await act(async () => root.render(<LearningHome {...props} />));
  const quickAction = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('整理重点'))!;
  expect(quickAction).toBeTruthy();
  await act(async () => quickAction.click());
  expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toContain('复习重点');
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => { textarea.value = '我想复习条件概率'; textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  const submit = container.querySelector('button[aria-label="发送消息"]') as HTMLButtonElement;
  expect(submit.disabled).toBe(false);
  await act(async () => submit.click());
  expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/chat', expect.objectContaining({ method: 'POST' }));
});

it('keeps module navigation out of the empty chat home', async () => {
  await act(async () => root.render(<LearningHome {...props} />));
  expect(container.textContent).not.toContain('选择已有资料');
  expect(container.textContent).not.toContain('整理复习材料');
  expect(container.textContent).not.toContain('查看复习练习');
});

it('extracts three attached files in sequence before sending them to chat', async () => {
  let active = 0, maxActive = 0, nextId = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/chat?')) return response({ conversations: [], messages: [] });
    if (url === '/api/materials') return response({ material: { id: `material-${++nextId}`, name: `file-${nextId}.txt` } });
    if (url.endsWith('/extraction')) {
      maxActive = Math.max(maxActive, ++active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return response({ result: {} });
    }
    if (url === '/api/chat') return response({ conversation: { id: 'chat-1' }, userMessage: { id: 'u', role: 'user', content: '整理', status: 'complete', attachments: [], createdAt: new Date().toISOString() }, assistantMessage: { id: 'a', role: 'assistant', content: '已整理', status: 'complete', attachments: [], createdAt: new Date().toISOString() }, conversations: [] });
    return response({});
  }));
  await act(async () => root.render(<LearningHome {...props} />));
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [1, 2, 3].map(index => new File(['内容'], `file-${index}.txt`, { type: 'text/plain' })) });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(container.textContent).toContain('已添加 3 份资料');
  await act(async () => (container.querySelector('button[aria-label="发送消息"]') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => url === '/api/chat' && init?.method === 'POST')).toBe(true));
  const chatCall = vi.mocked(fetch).mock.calls.find(([url, init]) => url === '/api/chat' && init?.method === 'POST');
  expect(JSON.parse(chatCall?.[1]?.body as string).materialIds).toHaveLength(3);
  expect(maxActive).toBe(1);
});

it('shows extraction failure instead of asking AI to use unread attachments', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/chat?')) return response({ conversations: [], messages: [] });
    if (url === '/api/materials') return response({ material: { id: 'material-1', name: 'notes.txt' } });
    if (url.endsWith('/extraction')) return response({ error: '文字提取失败' }, 409);
    return response({});
  }));
  await act(async () => root.render(<LearningHome {...props} />));
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['内容'], 'notes.txt', { type: 'text/plain' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => (container.querySelector('button[aria-label="发送消息"]') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(container.textContent).toContain('notes.txt 已保存，但文字提取未完成'));
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => url === '/api/chat' && init?.method === 'POST')).toBe(false);
});

it('edits a sent message and resends it with its saved attachments', async () => {
  const original = { id: 'user-1', role: 'user', content: '整理这三个文件', status: 'complete', attachments: [{ materialId: 'material-1', name: '练习题.docx' }], createdAt: new Date().toISOString() };
  const answer = { id: 'assistant-1', role: 'assistant', content: '旧回答', status: 'complete', attachments: original.attachments, createdAt: new Date().toISOString() };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/chat?')) return response({ conversations: [], messages: [original, answer] });
    if (url === '/api/chat' && init?.method === 'POST') return response({ conversation: { id: 'chat-old' }, messages: [{ ...original, content: '只整理重点' }, { ...answer, id: 'assistant-new', content: '新回答' }], conversations: [] });
    return response({});
  }));
  await act(async () => root.render(<LearningHome {...props} initialConversationId="chat-old" />));
  await vi.waitFor(() => expect(container.textContent).toContain('整理这三个文件'));
  const originalBubble = container.querySelector('[data-chat-user-bubble]') as HTMLDivElement;
  vi.spyOn(originalBubble, 'getBoundingClientRect').mockReturnValue({ width: 358, height: 120 } as DOMRect);
  await act(async () => originalBubble.click());
  expect(originalBubble.classList.contains('is-selected')).toBe(true);
  expect(container.querySelector('textarea[aria-label="编辑已发送消息"]')).toBeNull();
  expect(originalBubble.querySelectorAll('.chat-message-actions button')).toHaveLength(2);
  await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(originalBubble.classList.contains('is-selected')).toBe(false);
  await act(async () => (container.querySelector('button[aria-label="修改这条消息"]') as HTMLButtonElement).click());
  const editor = container.querySelector('textarea[aria-label="编辑已发送消息"]') as HTMLTextAreaElement;
  expect(editor.value).toBe('整理这三个文件');
  expect(editor.rows).toBe(1);
  expect(editor.closest('.chat-message-body')).toBeTruthy();
  expect(editor.closest('.chat-message-body')?.getAttribute('style')).toContain('min-height: 120px');
  expect(editor.closest('.chat-message-edit-group')?.getAttribute('style')).toContain('width: 358px');
  expect(editor.closest('.chat-message-body')?.textContent).toContain('已添加资料');
  expect(editor.closest('.chat-message-body')?.textContent).not.toContain('重新发送');
  expect(container.querySelector('.chat-message-editor')).toBeNull();
  expect(container.textContent).toContain('练习题.docx');
  await act(async () => (container.querySelector('button[aria-label="取消修改"]') as HTMLButtonElement).click());
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => url === '/api/chat' && init?.method === 'POST')).toBe(false);
  await act(async () => (container.querySelector('button[aria-label="修改这条消息"]') as HTMLButtonElement).click());
  const revised = container.querySelector('textarea[aria-label="编辑已发送消息"]') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(revised, '只整理重点');
    revised.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => (container.querySelector('button[aria-label="重新发送修改后的消息"]') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => url === '/api/chat' && init?.method === 'POST')).toBe(true));
  const call = vi.mocked(fetch).mock.calls.find(([url, init]) => url === '/api/chat' && init?.method === 'POST')!;
  expect(JSON.parse(call[1]!.body as string)).toMatchObject({ courseId: 'course', conversationId: 'chat-old', editMessageId: 'user-1', message: '只整理重点' });
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/materials')).toBe(false);
  await vi.waitFor(() => expect(container.textContent).toContain('新回答'));
  expect(container.textContent).not.toContain('旧回答');
});

it('copies older user messages without offering an editor', async () => {
  const now = new Date().toISOString();
  const messages = [
    { id: 'old-user', role: 'user', content: '第一条问题', status: 'complete', attachments: [], createdAt: now },
    { id: 'old-answer', role: 'assistant', content: '第一条回答', status: 'complete', attachments: [], createdAt: now },
    { id: 'latest-user', role: 'user', content: '第二条问题', status: 'complete', attachments: [], createdAt: now },
  ];
  vi.stubGlobal('fetch', vi.fn(async () => response({ conversations: [], messages })));
  const writeText = vi.fn().mockResolvedValue(undefined);
  const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    await act(async () => root.render(<LearningHome {...props} initialConversationId="chat-old" />));
    await vi.waitFor(() => expect(container.textContent).toContain('第二条问题'));
    const oldBubble = container.querySelector('[data-chat-user-bubble]') as HTMLDivElement;
    expect(oldBubble.querySelectorAll('.chat-message-actions button')).toHaveLength(1);
    await act(async () => oldBubble.click());
    expect(oldBubble.classList.contains('is-selected')).toBe(true);
    expect(container.querySelector('textarea[aria-label="编辑已发送消息"]')).toBeNull();
    await act(async () => (oldBubble.querySelector('button[aria-label="复制消息文本"]') as HTMLButtonElement).click());
    expect(writeText).toHaveBeenCalledWith('第一条问题');
    expect(container.querySelector('textarea[aria-label="编辑已发送消息"]')).toBeNull();
    expect(container.querySelectorAll('button[aria-label="修改这条消息"]')).toHaveLength(1);
    expect(container.querySelectorAll('button[aria-label="复制消息文本"]')).toHaveLength(2);
  } finally { if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard); else Reflect.deleteProperty(navigator, 'clipboard'); }
});

function changeDraft(value: string) {
  const textarea = container.querySelector('textarea[aria-label="学习问题或资料处理要求"]') as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return textarea;
}

function chatReply(status: 'complete' | 'error' = 'complete') {
  const createdAt = new Date().toISOString();
  return { conversation: { id: 'chat-1' }, conversations: [],
    userMessage: { id: 'u', role: 'user', content: '解释条件概率', status: 'complete', attachments: [], createdAt },
    assistantMessage: { id: 'a', role: 'assistant', content: status === 'complete' ? '条件概率的解释' : '模型未完成回答', status, attachments: [], createdAt },
  };
}

it('shows one live clock, freezes the elapsed time, and lets the completed trace reopen', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let complete!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.startsWith('/api/chat?') ? Promise.resolve(response({ conversations: [], messages: [] })) : new Promise<Response>(resolve => { complete = resolve; })));
  await act(async () => root.render(<LearningHome {...props} />));
  await act(async () => changeDraft('解释条件概率'));
  await act(async () => (container.querySelector('button[aria-label="发送消息"]') as HTMLButtonElement).click());
  expect(container.querySelectorAll('.lattice-loader__timer')).toHaveLength(1);
  expect(container.querySelector('.thought-line__timer')).toBeNull();
  expect(container.querySelector('.lattice-loader')?.getAttribute('data-status')).toBe('working');
  now = 2500;
  await act(async () => vi.advanceTimersByTime(100));
  expect(container.querySelector('.lattice-loader__timer')?.textContent).toBe('1.5s');
  await act(async () => complete(response(chatReply())));
  await act(async () => vi.advanceTimersByTime(400));
  expect(container.querySelector('.chat-message-assistant .lattice-loader')?.getAttribute('data-status')).toBe('done');
  const toggle = container.querySelector('.thought-line__head') as HTMLButtonElement;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  now = 9500;
  await act(async () => vi.advanceTimersByTime(1000));
  expect(container.querySelector('.lattice-loader__timer')?.textContent).toBe('1.5s');
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
});

it('marks a model error returned with HTTP 200 as a failed step and keeps its trace open', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/chat?')) return response({ conversations: [], messages: [] });
    now = 4200;
    return response(chatReply('error'));
  }));
  await act(async () => root.render(<LearningHome {...props} />));
  await act(async () => changeDraft('解释条件概率'));
  await act(async () => (container.querySelector('button[aria-label="发送消息"]') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(container.querySelector('.lattice-loader')?.getAttribute('data-status')).toBe('error'));
  expect(container.querySelector('.thought-line__head')?.getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('.thought-line__step[data-error]')?.hasAttribute('data-done')).toBe(false);
  expect(container.querySelector('.thought-line__step[data-error]')?.textContent).toContain('等待 AI 回答');
  expect(container.querySelector('.lattice-loader__timer')?.textContent).toBe('3.2s');
  now = 9000;
  await act(async () => vi.advanceTimersByTime(1000));
  expect(container.querySelector('.lattice-loader__timer')?.textContent).toBe('3.2s');
  expect(container.querySelector('.thought-line__head')?.getAttribute('aria-expanded')).toBe('true');
});

it('removes only the selected attachment when two files have the same name', async () => {
  await act(async () => root.render(<LearningHome {...props} />));
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['a'], '笔记.txt'), new File(['abc'], '笔记.txt')] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(container.querySelectorAll('.prompt-bar__chip')).toHaveLength(2);
  await act(async () => (container.querySelector('.prompt-bar__chip-x') as HTMLButtonElement).click());
  expect(container.querySelectorAll('.prompt-bar__chip')).toHaveLength(1);
  expect(container.textContent).toContain('已添加 1 份资料');
});

it('does not send while a Chinese input method is composing, then sends on ordinary Enter', async () => {
  await act(async () => root.render(<LearningHome {...props} />));
  let textarea!: HTMLTextAreaElement;
  await act(async () => { textarea = changeDraft('解释条件概率'); });
  await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => url === '/api/chat' && init?.method === 'POST')).toBe(false);
  await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => url === '/api/chat' && init?.method === 'POST')).toHaveLength(1);
});

it('clears progress on course changes and ignores the previous course response', async () => {
  let complete!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.startsWith('/api/chat?') ? Promise.resolve(response({ conversations: [], messages: [] })) : new Promise<Response>(resolve => { complete = resolve; })));
  await act(async () => root.render(<LearningHome {...props} />));
  await act(async () => changeDraft('解释条件概率'));
  await act(async () => (container.querySelector('button[aria-label="发送消息"]') as HTMLButtonElement).click());
  expect(container.querySelector('.lattice-loader')).toBeTruthy();
  await act(async () => root.render(<LearningHome {...props} courseId="another-course" />));
  expect(container.querySelector('.lattice-loader')).toBeNull();
  await act(async () => complete(response(chatReply())));
  expect(container.textContent).not.toContain('条件概率的解释');
  expect(props.onSelectConversation).not.toHaveBeenCalled();
  expect((container.querySelector('textarea[aria-label="学习问题或资料处理要求"]') as HTMLTextAreaElement).value).toBe('');
});
