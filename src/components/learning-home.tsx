'use client';

import { type ChangeEvent, type DragEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { BookOpen, Bot, Copy, FileText, History, ListChecks, LoaderCircle, PencilLine, Plus, UserRound } from 'lucide-react';
import { Button } from './ui/button';
import { Markdown } from './markdown';
import { CaptureButton } from './notebook-context';
import PromptBar from './react-bits/PromptBar';
import { ChatThinking, type ChatRun } from './chat-thinking';
import type { ChatAttachment, ChatMessage, ConversationSummary } from '@/lib/types';

type LearningHomeProps = {
  courseId: string;
  initialConversationId: string | null;
  conversations: ConversationSummary[];
  onConversationsChange: (conversations: ConversationSummary[]) => void;
  onSelectConversation: (id: string | null) => void;
  onOpenHistory: () => void;
  historyOpen?: boolean;
};

const quickActions = [
  { label: '解释一个概念', prompt: '请结合这门课的资料，解释一个我正在学习的概念。', icon: BookOpen },
  { label: '整理重点', prompt: '帮我整理这门课当前最重要的复习重点。', icon: FileText },
  { label: '根据资料出题', prompt: '请根据我的课程资料，围绕需要巩固的知识点出几道练习题。', icon: ListChecks },
];
const chatSources = [{ key: 'files', name: '添加资料', description: '从本机选择课程资料', icon: <FileText size={15}/>, attach: true }];
const noChatPickers: [] = [];

async function readResponse<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({ error: '服务暂时不可用，请稍后重试。' }));
  if (!response.ok) throw new Error(body.error ?? '操作失败，请稍后重试。');
  return body;
}

function localMessage(role: 'user' | 'assistant', content: string, attachments: ChatAttachment[] = [], status: 'complete' | 'error' = 'complete'): ChatMessage {
  return { id: `local-${Date.now()}-${Math.random()}`, role, content, status, attachments, createdAt: new Date().toISOString() };
}

function MessageAttachments({ attachments, label }: { attachments: ChatAttachment[]; label: string }) {
  if (!attachments.length) return null;
  return <div className="chat-message-files"><span>{label}</span>{attachments.map(file => <span key={`${file.materialId ?? file.name}-${file.name}`}><FileText size={13}/>{file.name}</span>)}</div>;
}

export function LearningHome({ courseId, initialConversationId, conversations, onConversationsChange, onSelectConversation, onOpenHistory, historyOpen = false }: LearningHomeProps) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null), [editDraft, setEditDraft] = useState(''), [editError, setEditError] = useState(''), [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [editSize, setEditSize] = useState<{ width: number; height: number } | null>(null);
  const [runs, setRuns] = useState<ChatRun[]>([]);
  const requestSequence = useRef(0);
  const chatContext = useRef({ courseId, conversationId: initialConversationId });
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const editInput = useRef<HTMLTextAreaElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatContext.current.courseId !== courseId || chatContext.current.conversationId !== initialConversationId) {
      requestSequence.current++;
      setRuns([]); setBusy(false); setFiles([]); setDraft(''); setError(''); setMessages([]);
    }
    chatContext.current = { courseId, conversationId: initialConversationId };
    setConversationId(initialConversationId);
    setEditingId(null); setEditError('');
    let active = true;
    setLoadingHistory(true);
    const query = new URLSearchParams({ courseId });
    if (initialConversationId) query.set('conversationId', initialConversationId);
    if (!initialConversationId) { setMessages([]); setDraft(''); }
    void readResponse<{ conversations: ConversationSummary[]; messages: ChatMessage[] }>(`/api/chat?${query.toString()}`)
      .then(result => { if (active) { setMessages(result.messages); onConversationsChange(result.conversations); } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '无法打开这段对话。'); })
      .finally(() => { if (active) setLoadingHistory(false); });
    return () => { active = false; };
  }, [courseId, initialConversationId, onConversationsChange]);

  useEffect(() => () => { requestSequence.current++; }, []);
  useEffect(() => { if (typeof threadEnd.current?.scrollIntoView === 'function') threadEnd.current.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'end' }); }, [messages, busy, runs.at(-1)?.steps.length]);
  useEffect(() => { if (!copiedId) return; const timer = setTimeout(() => setCopiedId(null), 2000); return () => clearTimeout(timer); }, [copiedId]);
  useEffect(() => {
    const dismissActions = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest('[data-chat-user-bubble]'))) {
        setActiveMessageId(null);
        if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-chat-user-bubble]')) document.activeElement.blur();
      }
    };
    document.addEventListener('pointerdown', dismissActions);
    return () => document.removeEventListener('pointerdown', dismissActions);
  }, []);
  useEffect(() => { if (editInput.current) { editInput.current.style.height = 'auto'; editInput.current.style.height = `${editInput.current.scrollHeight}px`; } }, [editingId, editDraft]);

  function addFiles(nextFiles: FileList | File[]) {
    if (busy || editingId || loadingHistory) return;
    setFiles(current => [...current, ...Array.from(nextFiles).filter(file => !current.some(existing => existing.name === file.name && existing.size === file.size))]);
    setError('');
  }

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  function beginRun() {
    const id = ++requestSequence.current;
    const startedAt = performance.now();
    setRuns(current => [...current.filter(run => run.messageId), { id, startedAt, status: 'working', label: '正在准备问题…', steps: [] }]);
    return id;
  }

  function advanceRun(id: number, step: string, label: string) {
    if (id !== requestSequence.current) return;
    setRuns(current => current.map(run => run.id === id ? { ...run, label, steps: [...run.steps, step] } : run));
  }

  function finishRun(id: number, status: 'done' | 'error', messageId?: string) {
    const finishedAt = performance.now();
    setRuns(current => current.map(run => run.id === id ? { ...run, status, messageId, finishedAt } : run));
  }

  async function uploadFile(file: File, runId: number): Promise<ChatAttachment> {
    advanceRun(runId, `上传资料：${file.name}`, '正在上传资料…');
    const form = new FormData();
    form.append('courseId', courseId);
    form.append('file', file);
    const result = await readResponse<{ material: { id: string; name: string } }>('/api/materials', { method: 'POST', body: form });
    if (runId !== requestSequence.current) throw new Error('对话已切换。');
    advanceRun(runId, `提取文字：${file.name}`, '正在提取文字…');
    try { await readResponse(`/api/materials/${encodeURIComponent(result.material.id)}/extraction`, { method: 'POST' }); }
    catch (error) { throw new Error(`${file.name} 已保存，但文字提取未完成：${error instanceof Error ? error.message : '请在资料详情重试。'}`); }
    return { materialId: result.material.id, name: result.material.name };
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || editingId || loadingHistory || (!draft.trim() && !files.length)) return;
    const runId = beginRun();
    const text = draft.trim() || '请帮我整理这些资料。';
    const temporaryId = `pending-${Date.now()}`;
    setBusy(true);
    setError('');
    let attachments: ChatAttachment[] = files.map(file => ({ name: file.name }));
    setMessages(current => [...current, { ...localMessage('user', text, attachments), id: temporaryId }]);
    setDraft('');
    setFiles([]);
    try {
      if (files.length) {
        attachments = [];
        for (const file of files) {
          attachments.push(await uploadFile(file, runId));
          if (runId !== requestSequence.current) return;
        }
      }
      advanceRun(runId, '等待 AI 回答', '等待 AI 回答…');
      const result = await readResponse<{ conversation: { id: string }; userMessage: ChatMessage; assistantMessage: ChatMessage; conversations: ConversationSummary[] }>('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId, conversationId, message: text, materialIds: attachments.flatMap(file => file.materialId ? [file.materialId] : []) }) });
      if (runId !== requestSequence.current) return;
      finishRun(runId, result.assistantMessage.status === 'error' ? 'error' : 'done', result.assistantMessage.id);
      chatContext.current = { courseId, conversationId: result.conversation.id };
      setConversationId(result.conversation.id);
      onSelectConversation(result.conversation.id);
      onConversationsChange(result.conversations);
      setMessages(current => [...current.filter(message => message.id !== temporaryId), result.userMessage, result.assistantMessage]);
    } catch (reason) {
      if (runId !== requestSequence.current) return;
      const message = reason instanceof Error ? reason.message : '这次回答没有完成，请稍后重试。';
      const failedMessage = localMessage('assistant', message, [], 'error');
      finishRun(runId, 'error', failedMessage.id);
      setMessages(current => [...current.filter(item => item.id !== temporaryId), failedMessage]);
      setError(message);
    } finally { if (runId === requestSequence.current) setBusy(false); }
  }

  async function copyMessage(message: ChatMessage) {
    try { await navigator.clipboard.writeText(message.content); setCopiedId(message.id); }
    catch { setError('复制失败，请选中文字后手动复制。'); }
  }

  async function resendEditedMessage() {
    const original = messages.find(message => message.id === editingId);
    if (!original || !conversationId || busy || (!editDraft.trim() && !original.attachments.length)) return;
    const runId = beginRun();
    advanceRun(runId, '等待 AI 回答', '等待 AI 重新回答…');
    setBusy(true); setEditError('');
    try {
      const result = await readResponse<{ conversation: { id: string }; messages: ChatMessage[]; conversations: ConversationSummary[] }>('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId, conversationId, editMessageId: original.id, message: editDraft.trim() }) });
      if (runId !== requestSequence.current) return;
      const assistant = result.messages.at(-1)!;
      finishRun(runId, assistant.status === 'error' ? 'error' : 'done', assistant.id);
      setRuns(current => current.filter(run => !run.messageId || result.messages.some(message => message.id === run.messageId)));
      chatContext.current = { courseId, conversationId: result.conversation.id };
      setMessages(result.messages);
      setConversationId(result.conversation.id);
      onConversationsChange(result.conversations);
      setEditingId(null);
    } catch (reason) { if (runId === requestSequence.current) { finishRun(runId, 'error'); setEditError(reason instanceof Error ? reason.message : '重新发送失败，请重试。'); } }
    finally { if (runId === requestSequence.current) setBusy(false); }
  }

  function startNewChat() {
    if (busy) return;
    requestSequence.current++;
    chatContext.current = { courseId, conversationId: null };
    setRuns([]);
    setConversationId(null);
    setMessages([]);
    setDraft('');
    setFiles([]);
    setError('');
    setEditingId(null);
    onSelectConversation(null);
  }

  const activeConversation = conversations.find(item => item.id === conversationId);
  const isEmpty = !loadingHistory && messages.length === 0;
  const latestUserId = messages.filter(message => message.role === 'user').at(-1)?.id;

  return <section className={`chat-workspace chat-redesign ${isEmpty ? 'chat-empty' : ''}`} aria-labelledby="ai-home-title">
    <header className="chat-heading">
      <div><h1 id="ai-home-title">{activeConversation?.title ?? '今天想怎么学习？'}</h1>{isEmpty && <p>问一个问题，或把资料交给 AI，从一件小事开始。</p>}</div>
      <div className="chat-page-actions">
        {!isEmpty && <Button variant="ghost" onClick={startNewChat} disabled={busy}><Plus size={16}/>新对话</Button>}
        <Button className="chat-history-entry" variant="ghost" aria-label="对话历史" title="对话历史" aria-haspopup="dialog" aria-expanded={historyOpen} onClick={onOpenHistory}><History size={16}/><span className="chat-history-label">对话历史</span></Button>
      </div>
    </header>

    {!isEmpty && <div className="chat-thread" aria-live="polite">
      {loadingHistory && <div className="chat-loading"><LoaderCircle size={19} className="spin"/>正在打开这段对话…</div>}
      {messages.map(message => <article className={`chat-message chat-message-${message.role} ${message.status === 'error' ? 'chat-message-error' : ''}`} key={message.id}>
        <div className="chat-message-label"><span className={`chat-avatar chat-avatar-${message.role}`} aria-hidden="true">{message.role === 'user' ? <UserRound size={14}/> : <Bot size={15}/>}</span><span className="chat-message-author">{message.role === 'user' ? '我' : 'AI 学习助手'}<time>{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></span></div>
        {runs.filter(run => run.messageId === message.id).map(run => <ChatThinking key={run.id} run={run}/>)}
        {editingId === message.id ? <div className="chat-message-edit-group" style={editSize ? { width: editSize.width } : undefined}>
          <div className="chat-message-body chat-message-editing" style={editSize ? { minHeight: editSize.height } : undefined}>
            <textarea ref={editInput} aria-label="编辑已发送消息" value={editDraft} onChange={event => setEditDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && !busy) setEditingId(null); if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void resendEditedMessage(); } }} autoFocus rows={1}/>
            <MessageAttachments attachments={message.attachments} label="已添加资料"/>
          </div>
          {editError && <p className="chat-message-edit-error" role="alert">{editError}</p>}
          <div className="chat-message-edit-actions"><Button type="button" variant="ghost" aria-label="取消修改" onClick={() => setEditingId(null)} disabled={busy}>取消</Button><Button type="button" variant="primary" aria-label="重新发送修改后的消息" onClick={() => void resendEditedMessage()} disabled={busy || (!editDraft.trim() && !message.attachments.length)}>{busy && <LoaderCircle size={15} className="spin"/>}重新发送</Button></div>
        </div> : message.role === 'user' ? <div className={`chat-message-body chat-message-selectable ${activeMessageId === message.id ? 'is-selected' : ''}`} data-chat-user-bubble role="group" aria-label="我的消息" tabIndex={0} onClick={() => setActiveMessageId(message.id)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setActiveMessageId(message.id); } }}>
          <p>{message.content}</p><MessageAttachments attachments={message.attachments} label="已添加资料"/>
          <div className="chat-message-actions">
            {message.id === latestUserId && <button type="button" aria-label="修改这条消息" disabled={busy} onClick={event => { const bounds = event.currentTarget.closest('.chat-message-body')?.getBoundingClientRect(); setEditSize(bounds?.width && bounds.height ? { width: bounds.width, height: bounds.height } : null); setEditingId(message.id); setEditDraft(message.content); setEditError(''); }}><PencilLine size={14} strokeWidth={1.8}/>修改</button>}
            <button type="button" aria-label="复制消息文本" onClick={() => void copyMessage(message)}><Copy size={14} strokeWidth={1.8}/>{copiedId === message.id ? '已复制' : '复制'}</button>
          </div>
        </div> : <div className="chat-message-body"><Markdown text={message.content}/>{message.status === 'complete' && <CaptureButton title={message.content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80) || '对话笔记'} body={message.content} origin={{ kind: 'chat', label: 'AI 对话', refs: [], courseId, conversationId: conversationId ?? undefined, messageId: message.id, needsReview: true }}/>}<MessageAttachments attachments={message.attachments} label="关联资料"/>{message.status === 'complete' && <small className="chat-disclosure">AI 生成内容 · 请结合原文核对重要结论</small>}</div>}
      </article>)}
      {runs.filter(run => !run.messageId).map(run => <ChatThinking key={run.id} run={run}/>)}
      <div ref={threadEnd}/>
    </div>}

    {error && <p className="chat-error" role="alert">{error}</p>}
    <form ref={composer} className={`chat-composer chat-composer-redesign ${dragging ? 'is-dragging' : ''}`} onSubmit={submit} onDragOver={event => { event.preventDefault(); if (!busy && !editingId && !loadingHistory) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
      <PromptBar value={draft} onValueChange={setDraft} attachmentNames={files.map(file => file.name)}
        onRemoveAttachment={index => setFiles(current => current.filter((_, i) => i !== index))}
        disabled={busy || !!editingId || loadingHistory} busy={busy} onSend={() => void submit()} onAttach={() => fileInput.current?.click()}
        sources={chatSources} commands={noChatPickers} models={noChatPickers} efforts={noChatPickers}
        width={720} radius={16} background="var(--chat-input)" color="var(--chat-ink)" menuBackground="var(--chat-menu)"
        inputLabel="学习问题或资料处理要求" placeholder={files.length ? '告诉 AI 如何处理这些资料…' : '问 AI、粘贴内容，或把资料拖到这里…'}
        hint={busy ? '正在处理，请稍候…' : editingId ? '先完成或取消上方的修改' : files.length ? `已添加 ${files.length} 份资料` : 'Enter 发送 · Shift + Enter 换行'}/>
      <input ref={fileInput} type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.docx,.pptx,.txt" onChange={handleSelect}/>
      <p className="chat-privacy"><span>点击发送后，问题和你选择的资料会提交给 AI 助手</span></p>
    </form>
    {isEmpty && <div className="chat-quick-actions">{quickActions.map(({ label, prompt, icon: Icon }) => <button type="button" key={label} onClick={() => { setDraft(prompt); composer.current?.querySelector('textarea')?.focus(); }}><Icon size={15}/>{label}</button>)}</div>}
  </section>;
}
