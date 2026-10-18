import { beforeEach, expect, it, vi } from 'vitest';

type Row = { id: string; conversationId: string; role: string; content: string; status: string; attachments: string; createdAt: Date };
const state = vi.hoisted(() => ({ title: '我的对话', messages: [] as Row[] }));
const model = vi.hoisted(() => vi.fn(async () => ({ text: '新回答', model: 'deepseek-flash' })));
vi.mock('@/lib/deepseek', () => ({ requestChatResponse: model }));
vi.mock('@/lib/generation-store', () => ({ generationSources: vi.fn(async () => ({ pages: [{ name: '练习题.docx', page: 1, text: '原文' }] })) }));
vi.mock('@/lib/db', () => {
  const db = {
    course: { findUnique: vi.fn(async () => ({ id: 'course' })) },
    conversation: {
      findFirst: vi.fn(async () => ({ id: 'chat', courseId: 'course', title: state.title })),
      findUniqueOrThrow: vi.fn(async () => ({ id: 'chat', courseId: 'course', title: state.title })),
      findMany: vi.fn(async () => [{ id: 'chat', courseId: 'course', title: state.title, updatedAt: new Date(), _count: { messages: state.messages.length } }]),
      update: vi.fn(async ({ data }: { data: { title: string } }) => { state.title = data.title; return { id: 'chat', title: state.title }; }),
    },
    material: { findMany: vi.fn(async () => [{ id: 'material-1', courseId: 'course', name: '练习题.docx', excluded: false, conflictResolution: null }]) },
    chatMessage: {
      findMany: vi.fn(async () => [...state.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => { state.messages = state.messages.filter(row => !where.id.in.includes(row.id)); return { count: where.id.in.length }; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { content: string } }) => { const row = state.messages.find(item => item.id === where.id)!; row.content = data.content; return row; }),
      create: vi.fn(async ({ data }: { data: { conversationId: string; role: string; content: string; status?: string; attachments: string } }) => { const row = { ...data, id: 'new-answer', status: data.status ?? 'complete', createdAt: new Date('2026-09-27T00:00:04Z') }; state.messages.push(row); return row; }),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (callback: (transaction: typeof db) => Promise<unknown>) => callback(db));
  return { db };
});
import { POST } from './route';

beforeEach(() => {
  state.title = '我的对话';
  state.messages = [
    { id: 'user-1', conversationId: 'chat', role: 'user', content: '第一条', status: 'complete', attachments: '[]', createdAt: new Date('2026-09-27T00:00:00Z') },
    { id: 'answer-1', conversationId: 'chat', role: 'assistant', content: '旧回答一', status: 'complete', attachments: '[]', createdAt: new Date('2026-09-27T00:00:01Z') },
    { id: 'user-2', conversationId: 'chat', role: 'user', content: '整理资料', status: 'complete', attachments: JSON.stringify([{ materialId: 'material-1', name: '练习题.docx' }]), createdAt: new Date('2026-09-27T00:00:02Z') },
    { id: 'answer-2', conversationId: 'chat', role: 'assistant', content: '旧回答二', status: 'complete', attachments: '[]', createdAt: new Date('2026-09-27T00:00:03Z') },
  ];
  model.mockClear();
});

function edit(id: string) {
  return POST(new Request('http://127.0.0.1/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ courseId: 'course', conversationId: 'chat', editMessageId: id, message: '只整理重点' }) }));
}

it('replaces only the latest user turn and reuses its saved attachment', async () => {
  const response = await edit('user-2');
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.conversation.id).toBe('chat');
  expect(body.messages.map((message: Row) => message.id)).toEqual(['user-1', 'answer-1', 'user-2', 'new-answer']);
  expect(body.messages[2].content).toBe('只整理重点');
  expect(body.messages[3].attachments).toEqual([{ materialId: 'material-1', name: '练习题.docx' }]);
  expect(model).toHaveBeenCalledWith('只整理重点', expect.stringContaining('原文'));
});

it('refuses to edit an older user message', async () => {
  const response = await edit('user-1');
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain('最后一条提问');
  expect(state.messages.map(row => row.id)).toEqual(['user-1', 'answer-1', 'user-2', 'answer-2']);
  expect(model).not.toHaveBeenCalled();
});
