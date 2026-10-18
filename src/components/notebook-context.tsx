'use client';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { BookPlus } from 'lucide-react';
import { appendDocument, sourceDocument, type NotebookOrigin, type RichNode } from '@/lib/notebook';
import type { NotebookStore } from './use-notebook';
import { NotebookContent } from './notebook-content';
import { Modal } from './ui/modal';
import { Button } from './ui/button';

type Capture = { title: string; body?: string; doc?: RichNode; origin: NotebookOrigin };
const Context = createContext<{ store: NotebookStore; capture: (note: Capture) => void } | null>(null);
export function useNotebookContext() { return useContext(Context); }
export function CaptureButton({ title, body, origin, doc, className }: Capture & { className?: string }) {
  const notebook = useNotebookContext();
  if (!notebook) return null;
  return <Button size="sm" variant="ghost" className={className} disabled={!notebook.store.data} onClick={() => notebook.capture({ title, body, doc, origin })}><BookPlus size={14}/>加入笔记</Button>;
}
export function NotebookProvider({ store, children }: { store: NotebookStore; children: ReactNode }) {
  const [capture, setCapture] = useState<Capture | null>(null), [title, setTitle] = useState(''), [destination, setDestination] = useState('inbox'), [chapter, setChapter] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('');
  function open(note: Capture) { setCapture(note); setTitle(note.title.slice(0, 120)); setDestination('inbox'); setChapter(''); setError(''); }
  const document = useMemo(() => capture?.doc ?? (capture ? sourceDocument(capture.body ?? '', capture.origin, `capture-${crypto.randomUUID()}`) : undefined), [capture]);
  function confirm() {
    const current = store.getCurrent()?.document;
    if (!current || !document) { setError('笔记尚未打开，请稍后重试。'); return; }
    if (destination !== 'inbox' && destination !== 'new' && !current.pages.some(page => page.id === destination)) { setError('目标知识点已被移动或删除，请重新选择保存位置。'); return; }
    if (destination === 'new' && chapter && !current.chapters.some(item => item.id === chapter)) { setError('目标章节已变化，请重新选择。'); return; }
    const noteDoc = structuredClone(document), id = crypto.randomUUID();
    store.update(current => {
      if (destination === 'inbox') current.inbox.push({ id, title: title.trim(), doc: noteDoc, createdAt: new Date().toISOString() });
      else if (destination === 'new') current.pages.push({ id, title: title.trim(), chapterId: chapter || null, doc: noteDoc });
      else { const page = current.pages.find(page => page.id === destination)!; page.doc = appendDocument(page.doc, noteDoc); }
      return current;
    });
    void store.flush('收录学习内容'); setCapture(null); setMessage('已加入笔记，可继续当前学习'); setTimeout(() => setMessage(''), 4000);
  }
  return <Context.Provider value={{ store, capture: open }}>{children}{message && <div className="notebook-capture-toast" role="status" onClick={() => setMessage('')}>{message}</div>}<Modal open={!!capture} onOpenChange={open => { if (!open) setCapture(null); }} title="加入我的活页笔记" error={error} description="收录后可以继续补充和修改，当前阅读位置会保留。"><label className="notebook-form-label">笔记标题<input value={title} maxLength={120} onChange={event => setTitle(event.target.value)}/></label><label className="notebook-form-label">保存位置<select value={destination} onChange={event => setDestination(event.target.value)}><option value="inbox">先存到待整理</option><option value="new">新建知识点</option>{store.data?.document.pages.map(page => <option key={page.id} value={page.id}>{store.data?.document.chapters.find(chapter => chapter.id === page.chapterId)?.title ?? '未分类'} / {page.title}</option>)}</select></label>{destination === 'new' && <label className="notebook-form-label">章节<select value={chapter} onChange={event => setChapter(event.target.value)}><option value="">未分类</option>{store.data?.document.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select></label>}<div className="notebook-capture-preview">{document && <NotebookContent node={document}/>}</div><div className="modal-footer"><Button onClick={() => setCapture(null)}>取消</Button><Button variant="primary" disabled={!title.trim() || !store.data || !document} onClick={confirm}>确认收录</Button></div></Modal></Context.Provider>;
}
