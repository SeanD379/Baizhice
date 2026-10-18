'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Bookmark, BookOpen, CalendarDays, Check, ChevronRight, CircleAlert, FileInput, FileText, History, Layers3, ListChecks, LoaderCircle, NotebookPen, PencilLine, Play, Plus, RotateCw, Sparkles } from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Button } from './ui/button';
import { usePracticeStudy } from './practice-study-context';
import { collectedPracticeFiles, mistakeFiles, studyStatus, type HubRecord, type PracticeArea, type PracticeActivity, type PracticeHubSummary, type PracticeLocation, type DailyTask, type StudyQuestion } from '@/lib/practice-hub';

gsap.registerPlugin(useGSAP);
export const practiceTitles = { knowledge: '知识点巩固', mistakes: '错题复盘', papers: '套卷练习' };
export async function hubRequest<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const result = await response.json().catch(() => ({ error: '服务暂时不可用，请稍后重试。' }));
  if (!response.ok) throw Error(result.error || '读取失败，请重试。'); return result;
}
type HubCache = { courseId: string; get: (section: PracticeArea) => PracticeHubSummary | undefined; read: (section: PracticeArea, force?: boolean) => Promise<PracticeHubSummary> };
const HubSummaries = createContext<HubCache | null>(null);
export function PracticeHubProvider({ courseId, preload, children }: { courseId: string; preload: boolean; children: ReactNode }) {
  const snapshots = useRef(new Map<string, PracticeHubSummary>()), pending = useRef(new Map<string, Promise<PracticeHubSummary>>());
  const cache = useMemo<HubCache>(() => ({
    courseId,
    get: section => snapshots.current.get(`${courseId}:${section}`),
    read: (section, force = false) => {
      const key = `${courseId}:${section}`, existing = pending.current.get(key);
      if (existing && !force) return existing;
      const request = hubRequest<PracticeHubSummary>(`/api/practice-hub?courseId=${encodeURIComponent(courseId)}&section=${section}`).then(data => { if (pending.current.get(key) === request) snapshots.current.set(key, data); return data; }).finally(() => { if (pending.current.get(key) === request) pending.current.delete(key); });
      pending.current.set(key, request); return request;
    },
  }), [courseId]);
  useEffect(() => { if (preload) for (const section of ['knowledge', 'mistakes', 'papers'] as const) void cache.read(section).catch(() => {}); }, [cache, preload]);
  return <HubSummaries.Provider value={cache}>{children}</HubSummaries.Provider>;
}
export function useHubSummary(courseId: string, section: PracticeArea, reuseHomepage = false) {
  const sharedCache = useContext(HubSummaries), cache = sharedCache?.courseId === courseId ? sharedCache : null, key = `${courseId}:${section}`;
  const [snapshot, setSnapshot] = useState<{ key: string; data: PracticeHubSummary | null }>(() => ({ key, data: reuseHomepage ? cache?.get(section) ?? null : null }));
  const [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true; setSnapshot(previous => ({ key, data: reuseHomepage ? cache?.get(section) ?? (previous.key === key ? previous.data : null) : null })); setError('');
    const request = reuseHomepage && cache ? cache.read(section, !!cache.get(section)) : hubRequest<PracticeHubSummary>(`/api/practice-hub?courseId=${encodeURIComponent(courseId)}&section=${section}`);
    void request.then(data => { if (alive) setSnapshot({ key, data }); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [courseId, section, revision, reuseHomepage, cache, key]);
  const data = snapshot.key === key ? snapshot.data : reuseHomepage ? cache?.get(section) ?? null : null;
  return { data, error, refresh: () => setRevision(r => r + 1) };
}
export function useStudyCatalog(data: PracticeHubSummary | null): StudyQuestion[] {
  const study = usePracticeStudy();
  return (data?.catalog ?? []).map(q => { const state = study?.states.find(s => s.key === q.key); return state ? { ...q, ...studyStatus(state, q.lastAttempt, new Date().toISOString()) } : q; });
}
export function PracticeHub({ courseId, section, onOpen }: { courseId: string; section: PracticeArea; onOpen: (location: PracticeLocation) => void }) {
  const { data, error, refresh } = useHubSummary(courseId, section, true), catalog = useStudyCatalog(data);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  const surface = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (!data || !surface.current) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => { gsap.from('[data-hub-enter]', { y: 9, opacity: 0.5, duration: 0.24, stagger: 0.035, ease: 'power2.out' }); });
    return () => media.revert();
  }, { scope: surface, dependencies: [section, !!data], revertOnUpdate: true });
  const open = (activity: PracticeActivity, extra: Partial<PracticeLocation> = {}) => onOpen({ section, activity, ...extra });
  if (!data) return <div ref={surface} className={`practice-hub hub-${section}`}><header className="hub-header"><h1>{practiceTitles[section]}</h1><Button className="hub-import-button" onClick={() => open('sources')}><Plus size={16}/>{section === 'papers' ? '导入 / 选择套卷' : section === 'mistakes' ? '导入错题资料' : '导入 / 选择资料'}</Button></header><div className="hub-layout"><section className="hub-main-surface" aria-busy={!error}><div className="hub-section-heading"><h2>{section === 'knowledge' ? '资料与知识点库' : section === 'mistakes' ? '我的错题集' : '试卷书架'}</h2></div><p className="hub-small-copy" role={error ? 'alert' : 'status'}>{error || '正在同步资料与练习统计…'}</p>{error && <Button onClick={refresh}>重试读取</Button>}</section><aside className="hub-side"><section className="hub-resume"><div className="hub-aside-heading"><h3>练习安排</h3></div><p className="hub-small-copy">正在同步最新安排…</p></section></aside></div></div>;
  const inArea = (q: StudyQuestion) => section === 'mistakes' || q.section === (section === 'papers' ? 'papers' : 'knowledge');
  const wrong = catalog.filter(q => q.mistake && inArea(q)), favorites = catalog.filter(q => q.favorite && inArea(q));
  const due = wrong.filter(q => q.dueAt && q.dueAt <= new Date().toISOString());
  const records = data.records.filter(r => section === 'mistakes' || r.section === section);
  const unfinished = records.find(r => !r.finished && r.total > 0);
  const files = collectedPracticeFiles(data);
  const papers = data.materials.filter(m => m.paper || m.chapter === '历年套卷');
  const groups = mistakeFiles(catalog, data.materials);
  const mistakeRow = (group: typeof groups[number]) => <button className="hub-file-row" type="button" key={group.id} onClick={() => open('file', group.materialId ? { materialId: group.materialId } : { pageId: group.id })}><FileText size={20}/><span><strong>{group.name}</strong><small>{group.questions.filter(question => question.mistake).length} 题待巩固 · {group.questions.filter(question => question.consolidated).length} 题已巩固</small></span><ChevronRight size={17}/></button>;
  const reviewedCount = catalog.filter(q => q.consolidated && inArea(q)).length;
  const recommendation = papers.find(p => p.id === data.recommendation);
  async function daily() {
    setBusy(true); setActionError('');
    try { const task = await hubRequest<DailyTask>('/api/practice-daily', { action: 'create', courseId, section }); open('daily', { task: task.id }); }
    catch (e) { setActionError(e instanceof Error ? e.message : '今日任务创建失败，请重试。'); } finally { setBusy(false); }
  }
  function resume(record: HubRecord) { open(record.taskId ? 'daily' : record.engine === 'generated' ? 'generated' : 'practice', { task: record.taskId, scope: record.engine !== 'pdf' ? record.id : undefined, materialId: record.materialId, legacy: record.engine === 'pdf', versionId: record.versionId, setId: record.setId }); }
  const shortcuts = section === 'knowledge' ? [
    ['practice', ListChecks, '专项练习', '选择知识点与题型'], ['ai', Sparkles, 'AI 出题', data.configured ? '从已核对内容出题' : '先准备内容与出处'], ['favorites', Bookmark, '收藏题目', `${favorites.length} 题`], ['mistakes', RotateCw, '本板块错题', `${wrong.length} 题待巩固`], ['history', History, '练习记录', `${records.length} 次记录`],
  ] as const : section === 'mistakes' ? [
    ['organize', Layers3, '错题整理', '归类、标签与巩固'], ['daily', CalendarDays, '到期重练', `${due.length} 题到期`], ['variants', Sparkles, 'AI 专项变式', '围绕原题再练一次'], ['favorites', Bookmark, '收藏题目', `${favorites.length} 题`], ['notes', NotebookPen, '复盘笔记', '记录错因与关键步骤'], ['history', History, '重练记录', '回看每次巩固'],
  ] as const : [
    ['variants', Sparkles, '同类题加练', '选一道原题，生成同类题'], ['favorites', Bookmark, '收藏题目', `${favorites.length} 题`], ['mistakes', RotateCw, '套卷错题', `${wrong.length} 题待巩固`], ['history', History, '套卷记录', '回看作答与历史'],
  ] as const;
  return <div ref={surface} className={`practice-hub hub-${section}`}>
    <header className="hub-header" data-hub-enter>
      <div><h1>{practiceTitles[section]}</h1></div>
      <div className="hub-header-actions"><Button className="hub-import-button" onClick={() => open('sources')}><Plus size={16}/>{section === 'mistakes' ? '导入错题资料' : section === 'papers' ? '导入 / 选择套卷' : '导入 / 选择资料'}</Button></div>
    </header>
    {error && <p className="hub-small-copy" role="alert">统计暂未更新，保留上次显示。{error}<Button variant="ghost" size="sm" onClick={refresh}>重新同步</Button></p>}
    <div className="hub-layout">
      <section className="hub-main-surface" data-hub-enter>
        <div className="hub-section-heading"><div><h2>{section === 'knowledge' ? '资料与知识点库' : section === 'mistakes' ? '我的错题集' : '试卷书架'}</h2><p>{section === 'knowledge' ? `${files.length} 份资料 · ${data.knowledge.length} 个知识点` : section === 'mistakes' ? `${wrong.length} 题待巩固 · ${reviewedCount} 题已标记巩固` : `${papers.length} 份原卷 · 原始出处与作答记录一起保留`}</p></div><Button variant="ghost" size="sm" onClick={() => open('organize')}>{section === 'knowledge' ? '编辑活页笔记' : section === 'mistakes' ? '整理错题' : '整理试卷'}<ArrowRight size={14}/></Button></div>
        {section === 'knowledge' && <>
          <div className="hub-source-strip"><FileInput size={19}/><div><strong>从已有资料开始</strong><span>选择、核对，再加入你的知识点库</span></div><button type="button" aria-label="选择资料并核对" onClick={() => open('sources')}><ArrowRight size={17}/></button></div>
          {files.length ? <div className="hub-file-list">{files.map(file => <button className="hub-file-row" type="button" key={file.material.id} onClick={() => open('file', { materialId: file.material.id })}><FileText size={20}/><span><strong>{file.material.name}</strong><small>{file.knowledge.length} 个知识点 · {file.questions.length} 道题目{file.questions.some(question => question.needsAnswer) && ` · ${file.questions.filter(question => question.needsAnswer).length} 题待补答案与解析`}</small></span><ChevronRight size={17}/></button>)}</div> : <HubEmpty icon="knowledge" title="还没有已收录的资料" text="在我的资料中整理内容，审核并收录后，就会按文件名显示在这里。" action="准备学习资料" onClick={() => open('sources')}/>}
        </>}
        {section === 'mistakes' && <>
          {groups.length ? <div className="hub-file-list">{groups.slice(0, 3).map(mistakeRow)}{groups.length > 3 && <details className="hub-more-files"><summary>更多资料 · {groups.length - 3} 份<ChevronRight size={16}/></summary>{groups.slice(3).map(mistakeRow)}</details>}</div> : <HubEmpty icon="mistakes" title="让错题变成下一次的进步" text="练习中答错的题目会自动汇入这里。也可以导入已有错题资料，核对题目后加入错题集。" action="导入已有错题" onClick={() => open('sources')}/>}
          <div className="hub-main-footnote"><Check size={15}/><p>自动汇总原题、知识点练习与原卷题号，保留每次作答。</p></div>
        </>}
        {section === 'papers' && <>
          <div className="hub-source-strip"><FileInput size={19}/><div><strong>从已有套卷开始</strong><span>选择原卷，保留题号与作答顺序</span></div><button type="button" aria-label="添加或选择一份套卷" onClick={() => open('sources')}><ArrowRight size={17}/></button></div>
          {papers.length ? <div className="hub-file-list">{papers.map(paper => <button className="hub-file-row" type="button" key={paper.id} onClick={() => open('practice', { materialId: paper.id })}><FileText size={20}/><span><strong>{paper.name}</strong><small>{paper.year || '我的原卷'} · {paper.questions ? `${paper.questions} 道原题` : '待读取原题'} · {paper.stale ? '来源已更新' : paper.finished ? '近期已完成' : paper.answered ? `继续上次 · 已答 ${paper.answered} 题` : '尚未练习'}</small></span><ChevronRight size={17}/></button>)}</div> : <HubEmpty icon="papers" title="把第一份原卷放上书架" text="导入一份试卷，保留原始题号、共同材料与顺序。原卷与答案文件可以分别整理。" action="导入原卷" onClick={() => open('sources')}/>}
        </>}
      </section>
      <aside className="hub-side" aria-label="练习安排" data-hub-enter>
        <section className="hub-daily"><div className="hub-daily-top"><span><CalendarDays size={16}/>{section === 'papers' ? '今日推荐' : '每日练习'}</span><time dateTime={data.day}>{data.day.slice(5).replace('-', ' / ')}</time></div><div className={`hub-daily-art practice-cover-${section}`} aria-hidden="true">{section === 'knowledge' ? <span className="practice-knowledge-art"><span className="practice-knowledge-sheet practice-knowledge-sheet-back"/><span className="practice-knowledge-sheet practice-knowledge-sheet-front"><i/><i/><i/></span><span className="practice-knowledge-check"><Check size={20}/></span></span> : section === 'mistakes' ? <span className="practice-mistakes-art"><span className="practice-mistakes-note"><i/><i/><i/></span><span className="practice-mistakes-repeat"><RotateCw size={30}/></span></span> : <span className="practice-papers-art"><span className="practice-papers-sheet"><i/><i/><i/><i/></span><span className="practice-papers-pencil"><PencilLine size={24}/></span></span>}</div><h2>{section === 'papers' ? recommendation?.name.replace(/\.pdf$/i, '') || '准备你的下一份原卷' : section === 'mistakes' ? '花一点时间，再巩固一次' : '今天，从一小组开始'}</h2><p>{data.daily ? `${section === 'papers' ? 1 : data.daily.groups.reduce((sum, g) => sum + g.refs.length, 0)} ${section === 'papers' ? '份原卷' : '题'}已安排，刷新后仍继续同一任务。` : section === 'papers' ? '每天一份，优先接着未完成的原卷。' : `最多 5 题 · 到期复习优先，补充未练题。${data.dailyCount ? `今天可安排 ${data.dailyCount} 题。` : '暂无到期题或未练题。'}`}</p><Button className="hub-primary-action" disabled={busy || !data.daily && !data.dailyCount} onClick={() => void daily()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Play size={15} fill="currentColor"/>}{data.daily ? data.daily.groups.every(g => g.finished) ? '回看今日任务' : '继续今日任务' : section === 'papers' ? '打开今日原卷' : '安排今日练习'}<ArrowRight size={15}/></Button>{actionError && <p role="alert" className="hub-action-error">{actionError}</p>}</section>
        <section className="hub-resume"><div className="hub-aside-heading"><h3>继续上次</h3><History size={16}/></div>{unfinished ? <><p className="hub-resume-title">{unfinished.title}</p><p className="hub-small-copy">已答 {unfinished.answered} / {unfinished.total} 题 · 答案已保留</p><button className="hub-text-action" type="button" onClick={() => resume(unfinished)}>接着练习<ArrowRight size={15}/></button></> : <p className="hub-small-copy">开始练习后，未完成的题组会留在这里。</p>}</section>
        {section === 'knowledge' && data.knowledge.some(k => k.needsReview) && <section className="hub-reminder"><CircleAlert size={18}/><div><h3>{data.knowledge.filter(k => k.needsReview).length} 个知识点待核对</h3><p>核对正文与出处，再用于 AI 出题。</p><button type="button" onClick={() => open('organize', { pageId: data.knowledge.find(k => k.needsReview)?.id })}>前往核对<ChevronRight size={14}/></button></div></section>}
      </aside>
    </div>
    <nav className="hub-tools" aria-label={`${practiceTitles[section]}功能`} data-hub-enter>{shortcuts.map(([activity, Icon, title, hint]) => <button type="button" key={activity} onClick={() => activity === 'daily' ? void daily() : open(activity)}><span className="hub-tool-icon"><Icon size={21}/></span><strong>{title}</strong><small>{hint}</small><ArrowRight size={15}/></button>)}</nav>
  </div>;
}
export function HubEmpty({ icon, title, text, action, onClick }: { icon: PracticeArea; title: string; text: string; action: string; onClick: () => void }) {
  const Icon = icon === 'knowledge' ? BookOpen : icon === 'mistakes' ? RotateCw : FileText;
  return <div className="hub-empty"><span><Icon size={30}/></span><h3>{title}</h3><p>{text}</p><Button onClick={onClick}>{action}<ArrowRight size={15}/></Button></div>;
}
