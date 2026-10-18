import { requirePrivateAccess } from '@/lib/private-access';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { generationSources } from '@/lib/generation-store';
import { requestChatResponse } from '@/lib/deepseek';
import { checkOrigin, errorResponse } from '@/lib/server';
import type { ChatAttachment, ChatMessage, ConversationSummary } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const messageSchema = z.object({
  courseId: z.string().min(1).max(100),
  conversationId: z.string().min(1).nullable().optional(),
  editMessageId: z.string().min(1).optional(),
  message: z.string().trim().max(4000),
  materialIds: z.array(z.string().min(1)).max(20).default([]),
}).refine(input => input.message.length > 0 || input.materialIds.length > 0 || !!input.editMessageId, { message: '请输入问题或添加至少一份资料。' });
const conversationAction = z.object({ courseId: z.string().min(1).max(100), conversationId: z.string().min(1), title: z.string().trim().min(1).max(80).optional() });

function parseAttachments(value: string): ChatAttachment[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is ChatAttachment => item && typeof item.name === 'string').slice(0, 20) : [];
  } catch { return []; }
}

function publicMessage(message: { id: string; role: string; content: string; status: string; attachments: string; createdAt: Date }): ChatMessage {
  return { id: message.id, role: message.role === 'user' ? 'user' : 'assistant', content: message.content, status: message.status === 'error' ? 'error' : 'complete', attachments: parseAttachments(message.attachments), createdAt: message.createdAt.toISOString() };
}

async function conversationSummaries(courseId: string): Promise<ConversationSummary[]> {
  const conversations = await db.conversation.findMany({ where: { courseId }, orderBy: { updatedAt: 'desc' }, take: 50, include: { _count: { select: { messages: true } } } });
  return conversations.map(conversation => ({ id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt.toISOString(), messageCount: conversation._count.messages }));
}

export async function GET(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const courseId = z.string().min(1).max(100).parse(params.get('courseId'));
    const conversationId = params.get('conversationId');
    if (!await db.course.findUnique({ where: { id: courseId } })) throw new Error('课程不存在。');
    const conversations = await conversationSummaries(courseId);
    if (!conversationId) return NextResponse.json({ conversations, messages: [] });
    const conversation = await db.conversation.findFirst({ where: { id: conversationId, courseId }, include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
    if (!conversation) throw new Error('对话不存在或不属于当前课程。');
    return NextResponse.json({ conversations, messages: conversation.messages.map(publicMessage) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const input = messageSchema.parse(await request.json());
    if (!await db.course.findUnique({ where: { id: input.courseId } })) throw new Error('课程不存在。');
    let conversation = input.conversationId ? await db.conversation.findFirst({ where: { id: input.conversationId, courseId: input.courseId } }) : null;
    if (input.conversationId && !conversation) throw new Error('对话不存在或不属于当前课程。');
    if (input.editMessageId && (!conversation || input.materialIds.length)) throw new Error('无法修改这条消息，请重新打开对话。');
    if (!conversation) conversation = await db.conversation.create({ data: { courseId: input.courseId, title: input.message.trim().slice(0, 36) || '资料整理' } });

    let original: Awaited<ReturnType<typeof db.chatMessage.findFirst>> = null;
    let materialIds = input.materialIds;
    if (input.editMessageId) {
      const previous = await db.chatMessage.findMany({ where: { conversationId: conversation.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const latestUser = previous.filter(message => message.role === 'user').at(-1);
      if (!latestUser || latestUser.id !== input.editMessageId) throw new Error('只能修改当前对话的最后一条提问。');
      original = latestUser;
      const savedAttachments = parseAttachments(original.attachments);
      materialIds = savedAttachments.flatMap(item => item.materialId ? [item.materialId] : []);
      if (materialIds.length !== savedAttachments.length) throw new Error('原附件已无法复用，请重新添加文件。');
    }
    if (!input.message && !materialIds.length) throw new Error('请输入问题或添加至少一份资料。');
    const foundMaterials = materialIds.length ? await db.material.findMany({ where: { id: { in: materialIds }, courseId: input.courseId, excluded: false, conflictResolution: null } }) : [];
    if (foundMaterials.length !== materialIds.length) throw new Error('部分资料不属于当前课程、已被排除或因内容冲突暂停，请重新选择。');
    const materials = materialIds.map(id => foundMaterials.find(material => material.id === id)!);
    const attachments = materials.map(material => ({ materialId: material.id, name: material.name }));
    const content = input.message.trim() || '请帮我整理这些资料。';
    const userMessage = original ? await db.$transaction(async transaction => {
      const previous = await transaction.chatMessage.findMany({ where: { conversationId: conversation.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const index = previous.findIndex(message => message.id === original.id);
      if (index < 0 || previous.slice(index + 1).some(message => message.role === 'user')) throw new Error('只能修改当前对话的最后一条提问。');
      await transaction.chatMessage.deleteMany({ where: { id: { in: previous.slice(index + 1).map(message => message.id) }, conversationId: conversation.id } });
      if (conversation.title === original.content.trim().slice(0, 36)) await transaction.conversation.update({ where: { id: conversation.id }, data: { title: content.slice(0, 36) } });
      return transaction.chatMessage.update({ where: { id: original.id }, data: { content } });
    }) : await db.chatMessage.create({ data: { conversationId: conversation.id, role: 'user', content, attachments: JSON.stringify(attachments) } });
    let assistantContent: string, assistantStatus: 'complete' | 'error' = 'complete', model = '';
    try {
      const sources = await generationSources(input.courseId, materials);
      const sourceText = sources.pages.map(page => `【${page.name} · 第 ${page.page} 页】\n${page.text}`).join('\n\n').slice(0, 40000);
      const result = await requestChatResponse(content, sourceText);
      assistantContent = result.text;
      model = result.model;
    } catch (error) {
      assistantStatus = 'error';
      assistantContent = error instanceof Error ? `这次回答没有完成：${error.message}` : '这次回答没有完成，请稍后重试。';
    }
    const assistantMessage = await db.chatMessage.create({ data: { conversationId: conversation.id, role: 'assistant', content: assistantContent, status: assistantStatus, attachments: JSON.stringify(attachments) } });
    const current = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    await db.conversation.update({ where: { id: conversation.id }, data: { title: current.title } });
    const messages = original ? await db.chatMessage.findMany({ where: { conversationId: conversation.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }) : null;
    return NextResponse.json({ conversation: { id: conversation.id, title: current.title }, userMessage: publicMessage(userMessage), assistantMessage: publicMessage(assistantMessage), messages: messages?.map(publicMessage), model, conversations: await conversationSummaries(input.courseId) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const input = conversationAction.parse(await request.json());
    if (!input.title) throw new Error('请输入对话名称。');
    const conversation = await db.conversation.updateMany({ where: { id: input.conversationId, courseId: input.courseId }, data: { title: input.title } });
    if (!conversation.count) throw new Error('对话不存在或不属于当前课程。');
    return NextResponse.json({ conversations: await conversationSummaries(input.courseId) });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try {
    checkOrigin(request);
    const params = new URL(request.url).searchParams;
    const input = conversationAction.parse({ courseId: params.get('courseId'), conversationId: params.get('conversationId') });
    const conversation = await db.conversation.deleteMany({ where: { id: input.conversationId, courseId: input.courseId } });
    if (!conversation.count) throw new Error('对话不存在或不属于当前课程。');
    return NextResponse.json({ conversations: await conversationSummaries(input.courseId) });
  } catch (error) { return errorResponse(error); }
}
