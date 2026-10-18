'use client';
import { useState } from 'react';
import { ArrowRight, Bookmark, Check, FileText, ListChecks, LoaderCircle, Play } from 'lucide-react';
import { Button } from './ui/button';
import { hubRequest, HubEmpty, useHubSummary, useStudyCatalog } from './practice-hub';
import { QuestionStudyControls, usePracticeStudy } from './practice-study-context';
import SpotlightCard from './react-bits/SpotlightCard';
import { originalRequest } from './use-original-session';
import { blankSession } from '@/lib/practice-session';
import { mistakeFiles, type PracticeHubSummary, type PracticeLocation, type StudyQuestion } from '@/lib/practice-hub';
import type { PracticeData } from '@/lib/practice-store';

export function MistakeFilePractice({ courseId, location, onOpen }: { courseId: string; location: PracticeLocation; onOpen: (location: PracticeLocation) => void | Promise<void> }) {
  const { data, error, refresh } = useHubSummary(courseId, 'mistakes'), catalog = useStudyCatalog(data), study = usePracticeStudy();
  const [bulk, setBulk] = useState(false), [selected, setSelected] = useState<string[]>([]), [status, setStatus] = useState('pending'), [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  const group = data && mistakeFiles(catalog, data.materials).find(file => file.id === (location.materialId ?? location.pageId));
  const items = (group?.questions ?? []).filter(question => status === 'all' || (status === 'consolidated' ? question.consolidated : question.mistake));
  const available = items.filter(question => question.available && !question.needsReview);
  const first = available[0];
  const sameRound = available.filter(question => question.ref.engine === first?.ref.engine && question.ref.versionId === first?.ref.versionId);
  const round = bulk ? available.filter(question => selected.includes(question.key)) : first?.ref.engine === 'original' ? [...sameRound.filter(question => question.origin !== 'ai').slice(0, 10), ...sameRound.filter(question => question.origin === 'ai').slice(0, 5)] : sameRound.slice(0, first?.ref.engine === 'pdf' ? 1 : 5);
  const materialId = location.materialId ?? group?.materialId;
  const blocked = data && (!Array.isArray(data.withheldMaterials) ? '考试状态暂不可用，请重新读取。' : materialId && data.withheldMaterials.includes(materialId) ? '这份资料有未交卷考试，交卷后再巩固错题。' : '');
  async function start(questions: StudyQuestion[]) {
    if (!questions.length || busy || blocked) return;
    setBusy(true); setActionError('');
    try {
      const current = await hubRequest<PracticeHubSummary>(`/api/practice-hub?courseId=${encodeURIComponent(courseId)}&section=mistakes`);
      if (!Array.isArray(current.withheldMaterials) || group?.materialId && current.withheldMaterials.includes(group.materialId)) throw Error('考试状态发生变化，请交卷后再巩固。');
      if (questions.some(question => !current.catalog.some(item => item.key === question.key && item.available && !item.needsReview))) throw Error('所选错题来源已更新，请刷新后重新选择。');
      const first = questions[0];
      if (questions.some(question => question.ref.engine !== first.ref.engine || question.ref.versionId !== first.ref.versionId)) throw Error('不同练习来源需要分别巩固，请在批量管理中选择同一来源的题目。');
      const back = { section: 'mistakes' as const, materialId: group?.materialId, ...(group?.materialId ? {} : { pageId: group?.id }), fromFile: true };
      if (first.ref.engine === 'original') {
        if (questions.filter(question => question.origin !== 'ai').length > 10 || questions.filter(question => question.origin === 'ai').length > 5) throw Error('每轮最多 10 道原题和 5 道 AI 自编题，请减少选择。');
        const result = await originalRequest({ action: 'original-load', courseId, context: 'knowledge', questionIds: questions.map(question => question.ref.questionId), mode: 'practice', newRound: true });
        await onOpen({ ...back, activity: 'practice', scope: result.scope });
      } else if (first.ref.engine === 'generated') {
        const result = await hubRequest<PracticeData>(`/api/practice?courseId=${encodeURIComponent(courseId)}&versionId=${encodeURIComponent(first.ref.versionId!)}`);
        if (questions.some(question => !result.questions.some(item => item.id === question.ref.questionId))) throw Error('题组版本已更新，请重新核对来源。');
        await hubRequest('/api/practice', { action: 'save', courseId, versionId: first.ref.versionId, scope: result.scope, revision: result.revision, session: { ...blankSession(), roundId: crypto.randomUUID(), ids: questions.map(question => question.ref.questionId), attempts: result.session?.attempts ?? [] } });
        await onOpen({ ...back, activity: 'generated', versionId: first.ref.versionId });
      } else {
        if (questions.length !== 1) throw Error('旧原卷记录请逐题巩固；每道题的原作答仍会保留。');
        await onOpen({ ...back, activity: 'practice', materialId: first.ref.materialId, question: first.ref.questionId, legacy: true });
      }
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : '错题巩固启动失败，请重试。'); } finally { setBusy(false); }
  }
  async function manage(changes: { favorite?: boolean; consolidated?: boolean }) {
    if (!study || busy || blocked) return;
    setBusy(true); setActionError('');
    try { await study.change(items.filter(question => selected.includes(question.key)).map(question => question.ref), changes); setSelected([]); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : '保存失败，请重试。'); } finally { setBusy(false); }
  }
  return <div className="hub-function-surface file-practice mistake-file-practice">
    <header className="file-practice-header"><div><h1>{group?.name ?? '资料错题'}</h1><p>{group?.questions.filter(question => question.mistake).length ?? 0} 题待巩固 · {group?.questions.filter(question => question.consolidated).length ?? 0} 题已巩固</p></div><div className="file-practice-actions"><Button disabled={!data || busy || !!blocked || study?.loading} aria-expanded={bulk} onClick={() => { setBulk(value => !value); setSelected([]); }}><ListChecks size={16}/>批量管理</Button><Button variant="primary" disabled={!round.length || busy || !!blocked || study?.loading} onClick={() => void start(round)}>{busy ? <LoaderCircle size={16} className="spin"/> : <Play size={16}/>}错题巩固（{round.length} 题）<ArrowRight size={16}/></Button></div></header>
    {(error || actionError) && <p role="alert" className="file-practice-error">{error || actionError}<Button onClick={refresh} size="sm">重新读取</Button></p>}
    {!data && !error && <p role="status">正在读取这份资料的错题…</p>}
    {blocked && <p role="status" className="file-practice-blocked">{blocked}</p>}
    {data && <>
      {bulk && <div className="file-practice-bulk"><span>已选 {selected.length} 题</span><Button size="sm" disabled={busy || !!blocked} onClick={() => setSelected(available.map(question => question.key))}>全选当前错题</Button><Button size="sm" disabled={busy || !selected.length} onClick={() => setSelected([])}>清空选择</Button><Button size="sm" disabled={busy || !selected.length || !!blocked} onClick={() => void manage({ favorite: true })}><Bookmark size={14}/>批量收藏</Button><Button size="sm" disabled={busy || !selected.length || !!blocked} onClick={() => void manage({ consolidated: true })}><Check size={14}/>标记已巩固</Button></div>}
      <div className="hub-list-heading"><span>{items.length} 道错题</span><label>巩固状态<select aria-label="资料错题巩固状态" value={status} disabled={busy} onChange={event => { setStatus(event.target.value); setSelected([]); }}><option value="pending">待巩固</option><option value="consolidated">已巩固</option><option value="all">全部</option></select></label></div>
      {items.length ? <div className="hub-question-list">{items.map(question => <SpotlightCard theme="light" key={question.key} spotlightColor="var(--hub-action)" intensity={0.06} borderGlow={0.12} proximity={0} ambient={false} flare={false}><article><div className="hub-question-meta"><span>{question.origin === 'ai' ? 'AI 自编' : '原题'} · {question.topic}</span><small>{question.consolidated ? '已巩固' : '待巩固'}</small></div><h3>{bulk && <input type="checkbox" aria-label={`选择错题 ${question.ref.questionId}`} disabled={busy || !question.available || !!blocked || question.needsReview} checked={selected.includes(question.key)} onChange={event => setSelected(ids => event.target.checked ? [...ids, question.key] : ids.filter(id => id !== question.key))}/>} {question.number && `第 ${question.number} 题 · `}{question.prompt}</h3><p className="hub-question-source"><FileText size={14}/>{question.sourceName}</p><QuestionStudyControls question={question.ref} editable primaryAction={<Button size="sm" variant="primary" disabled={busy || !question.available || !!blocked || question.needsReview || study?.loading} onClick={() => void start([question])}>巩固这道题</Button>}/>{!question.available && <p className="hub-small-copy">来源已更新，原作答与复盘笔记保留。</p>}</article></SpotlightCard>)}</div> : <HubEmpty icon="mistakes" title={group ? '这份资料暂时没有待巩固题' : '这份资料的错题已变化'} text="可切换巩固状态回看已巩固题目，或返回错题主页选择资料。" action="返回错题复盘" onClick={() => void onOpen({ section: 'mistakes', activity: null })}/>}
    </>}
  </div>;
}
