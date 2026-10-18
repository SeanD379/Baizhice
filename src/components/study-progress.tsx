'use client';
import { useEffect, useState } from 'react';
import type { PracticeData } from '@/lib/practice-store';
import { studyProgress } from '@/lib/study-progress';
import { Button } from './ui/button';

export function StudyProgress({ courseId, versionId, onPractice }: { courseId: string; versionId: string; onPractice: () => void }) {
  const [data, setData] = useState<PracticeData | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    void fetch(`/api/practice?courseId=${encodeURIComponent(courseId)}&versionId=${encodeURIComponent(versionId)}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '读取练习进度失败。');
      if (!controller.signal.aborted) setData(result);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '读取练习进度失败。'); });
    return () => controller.abort();
  }, [courseId, versionId, retry]);
  const progress = data ? studyProgress(data.session, data.questions.map(q => q.id), Date.now()) : null;
  return <section className="home-card study-progress-card" aria-label="最近学习进度">
    <h2>最近学习进度</h2>
    {error ? <><p role="alert">{error}</p><Button onClick={() => setRetry(n => n + 1)}>重试读取</Button></> : !data || !progress ? <p role="status">正在读取本机练习记录…</p> : <>
      <p>当前材料版本 · 已作答 {progress.attempted} / {data.questions.length} 题 · 到期复习 {progress.due.length} 题</p>
      {progress.continuing && <p>上次停在第 {data.session!.index + 1} / {data.session!.ids.length} 题，进入后恢复已保存的答案。</p>}
      {progress.recent.length ? <ul>{progress.recent.slice(0, 3).map(a => <li key={a.id}>{data.questions.find(q => q.id === a.id)?.topic} · {a.correct ? '答对 / 自评覆盖要点' : '需要巩固'} · <time dateTime={a.at}>{new Date(a.at).toLocaleString('zh-CN')}</time></li>)}</ul> : <p>尚无已完成的作答记录，草稿不计入作答数量。</p>}
      <Button onClick={onPractice}>{progress.continuing ? '继续上次练习' : progress.due.length ? '查看到期复习' : '进入复习练习'}</Button>
      <p className="small muted">按最近一次作答提醒：需巩固后 1 天，答对或自评覆盖要点后 3 天。不代表掌握程度；仅统计当前题组保留的记录。</p>
    </>}
  </section>;
}
