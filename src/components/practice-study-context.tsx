'use client';
import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { Bookmark, Check, LoaderCircle, PencilLine, RotateCw } from 'lucide-react';
import { questionRefKey, type QuestionRef, type QuestionStudyState } from '@/lib/practice-hub';
import { Button } from './ui/button';

type Changes = { favorite?: boolean; manualWrong?: boolean; tags?: string[]; note?: string; consolidated?: boolean };
type StudyContext = { states: QuestionStudyState[]; loading: boolean; error: string; change: (refs: QuestionRef[], changes: Changes, revision?: number) => Promise<void>; reload: () => Promise<void> };
const Study = createContext<StudyContext | null>(null);
export function PracticeStudyProvider({ courseId, children }: { courseId: string; children: ReactNode }) {
  const [states, setStates] = useState<QuestionStudyState[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const reload = useCallback(async () => {
    const response = await fetch(`/api/practice-state?courseId=${encodeURIComponent(courseId)}`, { cache: 'no-store' });
    const result = await response.json(); if (!response.ok) throw Error(result.error || '收藏和复盘笔记读取失败，请重试。');
    setStates(result.states); setError('');
  }, [courseId]);
  useEffect(() => { let alive = true; setLoading(true); void reload().catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [reload]);
  async function change(refs: QuestionRef[], changes: Changes, revision?: number) {
    const response = await fetch('/api/practice-state', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId, refs, changes, ...(revision !== undefined ? { revision } : {}) }) });
    const result = await response.json(); if (!response.ok) throw Error(result.error || '保存失败，请保留文字并重试。');
    setStates(result.states); setError('');
  }
  return <Study.Provider value={{ states, loading, error, change, reload }}>{children}</Study.Provider>;
}
export const usePracticeStudy = () => useContext(Study);
export function QuestionStudyControls({ question, editable = false, primaryAction }: { question: QuestionRef; editable?: boolean; primaryAction?: ReactNode }) {
  const study = usePracticeStudy(), key = questionRefKey(question), state = study?.states.find(s => s.key === key);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState(state?.note ?? ''), [tags, setTags] = useState(state?.tags.join('，') ?? '');
  const [reviewOpen, setReviewOpen] = useState(false), reviewId = useId();
  useEffect(() => { setReviewOpen(false); }, [key]);
  useEffect(() => { setNote(state?.note ?? ''); }, [key, state?.note]);
  const savedTags = state?.tags.join('，') ?? '';
  useEffect(() => { setTags(savedTags); }, [key, savedTags]);
  if (!study) return <>{primaryAction}</>;
  async function change(changes: Changes) { setBusy(true); setError(''); try { await study!.change([question], changes, state?.revision ?? 0); } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试。'); } finally { setBusy(false); } }
  return <div className="question-study-controls">
    <div className="question-study-buttons">
      {primaryAction}
      <Button size="sm" variant="ghost" disabled={busy || study.loading || !!study.error} aria-pressed={state?.favorite ?? false} onClick={() => void change({ favorite: !state?.favorite })}><Bookmark size={15} fill={state?.favorite ? 'currentColor' : 'none'}/>{state?.favorite ? '已收藏' : '收藏题目'}</Button>
      <Button size="sm" variant="ghost" disabled={busy || study.loading || !!study.error} aria-pressed={state?.manualWrong ?? false} onClick={() => void change({ manualWrong: !state?.manualWrong })}><RotateCw size={15}/>{state?.manualWrong ? '已加入错题' : '加入错题集'}</Button>
      {editable && <Button size="sm" variant="ghost" disabled={busy || study.loading} onClick={() => void change({ consolidated: true })}><Check size={15}/>标记已巩固</Button>}
      {editable && <Button size="sm" variant="ghost" aria-expanded={reviewOpen} aria-controls={reviewId} onClick={() => setReviewOpen(open => !open)}><PencilLine size={14}/>标签与复盘笔记{state?.note ? ' · 已记录' : ''}</Button>}
      {busy && <LoaderCircle size={15} className="spin" aria-label="正在保存学习状态"/>}
    </div>
    {editable && <div id={reviewId} className="question-review-editor" hidden={!reviewOpen}><label>标签<input value={tags} maxLength={350} placeholder="如：文言文，审题；用逗号分隔" onChange={e => setTags(e.target.value)}/></label><label>复盘笔记<textarea rows={3} value={note} maxLength={8000} placeholder="记下错因、关键步骤或下次要注意的地方" onChange={e => setNote(e.target.value)}/></label><Button size="sm" disabled={busy || study.loading} onClick={() => void change({ note, tags: tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) })}>保存笔记与标签</Button></div>}
    {(error || study.error) && <p role="alert" className="modal-error">{error || study.error}<Button size="sm" variant="ghost" onClick={() => void study.reload().catch(e => setError(e.message))}>刷新学习状态</Button></p>}
  </div>;
}
