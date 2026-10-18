'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, CheckCircle2, FileText, History, ListChecks, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from './ui/button';
import SpotlightCard from './react-bits/SpotlightCard';
import { beijingDay, type PracticeLocation } from '@/lib/practice-hub';
import type { LearningAnalysisData, LearningJudgment } from '@/lib/learning-analysis';

type Props = {
  courseId: string;
  onOpenPractice: (location: PracticeLocation) => void;
  onLibrary: () => void;
  onOutline: () => void;
  onVersions: () => void;
};
const dateLabel = (at: string) => new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const originNames = { original: '原题', ai: 'AI 生成', pdf: '原卷自评', unknown: '历史题目' };
type AnalysisPage = 'overview' | 'topics' | 'records';

export function LearningAnalytics({ courseId, onOpenPractice, onLibrary, onOutline, onVersions }: Props) {
  const [data, setData] = useState<LearningAnalysisData | null>(null);
  const [period, setPeriod] = useState<7 | 30>(7);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [page, setPage] = useState<AnalysisPage>('overview');
  const heading = useRef<HTMLHeadingElement>(null);
  const overviewScroll = useRef(0);
  const previousDetail = useRef<AnalysisPage>('topics');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const readLocation = () => {
      const params = new URLSearchParams(window.location.search), detail = params.get('analysis');
      setPage(detail === 'topics' || detail === 'records' ? detail : 'overview');
      setPeriod(params.get('analysisPeriod') === '30' ? 30 : 7);
    };
    readLocation();
    window.addEventListener('popstate', readLocation);
    return () => window.removeEventListener('popstate', readLocation);
  }, [courseId]);

  useEffect(() => {
    setSelectedTopic(null);
    const main = heading.current?.closest('main');
    if (main) main.scrollTop = page === 'overview' ? overviewScroll.current : 0;
    const opener = main?.querySelector<HTMLButtonElement>(previousDetail.current === 'topics' ? '[aria-label="查看更多知识点"]' : '[aria-label="查看更多练习记录"]');
    (page === 'overview' ? opener ?? heading.current : heading.current)?.focus({ preventScroll: true });
  }, [page]);

  function navigatePage(next: AnalysisPage, nextPeriod = period) {
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('analysis'); else url.searchParams.set('analysis', next);
    if (nextPeriod === 30) url.searchParams.set('analysisPeriod', '30'); else url.searchParams.delete('analysisPeriod');
    if (next !== page) {
      if (page === 'overview') overviewScroll.current = heading.current?.closest('main')?.scrollTop ?? 0;
      if (next !== 'overview') previousDetail.current = next;
      window.history.pushState(null, '', url);
    } else window.history.replaceState(null, '', url);
    setPage(next); setPeriod(nextPeriod);
  }

  useEffect(() => {
    const controller = new AbortController();
    setData(null); setLoading(true); setError('');
    setSelectedDay(null); setSelectedTopic(null);
    void fetch('/api/learning-analysis?' + new URLSearchParams({ courseId, period: String(period) }), { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? '读取学习记录失败。');
        if (!controller.signal.aborted) setData(result as LearningAnalysisData);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取学习记录失败。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [courseId, period, refresh]);

  useEffect(() => {
    const refreshOnFocus = () => setRefresh(value => value + 1);
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, []);

  const current = !loading && !error && data?.courseId === courseId && data.period === period ? data : null;
  const days = current?.days ?? [];
  const chart = (period === 7 ? days.map(day => ({ ...day, keys: [day.key] })) : Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => {
    const group = days.slice(index * 7, index * 7 + 7);
    return { key: group[0].key, label: group[0].label + '–' + group[group.length - 1].label, total: group.reduce((sum, day) => sum + day.total, 0), correct: group.reduce((sum, day) => sum + day.correct, 0), keys: group.map(day => day.key) };
  }));
  const selected = chart.find(day => day.key === selectedDay) ?? [...chart].reverse().find(day => day.total) ?? chart.at(-1);
  const dayRecords = current?.judgments.filter(item => selected?.keys.includes(beijingDay(new Date(item.at)))) ?? [];
  const maxDaily = Math.max(1, ...chart.map(day => day.total));
  const topics = current?.topics ?? [];
  const topicRecords = current?.judgments.filter(item => item.topics.some(topic => topic.trim() === selectedTopic)) ?? [];
  const metrics = [
    { id: 'total', title: '已保存判定', value: current?.metrics.total, unit: '条', icon: ListChecks, note: '来自各分区保存的作答与自评' },
    { id: 'accuracy', title: '答对 / 自评掌握率', value: current?.metrics.accuracy, unit: '%', icon: CheckCircle2, note: current?.metrics.total ? '基于 ' + current.metrics.total + ' 条判定' : '有判定记录后显示' },
    { id: 'active', title: '活跃天数', value: current?.metrics.activeDays, unit: '天', icon: CalendarDays, note: '所选范围内有判定的日期' },
    { id: 'review', title: '待巩固题目', value: current?.metrics.reviewCount, unit: '题', icon: RotateCcw, note: '沿用错题与已巩固状态' },
  ];
  const recordRows = (items: LearningJudgment[]) => <ul className="analytics-source-records">{items.map(item => <li key={item.id}>
    <span className={'analytics-result-dot ' + (item.correct ? 'correct' : '')} aria-label={item.correct ? '答对 / 自评掌握' : '未掌握'} />
    <div><strong>{item.title}</strong><small>{item.sourceName} · {originNames[item.origin]} · {dateLabel(item.at)}{item.timeSource === 'saved' ? '（记录时间）' : ''}</small></div>
    <button type="button" onClick={() => onOpenPractice(item.location)} aria-label={'查看 ' + item.sourceName + ' 的练习记录'}>记录<ArrowRight size={13}/></button>
  </li>)}</ul>;

  const topicsCard = <section className="analytics-card analytics-topics" aria-label="知识点表现">
    <div className="analytics-card-heading"><div><h2>{page === 'topics' ? '全部知识点' : '知识点表现'}</h2><p>只使用题目已有的知识点标签</p></div><span>{current ? topics.length + ' 个' : '—'}</span></div>
    {topics.length > 0 ? <><div className="analytics-topic-list">{(page === 'topics' ? topics : topics.slice(0, 5)).map(item => <Fragment key={item.name}><button type="button" className={'analytics-topic' + (selectedTopic === item.name ? ' selected' : '')} aria-pressed={selectedTopic === item.name} onClick={() => setSelectedTopic(selectedTopic === item.name ? null : item.name)}>
      <span className="analytics-topic-name"><strong>{item.name}</strong><small>{item.total} 条判定</small></span><span className="analytics-topic-track"><span style={{ width: item.correct / item.total * 100 + '%' }}/></span><span className="analytics-topic-rate">{Math.round(item.correct / item.total * 100)}%</span><span className={'analytics-topic-status' + (item.reviewCount ? ' needs-review' : '')}>{item.reviewCount ? item.reviewCount + ' 题待巩固' : '暂无待巩固'}</span>
    </button>{selectedTopic === item.name && <div className="analytics-topic-detail"><h3>{selectedTopic} · 来源记录</h3>{recordRows(topicRecords)}</div>}</Fragment>)}</div>
      {page === 'overview' && <button type="button" className="analytics-text-button" aria-label="查看更多知识点" onClick={() => navigatePage('topics')}>查看更多<ArrowRight size={13}/></button>}</> : <div className="analytics-empty"><BookOpen size={24}/><p>{loading ? '正在读取知识点…' : error ? '知识点数据暂不可用' : '暂无带知识点标签的判定记录。原卷自评仍计入总体统计。'}</p></div>}
  </section>;
  const recentCard = <section className="analytics-card analytics-recent" aria-label="最近练习">
    <div className="analytics-card-heading"><div><h2>{page === 'records' ? '全部练习记录' : '最近练习'}</h2><p>回到真实保存的会话与轮次</p></div>{page === 'records' ? <span>{current ? current.records.length + ' 条' : '—'}</span> : <History size={17}/>}</div>
    {current?.records.length ? <><div className="analytics-record-list">{(page === 'records' ? current.records : current.records.slice(0, 4)).map(record => <div className="analytics-record" key={record.id}>
      <span className="analytics-record-icon"><FileText size={16}/></span><div><strong>{record.title}</strong><small>{dateLabel(record.at)} · {record.location.section === 'papers' ? '套卷' : '知识点'} · {record.total} 条判定</small><span>{record.finished ? '已结束' : '进行中'}{record.total ? ' · ' + record.correct + ' 条答对 / 掌握' : ' · 暂无判定'}</span></div><button type="button" onClick={() => onOpenPractice(record.location)} aria-label={'查看 ' + record.title + ' 的练习记录'}><ArrowRight size={16}/></button>
    </div>)}</div>{page === 'overview' && <button type="button" className="analytics-text-button" aria-label="查看更多练习记录" onClick={() => navigatePage('records')}>查看更多<ArrowRight size={13}/></button>}</> : <div className="analytics-empty"><History size={24}/><p>{loading ? '正在读取练习记录…' : error ? '练习记录暂不可用' : '暂无练习记录'}</p></div>}
  </section>;

  return <div className="learning-analytics" aria-busy={loading}>
    {page !== 'overview' && <nav className="analytics-subpage-nav" aria-label="学习分析返回路径"><Button variant="ghost" onClick={() => navigatePage('overview')}><ArrowLeft size={16}/>返回学习分析</Button></nav>}
    <header className="analytics-heading">
      <h1 ref={heading} tabIndex={-1}>{page === 'topics' ? '知识点表现' : page === 'records' ? '最近练习' : '学习分析'}</h1>
      <div className="analytics-controls">
        <div className="analytics-period" role="group" aria-label="统计时间范围">{([7, 30] as const).map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => navigatePage(page, value)}>近 {value} 天</button>)}</div>
        <Button variant="secondary" onClick={() => setRefresh(value => value + 1)} disabled={loading} aria-label="刷新学习分析数据"><RefreshCw size={15} className={loading ? 'spin' : ''}/><span>刷新</span></Button>
      </div>
    </header>

    {error && <div className="analytics-alert" role="alert"><span>{error}</span><Button size="sm" onClick={() => setRefresh(value => value + 1)}>重试</Button></div>}
    {current?.withheld && <p className="analytics-protection-note">有尚未交卷的考试，相关来源的判定与历史分析暂不展示。</p>}
    {page === 'overview' ? <>
    <section className="analytics-metrics" aria-label="学习概况" aria-live="polite">
      {metrics.map(({ id, title, value, unit, icon: Icon, note }) => <div key={id} className={'analytics-metric' + (loading ? ' is-loading' : '')} data-metric={id}>
        <span><Icon size={16}/>{title}</span><strong>{value == null ? '—' : value}{value != null && <small>{unit}</small>}</strong><p>{note}</p>
      </div>)}
    </section>

    <div className="analytics-main-grid">
      <section className="analytics-card analytics-trend" aria-label="练习趋势">
        <div className="analytics-card-heading"><div><h2>练习趋势</h2><p>{period === 7 ? '每天保存的判定记录' : '近 30 天，每 7 天汇总'}</p></div><div className="analytics-legend"><span><i className="correct"/>答对 / 掌握</span><span><i/>未掌握</span></div></div>
        <div className="analytics-chart" role="group" aria-label={period === 7 ? '每日判定图表' : '近30天判定图表'}>
          {current ? chart.map(item => <button key={item.key} type="button" className={'analytics-bar-button' + (selected?.key === item.key ? ' selected' : '')} aria-label={item.key + '：' + item.total + ' 条判定，' + item.correct + ' 条答对或掌握'} aria-pressed={selected?.key === item.key} onClick={() => setSelectedDay(item.key)}>
            <span className="analytics-bar-track"><span className="analytics-bar" style={{ height: item.total / maxDaily * 100 + '%' }}>{item.total > 0 && <><span className="analytics-bar-wrong" style={{ flex: item.total - item.correct }}/><span className="analytics-bar-correct" style={{ flex: item.correct }}/></>}</span></span><small>{item.label}</small>
          </button>) : <div className="analytics-chart-placeholder" aria-hidden="true"/>}
          {(!current || !current.metrics.total) && <span className="analytics-chart-empty-note" role="status">{loading ? '正在读取练习记录…' : error ? '数据暂不可用' : '暂无判定记录'}</span>}
        </div>
        <div className="analytics-day-detail"><div><span>所选{period === 7 ? '日期' : '时段'}</span><strong>{selected?.label ?? '—'}</strong></div><div><strong>{current ? selected?.total ?? 0 : '—'}</strong><span>条判定</span></div><div><strong>{current ? selected?.correct ?? 0 : '—'}</strong><span>答对 / 掌握</span></div></div>
        {dayRecords.length > 0 && <details className="analytics-day-records" key={selected?.key}><summary>查看这段时间的真实记录<span>{dayRecords.length} 条</span></summary>{recordRows(dayRecords)}</details>}
      </section>

      <section className="analytics-card analytics-focus" aria-label="优先复习">
        <div className="analytics-card-heading"><div><h2>优先复习</h2><p>从近期判定与错题状态出发</p></div><RotateCcw size={17}/></div>
        {loading ? <div className="analytics-empty">正在读取复习状态…</div> : current?.reviewItems.length ? <div className="analytics-review-list">{current.reviewItems.map(item => <SpotlightCard key={item.questionKey} className="analytics-review-item" intensity={0.12} borderGlow={0.15} proximity={0} ambient={false} flare={false}>
          <span className="analytics-review-label">{item.topics.join(' · ') || (item.origin === 'pdf' ? '原卷自评' : '未标注知识点')}</span><h3>{item.title}</h3><div><small>{item.sourceName} · {originNames[item.origin]}</small><button type="button" onClick={() => onOpenPractice(item.location)} aria-label={'查看 ' + item.title + ' 的来源记录'}><ArrowRight size={15}/></button></div>
        </SpotlightCard>)}</div> : <div className="analytics-empty"><CheckCircle2 size={24}/><strong>{error ? '复习状态暂不可用' : current?.metrics.reviewCount ? '部分来源需要重新核对' : current?.metrics.total ? '近期暂无待巩固题目' : '从第一组练习开始'}</strong><p>{error ? '重试后可继续查看。' : current?.metrics.reviewCount ? '这些题目仍保留在历史中，来源更新后再练习。' : current?.metrics.total ? '继续保持节奏，也可以回看已保存的记录。' : '保存作答或自评后，复习重点会在这里出现。'}</p></div>}
        <Button variant="primary" onClick={() => onOpenPractice({ section: current?.metrics.total ? 'mistakes' : 'overview', activity: current?.metrics.total ? 'mistakes' : null })}>{current?.metrics.total ? '去错题复盘' : '打开练习中心'}<ArrowRight size={15}/></Button>
      </section>
    </div>

    <div className="analytics-bottom-grid">
      {topicsCard}{recentCard}
    </div>

    <footer className="analytics-footer">
      <div className="analytics-resources"><button type="button" onClick={onLibrary}><FileText size={14}/>课程资料 <b>{current?.materialCount ?? '—'}</b> 份</button><button type="button" onClick={onVersions}><History size={14}/>复习版本 <b>{current?.versionCount ?? '—'}</b> 个</button><button type="button" onClick={onOutline}><BookOpen size={14}/>打开活页笔记<ArrowRight size={13}/></button></div>
    </footer>
    </> : <div className="analytics-subpage">{page === 'topics' ? topicsCard : recentCard}</div>}
  </div>;
}
