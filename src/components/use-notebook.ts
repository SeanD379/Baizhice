'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotebookData, NotebookDocument } from '@/lib/notebook';
import { equalContent } from '@/lib/notebook';
import { openNotebookDrafts, uploadLocalImages } from './notebook-local-assets';

type Mutation = { revision: number; requestId: string; document: NotebookDocument; checkpoint?: string };
type Draft = { data: NotebookData; mutation: Mutation | null };
export async function notebookDraft(action: 'read' | 'write' | 'delete', courseId: string, value?: Draft): Promise<Draft | null> {
  if (typeof indexedDB === 'undefined') { if (action === 'write') throw new Error('浏览器无法保留离线草稿，请保持页面打开直到同步完成。'); return null; }
  return new Promise((resolve, reject) => {
    void openNotebookDrafts().then(database => {
      const transaction = database.transaction('drafts', action === 'read' ? 'readonly' : 'readwrite'), store = transaction.objectStore('drafts');
      const request = action === 'read' ? store.get(courseId) : action === 'write' ? store.put(value, courseId) : store.delete(courseId);
      let result: Draft | null = null;
      request.onsuccess = () => { if (action === 'read') result = request.result ?? null; };
      transaction.oncomplete = () => { database.close(); resolve(result); };
      const failed = () => { database.close(); if (action === 'write') reject(new Error('浏览器空间不足，草稿暂只保留在本页，请保持页面打开并重试同步。')); else resolve(null); };
      transaction.onerror = failed; transaction.onabort = failed;
    }).catch(reason => action === 'write' ? reject(reason) : resolve(null));
  });
}
async function readNotebook(courseId: string): Promise<NotebookData> {
  const response = await fetch(`/api/notebooks/${encodeURIComponent(courseId)}`, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '暂时无法读取笔记。');
  return data;
}
export function useNotebookStore(courseId: string, enabled: boolean) {
  const [data, setData] = useState<NotebookData | null>(null), [status, setStatus] = useState('正在打开笔记'), [error, setError] = useState('');
  const [conflict, setConflict] = useState<NotebookData | null>(null);
  const current = useRef<NotebookData | null>(null), baseline = useRef<NotebookData | null>(null), pending = useRef<Mutation | null>(null), dirty = useRef(false), inFlight = useRef(false), checkpoint = useRef<string | undefined>(undefined), epoch = useRef(0), conflictRef = useRef<NotebookData | null>(null);
  const endpoint = `/api/notebooks/${encodeURIComponent(courseId)}`;
  const editingActive = useRef(false);
  const draftRetained = useRef(true);
  const setEditingActive = useCallback((value: boolean) => { editingActive.current = value; }, []);
  const publish = useCallback((next: NotebookData | null) => { current.current = next; setData(next); }, []);
  const setRemoteConflict = useCallback((remote: NotebookData) => { conflictRef.current = remote; setConflict(remote); setStatus('有同步冲突，草稿已保留'); }, []);
  const retainDraft = useCallback(async (draft: Draft) => {
    try { await notebookDraft('write', courseId, draft); draftRetained.current = true; }
    catch (reason) { draftRetained.current = false; setError(reason instanceof Error ? reason.message : '离线草稿无法保留，请保持页面打开。'); setStatus('本页待同步'); if (navigator.onLine === false) throw reason; }
  }, [courseId]);
  const flush = useCallback(async (summary?: string) => {
    if (summary) checkpoint.current = summary;
    if (!current.current || inFlight.current || conflictRef.current) return false;
    const turn = epoch.current;
    const snapshot = current.current;
    inFlight.current = true;
    try {
      if (!dirty.current && !pending.current) {
        if (checkpoint.current) {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'checkpoint', summary: checkpoint.current }) });
          if (!response.ok) throw new Error('版本暂未保存，请重试。');
          checkpoint.current = undefined;
        }
        return true;
      }
      const mutation = pending.current ?? { revision: snapshot.revision, requestId: crypto.randomUUID(), document: snapshot.document, checkpoint: checkpoint.current };
      pending.current = mutation;
      await retainDraft({ data: snapshot, mutation });
      if (navigator.onLine === false) { setStatus('离线修改，等待同步'); return false; }
      const uploaded = await uploadLocalImages(mutation.document);
      if (turn !== epoch.current) return false;
      if (!equalContent(uploaded, mutation.document)) {
        const local = await uploadLocalImages(current.current!.document);
        mutation.document = uploaded; pending.current = mutation; publish({ ...current.current!, document: local });
        await retainDraft({ data: current.current!, mutation });
      }
      setStatus('正在保存');
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation) });
      const result = await response.json();
      if (turn !== epoch.current) return false;
      if (response.status === 409 && result.current) {
        if (!equalContent(result.current.document, mutation.document)) { setRemoteConflict(result.current); return false; }
      } else if (!response.ok) throw new Error(result.error ?? '保存失败，请重试。');
      const saved: NotebookData = response.status === 409 ? result.current : result;
      if (!equalContent(saved.document, mutation.document)) { setRemoteConflict(saved); return false; }
      const local = current.current!;
      baseline.current = saved; pending.current = null;
      if (mutation.checkpoint === checkpoint.current) checkpoint.current = undefined;
      dirty.current = !equalContent(local.document, mutation.document);
      publish(dirty.current ? { ...saved, document: local.document } : saved);
      setError(''); setStatus(dirty.current ? '待保存' : '已保存');
      if (dirty.current) await retainDraft({ data: current.current!, mutation: null });
      else await notebookDraft('delete', courseId);
      return !dirty.current;
    } catch (reason) {
      if (turn === epoch.current) { setError(reason instanceof Error ? reason.message : '网络暂不可用'); setStatus(draftRetained.current ? '草稿已保留，等待重试' : '本页待同步，请保持页面打开'); }
      return false;
    } finally { if (turn === epoch.current) inFlight.current = false; }
  }, [courseId, endpoint, publish, setRemoteConflict, retainDraft]);

  useEffect(() => {
    if (!enabled) return;
    const turn = ++epoch.current;
    publish(null); baseline.current = null; pending.current = null; dirty.current = false; inFlight.current = false; checkpoint.current = undefined; conflictRef.current = null; setConflict(null); setError(''); setStatus('正在打开笔记');
    void (async () => {
      const draft = await notebookDraft('read', courseId);
      try {
        const remote = await readNotebook(courseId);
        if (turn !== epoch.current) return;
        baseline.current = remote;
        if (draft && !equalContent(draft.data.document, remote.document)) {
          publish(draft.data); dirty.current = true; pending.current = draft.mutation;
          if (draft.data.revision !== remote.revision) setRemoteConflict(remote); else setStatus('已恢复未同步草稿');
        } else { publish(remote); setStatus('已保存'); if (draft) await notebookDraft('delete', courseId); }
      } catch (reason) {
        if (turn !== epoch.current) return;
        if (draft) { publish(draft.data); dirty.current = true; pending.current = draft.mutation; setStatus('离线草稿，等待同步'); }
        else { setError(reason instanceof Error ? reason.message : '无法打开笔记'); setStatus('笔记暂不可用'); }
      }
    })();
    return () => { ++epoch.current; };
  }, [courseId, enabled, publish, setRemoteConflict]);
  useEffect(() => {
    if (!data || !dirty.current) return;
    const timer = setTimeout(() => void flush(), 1000);
    return () => clearTimeout(timer);
  }, [data, flush]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = async () => {
      if (document.visibilityState === 'hidden' || inFlight.current || conflictRef.current) return;
      if (dirty.current || pending.current || checkpoint.current) { await flush(); return; }
      const turn = epoch.current;
      try { const remote = await readNotebook(courseId); if (turn !== epoch.current || dirty.current || inFlight.current) return; if (remote.revision !== current.current?.revision) { if (editingActive.current) { setRemoteConflict(remote); return; } baseline.current = remote; publish(remote); setStatus('已同步'); } }
      catch { /* Keep the last readable notebook while disconnected. */ }
    };
    const interval = setInterval(() => void refresh(), 3000);
    const online = () => void refresh();
    const offline = () => setStatus(dirty.current ? '离线修改，等待同步' : '离线阅读');
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('online', online); window.addEventListener('offline', offline); window.addEventListener('beforeunload', beforeUnload); document.addEventListener('visibilitychange', online);
    return () => { clearInterval(interval); window.removeEventListener('online', online); window.removeEventListener('offline', offline); window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('visibilitychange', online); };
  }, [courseId, enabled, flush, publish, setRemoteConflict]);
  function update(transform: (document: NotebookDocument) => NotebookDocument) {
    if (!current.current) return;
    const next = { ...current.current, document: transform(structuredClone(current.current.document)) };
    if (equalContent(next.document, current.current.document)) return;
    dirty.current = true; publish(next); setStatus(navigator.onLine === false ? '离线修改，等待同步' : '待保存');
    void retainDraft({ data: next, mutation: pending.current }).catch(() => {});
  }
  function resolveConflict(keepLocal: boolean) {
    const remote = conflictRef.current, local = current.current;
    if (!remote || !local) return;
    const merged = structuredClone(remote.document);
    if (keepLocal) merged.paperType = local.document.paperType ?? 'blank';
    const changed = local.document.pages.filter(page => !merged.pages.some(other => equalContent(other, page)) || !equalContent(local.document.chapters.find(chapter => chapter.id === page.chapterId), merged.chapters.find(chapter => chapter.id === page.chapterId)));
    const copyDocument = (document: NotebookDocument['pages'][number]['doc']): NotebookDocument['pages'][number]['doc'] => ({ ...document, ...(document.type === 'sourceBlock' ? { attrs: { ...document.attrs, id: `copy-${crypto.randomUUID()}` } } : {}), ...(document.content ? { content: document.content.map(copyDocument) } : {}) });
    const copies = changed.map(page => ({ ...page, id: crypto.randomUUID(), chapterId: null, title: `${page.title}（本机稿）`.slice(0, 120), doc: copyDocument(page.doc) }));
    if (keepLocal) {
      const chapter = { id: crypto.randomUUID(), title: '同步冲突保留的活页' };
      if (copies.length) { merged.chapters.push(chapter); merged.pages.push(...copies.map(page => ({ ...page, chapterId: chapter.id }))); }
    } else merged.trash.push(...copies.map(page => ({ ...page, deletedAt: new Date().toISOString() })));
    for (const note of local.document.inbox) if (!merged.inbox.some(other => equalContent(other, note))) {
      const copy = { ...note, id: crypto.randomUUID(), doc: copyDocument(note.doc) };
      if (keepLocal) merged.inbox.push(copy); else merged.trash.push({ id: copy.id, title: `${copy.title}（本机稿）`.slice(0, 120), chapterId: null, doc: copy.doc, deletedAt: new Date().toISOString() });
    }
    for (const page of local.document.trash) if (!merged.trash.some(other => equalContent(other, page))) merged.trash.push({ ...page, id: crypto.randomUUID(), doc: copyDocument(page.doc) });
    baseline.current = remote; pending.current = null; conflictRef.current = null; setConflict(null); setError('');
    dirty.current = !equalContent(merged, remote.document);
    publish({ ...remote, document: merged }); setStatus(dirty.current ? '待保存' : '已保存');
    if (dirty.current) { checkpoint.current = '保留同步冲突稿'; void retainDraft({ data: current.current!, mutation: null }).catch(() => {}); }
    else void notebookDraft('delete', courseId);
  }
  return { data: data?.courseId === courseId ? data : null, status, error, conflict: conflict?.courseId === courseId ? conflict : null, update, flush, resolveConflict, setEditingActive, getCurrent: () => current.current, reload: async () => { if (!current.current || await flush()) { const remote = await readNotebook(courseId); baseline.current = remote; publish(remote); setError(''); setStatus('已保存'); } } };
}
export type NotebookStore = ReturnType<typeof useNotebookStore>;
