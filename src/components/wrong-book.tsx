'use client';

import { useEffect, useState } from 'react';
import { BookOpen, FileText, RotateCw } from 'lucide-react';
import { Button } from './ui/button';
import { Markdown } from './markdown';
import { CaptureButton } from './notebook-context';
import { wrongQuestionNumbers, type ExamRecord } from '@/lib/exam-record';
import { knowledgeMistakes } from '@/lib/wrong-book';
import { sourceLocation } from '@/lib/document-labels';
import type { PracticeHistoryData } from '@/lib/practice-history';
import type { Material } from '@/lib/types';
import type { OriginalQuestion, OriginalSessionState } from '@/lib/question-bank-types';

type OriginalMistake = { question: OriginalQuestion; answer: string; at: string; context: string };
type OriginalHistory = { entries: { id: string; at: string; context: string; questions: OriginalQuestion[]; session: OriginalSessionState }[]; mistakes: OriginalMistake[] };
const answerSources = { original: '原文', supplement: '补充', manual: '我的修订', ai: 'AI参考', none: '待核对', self: '我的自评' };

export function WrongBook({ courseId, materials, onOpenKnowledge, onOpenPaper, onOpenOriginal }: { courseId: string; materials: Material[]; onOpenKnowledge: () => void; onOpenPaper: (materialId: string, question: number) => void; onOpenOriginal?: (materialId: string, questionId: string, context: 'knowledge' | 'paper') => void }) {
  const [history, setHistory] = useState<PracticeHistoryData | null>(null);
  const [records, setRecords] = useState<Record<string, ExamRecord>>({});
  const [originalHistory, setOriginalHistory] = useState<OriginalHistory>({ entries: [], mistakes: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'knowledge' | 'paper'>('all');
  const exams = materials.filter(material => material.chapter === '历年套卷' && material.mime === 'application/pdf' && !material.excluded);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setHistory(null); setRecords({}); setOriginalHistory({ entries: [], mistakes: [] });
    const read = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '作答记录读取失败。');
      return data;
    };
    void Promise.all([
      Promise.allSettled([
        read<PracticeHistoryData>(`/api/practice/history?courseId=${encodeURIComponent(courseId)}`),
        read<OriginalHistory>(`/api/practice?source=original&courseId=${encodeURIComponent(courseId)}`),
      ]),
      Promise.allSettled(exams.map(async material => ({ id: material.id, data: await read<{ record: ExamRecord }>(`/api/exam-records?courseId=${encodeURIComponent(courseId)}&materialId=${encodeURIComponent(material.id)}`) }))),
    ]).then(([[practice, original], papers]) => {
      if (!active) return;
      if (practice.status === 'fulfilled') setHistory(practice.value);
      if (original.status === 'fulfilled') setOriginalHistory({ entries: original.value.entries ?? [], mistakes: original.value.mistakes ?? [] });
      setRecords(Object.fromEntries(papers.flatMap(result => result.status === 'fulfilled' ? [[result.value.id, result.value.data.record]] : [])));
      const failures = [practice, original, ...papers].filter(result => result.status === 'rejected') as PromiseRejectedResult[];
      setError(failures.map(result => result.reason instanceof Error ? result.reason.message : '作答记录读取失败。').join(' '));
      setLoading(false);
    });
    return () => { active = false; };
    // The material list is fixed while this section is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, materials.map(material => material.id).join(',')]);

  const knowledge = history ? knowledgeMistakes(history) : [];
  const papers = exams.flatMap(material => wrongQuestionNumbers(records[material.id] ?? { answers: {}, marks: {}, annotations: {} }).map(number => ({ material, number, answer: records[material.id]?.answers[String(number)] ?? '' })));
  const originalKnowledge = originalHistory.mistakes.filter(item => item.context !== 'paper');
  const originalPapers = originalHistory.mistakes.filter(item => item.context === 'paper');
  const count = knowledge.length + papers.length + originalHistory.mistakes.length;
  const originalGroups = new Map<string, OriginalMistake[]>();
  for (const item of originalHistory.mistakes) {
    if (filter !== 'all' && (item.context === 'paper' ? 'paper' : 'knowledge') !== filter) continue;
    const key = `${item.context}:${item.question.materialId}`;
    originalGroups.set(key, [...(originalGroups.get(key) ?? []), item]);
  }

  return <section className="wrong-book" aria-labelledby="wrong-book-title">
    <div className="training-section-heading"><div><h2 id="wrong-book-title">错题复盘</h2><p>知识点巩固中答错或自评未掌握的题，以及套卷中标记为需巩固的原题，集中在这里。</p></div><span>{count} 题待巩固</span></div>
    <div className="wrong-book-filters" role="group" aria-label="错题来源">
      {([['all', '全部', count], ['knowledge', '知识点', knowledge.length + originalKnowledge.length], ['paper', '套卷', papers.length + originalPapers.length]] as const).map(([value, label, amount]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{amount}</span></button>)}
    </div>
    {loading && <p className="wrong-book-status" role="status">正在汇总作答记录…</p>}
    {error && <p className="modal-error" role="alert">{error} 可切换板块后重试。</p>}
    {!loading && !count && <div className="wrong-book-empty"><RotateCw size={28}/><h3>还没有待巩固的题</h3><p>完成知识点巩固或在套卷中标记错题后，会自动出现在这里。</p><div><Button onClick={onOpenKnowledge}><BookOpen size={15}/>去练知识点</Button><Button onClick={() => onOpenPaper(exams[0]?.id ?? '', 1)} disabled={!exams.length}><FileText size={15}/>打开套卷</Button></div></div>}
    {!loading && filter !== 'paper' && knowledge.length > 0 && <div className="wrong-book-group"><h3>知识点巩固 <span>{knowledge.length}</span></h3>{knowledge.map(item => <details className="wrong-book-item" key={item.question.id}><summary><span className="wrong-book-source">知识点</span><strong>{item.question.prompt}</strong><small>{item.question.topic} · 材料版本 {item.versionNumber} · {new Date(item.at).toLocaleDateString('zh-CN')}</small></summary><div className="wrong-book-detail"><p>参考答案与解析</p><Markdown text={item.question.answer}/><Markdown text={item.question.explanation}/><p className="wrong-book-reference">出处：{item.question.reference.name} · {sourceLocation(item.question.reference.name, item.question.reference.page)}</p><blockquote>{item.question.reference.snippet}</blockquote><CaptureButton title={item.question.topic+' · 错题复盘'} body={[item.question.prompt,item.question.answer,item.question.explanation].join('\n\n')} origin={{kind:'practice',label:'错题复盘',questionId:item.question.id,refs:[item.question.reference]}}/><Button onClick={onOpenKnowledge}>去知识点巩固</Button></div></details>)}</div>}
    {!loading && filter !== 'knowledge' && papers.length > 0 && <div className="wrong-book-group"><h3>套卷练习 <span>{papers.length}</span></h3>{papers.map(({ material, number, answer }) => <div key={`${material.id}-${number}`}><button type="button" className="wrong-book-paper" key={`${material.id}-${number}`} onClick={() => onOpenPaper(material.id, number)}><span className="wrong-book-source">套卷</span><strong>{material.name} · 第 {number} 题</strong><small>{answer ? '已保存作答 · 打开原卷复盘' : '查看原题与作答区'} →</small></button><CaptureButton title={`${material.name} · 第 ${number} 题复盘`} body={`我的作答：\n${answer}\n\n此题仍需巩固，可补充错误原因与解题思路。`} origin={{ kind: 'practice', label: '套卷错题复盘', courseId, refs: [], exam: { materialId: material.id, question: number } }}/></div>)}</div>}
    {!loading && [...originalGroups].map(([key, items]) => <div className="wrong-book-group" key={key}><h3>{items[0].context === 'paper' ? '套卷原题' : '知识点原题'} · {items[0].question.sources[0]?.name ?? materials.find(material => material.id === items[0].question.materialId)?.name ?? '原题文件'} <span>{items.length}</span></h3>{items.map(item => {
      const question = item.question, result = originalHistory.entries.find(entry => { const saved=entry.session.results[question.id];return saved?.correct===false&&(saved.judgedAt??entry.at)===item.at&&entry.context===item.context; })?.session.results[question.id];
      return <details className="wrong-book-item" key={question.id}><summary><span className="wrong-book-source">{item.context === 'paper' ? '套卷原题' : '知识点原题'}{question.origin === 'variant' && ' · AI自编'}</span><strong>{question.section} · 第 {question.number} 题 · {question.prompt}</strong><small>{question.topics.join('、') || '未归类'} · {new Date(item.at).toLocaleDateString('zh-CN')}</small></summary><div className="wrong-book-detail">{question.context && <Markdown text={question.context}/>}<Markdown text={question.prompt}/>{question.options.map(option => <div key={option.label}>{option.label}. <Markdown text={option.text}/></div>)}{question.media?.map((media, index) => <figure key={index}><img src={media.url} alt={media.label} style={{ maxWidth: '100%' }}/></figure>)}<h4>我的作答</h4><Markdown text={item.answer || '未保存作答文字'}/><h4>参考答案与解析</h4><p>答案来源：{answerSources[question.answerSource]}{result && ` · 本次判定：${answerSources[result.source]}`}{question.answerSource === 'ai' && ' · AI参考判定，请核对'}</p><Markdown text={question.answer || '尚无可靠参考答案，请对照原文核对。'}/><Markdown text={question.explanation}/>{!!question.criteria.length && <ul>{question.criteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>}{!!question.warnings.length && <p>{question.warnings.join(' ')}</p>}{question.sources.map((source, index) => <div key={index}><a className="wrong-book-reference" href={`/api/files/${encodeURIComponent(question.materialId)}${/\.pdf$/i.test(source.name)?`#page=${source.page}`:''}`} target="_blank" rel="noreferrer">打开原文件：{source.name} · {sourceLocation(source.name, source.page)}</a><blockquote>{source.snippet}</blockquote></div>)}<CaptureButton title={`${question.section} · 第 ${question.number} 题复盘`} body={[question.context, question.prompt, ...question.options.map(option => `${option.label}. ${option.text}`), `我的作答：${item.answer}`, `参考答案（${answerSources[question.answerSource]}）：${question.answer}`, question.explanation].filter(Boolean).join('\n\n')} origin={{ kind: 'practice', label: '原题错题复盘', courseId, questionId: question.id, refs: question.sources.map(source => ({ materialId: question.materialId, name: source.name, page: source.page, snippet: source.snippet })) }}/>{onOpenOriginal && <Button onClick={() => onOpenOriginal(question.materialId, question.id, item.context === 'paper' ? 'paper' : 'knowledge')}>回到原题练习</Button>}</div></details>;
    })}</div>)}
  </section>;
}

