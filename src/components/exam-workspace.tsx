'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Check, ChevronLeft, ChevronRight, CircleAlert } from 'lucide-react';
import { Button } from './ui/button';
import { QuestionStudyControls } from './practice-study-context';
import { CaptureButton } from './notebook-context';
import { emptyExamRecord, type ExamRecord } from '@/lib/exam-record';
import { examQuestionPage, examReadingGuide } from '@/lib/exam-reading';
import { chineseExamInfo } from '@/lib/content';
import type { Material } from '@/lib/types';

const PdfPreview = dynamic(() => import('./pdf-preview'), { ssr: false, loading: () => <p>正在打开原卷…</p> });
const groups = [
  { label: '现代文阅读', from: 1, to: 9 },
  { label: '古代诗文阅读', from: 10, to: 17 },
  { label: '语言文字运用', from: 18, to: 22 },
  { label: '写作', from: 23, to: 23 },
];

export function ExamWorkspace({ courseId, materials, initialMaterialId, initialQuestion, registerLeave, questionNumbers }: { courseId: string; materials: Material[]; initialMaterialId?: string; initialQuestion?: number; questionNumbers?: number[]; registerLeave?: (flush: (() => Promise<boolean>) | null) => void }) {
  const exams = materials.filter(material => material.chapter === '历年套卷' && material.mime === 'application/pdf' && !material.excluded && material.status !== 'review' && !material.conflictResolution);
  const [selectedId, setSelectedId] = useState(initialMaterialId ?? exams[0]?.id ?? '');
  const allowedQuestions = questionNumbers?.length ? questionNumbers : Array.from({ length: 23 }, (_, i) => i + 1);
  const [question, setQuestion] = useState(initialQuestion && allowedQuestions.includes(initialQuestion) ? initialQuestion : allowedQuestions[0]);
  const [records, setRecords] = useState<Record<string, ExamRecord>>({});
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const latest = useRef(records), savedRef = useRef(saved), revisionRef = useRef(revisions), blocked = useRef(new Set<string>()), queue = useRef(Promise.resolve(true)), active = useRef(true);
  latest.current = records; savedRef.current = saved; revisionRef.current = revisions;
  const flushRef = useRef(async () => true);
  flushRef.current = async () => { for (const [id, record] of Object.entries(latest.current)) if (!await saveRecord(id, record)) return false; return true; };
  useEffect(() => { active.current = true; registerLeave?.(() => flushRef.current()); return () => { active.current = false; registerLeave?.(null); void flushRef.current(); }; }, [registerLeave]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all(exams.map(async material => {
      const response = await fetch(`/api/exam-records?courseId=${encodeURIComponent(courseId)}&materialId=${encodeURIComponent(material.id)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '作答记录读取失败。');
      return { id: material.id, record: data.record as ExamRecord, revision: data.revision as number };
    })).then(items => {
      if (!active) return;
      setRecords(Object.fromEntries(items.map(item => [item.id, item.record])));
      setRevisions(Object.fromEntries(items.map(item => [item.id, item.revision])));
      setSaved(Object.fromEntries(items.map(item => [item.id, JSON.stringify(item.record)])));
      setErrors({});
    }).catch(error => { if (active) setErrors({ load: error instanceof Error ? error.message : '作答记录读取失败。' }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // The material set is fixed when the page opens; reopening refreshes every paper's record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, materials.map(material => material.id).join(',')]);

  function saveRecord(id: string, _record: ExamRecord): Promise<boolean> {
    queue.current = queue.current.then(async () => {
      if (blocked.current.has(id)) return false;
      while (latest.current[id] && JSON.stringify(latest.current[id]) !== savedRef.current[id]) {
        const content = JSON.stringify(latest.current[id]);
        if (active.current) setSaving(current => ({ ...current, [id]: true }));
        try {
          const response = await fetch('/api/exam-records', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId, materialId: id, revision: revisionRef.current[id], record: JSON.parse(content) }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? '作答记录保存失败。');
          revisionRef.current = { ...revisionRef.current, [id]: result.revision };
          savedRef.current = { ...savedRef.current, [id]: content };
          if (active.current) { setRevisions(revisionRef.current); setSaved(savedRef.current); }
        } catch (error) {
          blocked.current.add(id);
          if (active.current) setErrors(current => ({ ...current, [id]: error instanceof Error ? error.message : '作答记录保存失败。' }));
          return false;
        } finally { if (active.current) setSaving(current => ({ ...current, [id]: false })); }
      }
      return true;
    });
    return queue.current;
  }

  useEffect(() => {
    const timers = Object.entries(records).filter(([id, record]) => saved[id] !== JSON.stringify(record) && !saving[id] && !errors[id])
      .map(([id, record]) => window.setTimeout(() => void saveRecord(id, record), 900));
    return () => timers.forEach(window.clearTimeout);
    // Save again after a previous request finishes if the student changed an answer meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, saved, saving, errors, revisions]);

  useEffect(() => {
    const dirty = Object.entries(records).some(([id, record]) => saved[id] !== JSON.stringify(record));
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [records, saved]);

  const currentExam = exams.find(material => material.id === selectedId);
  const questionIndex = allowedQuestions.indexOf(question);
  const currentRecord = currentExam ? records[currentExam.id] ?? emptyExamRecord() : emptyExamRecord();
  function update(id: string, change: (record: ExamRecord) => ExamRecord) {
    const next = { ...latest.current, [id]: change(latest.current[id] ?? emptyExamRecord()) }; latest.current = next; setRecords(next);
  }
  return <div className="exam-workspace">
    <div className="training-section-heading"><div><h2>套卷练习</h2><p>在原卷上查看完整题目，按题号作答并标记掌握情况；标为需巩固的题会进入错题复盘。</p></div></div>
    {errors.load && <p className="modal-error" role="alert">{errors.load}</p>}
    {loading ? <p role="status">正在读取本机作答记录…</p> : selectedId && !currentExam ? <div role="alert" className="empty-state"><h2>这份原卷已移除或暂不可用</h2><p>原有作答仍保留；请回到试卷书架重新选择可用原卷。</p></div> : !exams.length ? <div className="empty-state"><h2>还没有套卷</h2><p>在资料库导入或归类一份 PDF 套卷后，就可以在这里记录作答。</p></div> : currentExam && <div className="exam-paper-workspace">
      <div className="exam-paper-picker"><label htmlFor="exam-paper-select">选择套卷</label><select id="exam-paper-select" value={currentExam.id} onChange={event => { setSelectedId(event.target.value); setQuestion(allowedQuestions[0]); }}>{exams.map(material => <option key={material.id} value={material.id}>{material.name}</option>)}</select></div>
      <div className="exam-original"><div className="exam-original-heading"><div><h2>原卷 · 第 {question} 题</h2><p>{examReadingGuide(currentExam) ? '已跳到对应原卷页；' : '请翻到原题所在页；'}可用画笔或荧光笔标注原卷，再在答题区记录答案。</p></div><div className="exam-original-actions"><a href={`/api/files/${currentExam.id}#page=${examQuestionPage(currentExam.name, question)}`} target="_blank" rel="noreferrer">单独打开原题 ↗</a><Button variant="secondary" onClick={() => document.getElementById('exam-answer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>填写第 {question} 题答案 ↓</Button></div></div><PdfPreview key={`${currentExam.id}-${question}`} url={`/api/files/${currentExam.id}`} initialPage={examQuestionPage(currentExam.name, question)} name={currentExam.name} landmarks={examReadingGuide(currentExam)?.landmarks} annotations={currentRecord.annotations} onAnnotationsChange={(page, strokes) => update(currentExam.id, record => ({ ...record, annotations: { ...record.annotations, [String(page)]: strokes } }))}/></div>
      <div className="exam-answer-panel" id="exam-answer-panel"><div className="exam-answer-heading"><h2>答题区</h2><span role="status">{saving[currentExam.id] ? '正在保存…' : errors[currentExam.id] ? '保存失败' : saved[currentExam.id] === JSON.stringify(currentRecord) ? '已保存本机' : '待保存'}</span></div>
        <div className="exam-question-select"><label htmlFor="exam-question-select">原卷题号</label><div><Button size="icon" variant="secondary" disabled={questionIndex <= 0} aria-label="上一题" onClick={() => setQuestion(allowedQuestions[questionIndex - 1])}><ChevronLeft size={16}/></Button><select id="exam-question-select" value={question} onChange={event => setQuestion(Number(event.target.value))}>{groups.filter(group => allowedQuestions.some(number => number >= group.from && number <= group.to)).map(group => <optgroup key={group.label} label={group.label}>{Array.from({ length: group.to - group.from + 1 }, (_, index) => group.from + index).filter(number => allowedQuestions.includes(number)).map(number => <option key={number} value={number}>第 {number} 题{currentRecord.marks[String(number)] === 'wrong' ? ' · 待巩固' : ''}</option>)}</optgroup>)}</select><Button size="icon" variant="secondary" disabled={questionIndex === allowedQuestions.length - 1} aria-label="下一题" onClick={() => setQuestion(allowedQuestions[questionIndex + 1])}><ChevronRight size={16}/></Button></div></div>
        <QuestionStudyControls question={{engine:'pdf',questionId:String(question),materialId:currentExam.id}}/><div className="exam-answer-edit"><label htmlFor="exam-answer">我的作答 · 第 {question} 题</label><textarea id="exam-answer" className="exam-lined-answer" rows={6} value={currentRecord.answers[String(question)] ?? ''} placeholder="在原卷找到完整题目后，在这里写下答案；有多个小问时可分行作答。" onChange={event => update(currentExam.id, record => ({ ...record, answers: { ...record.answers, [String(question)]: event.target.value } }))}/><p>原卷中的作答横线仍以 PDF 显示。</p>
          {currentExam.name === chineseExamInfo['2024-new-i'].name ? <p className="exam-answer-caution"><CircleAlert size={15}/>原卷含参考答案，可翻到答案页核对后标记对错。</p> : <p className="exam-answer-caution"><CircleAlert size={15}/>这份文件未确认含有参考答案，请先对照可信答案或老师讲解，再自行标记对错。</p>}
          <div className="exam-mark-actions"><Button variant={currentRecord.marks[String(question)] === 'correct' ? 'primary' : 'secondary'} onClick={() => update(currentExam.id, record => ({ ...record, marks: { ...record.marks, [String(question)]: 'correct' }, markedAt: { ...record.markedAt, [String(question)]: new Date().toISOString() } }))}><Check size={15}/>答对／已掌握</Button><Button variant={currentRecord.marks[String(question)] === 'wrong' ? 'primary' : 'secondary'} onClick={() => update(currentExam.id, record => ({ ...record, marks: { ...record.marks, [String(question)]: 'wrong' }, markedAt: { ...record.markedAt, [String(question)]: new Date().toISOString() } }))}>答错／需巩固</Button></div>
          <CaptureButton title={`${currentExam.name} · 第 ${question} 题复盘`} body={`我的作答：\n${currentRecord.answers[String(question)] ?? ''}\n\n掌握情况：${currentRecord.marks[String(question)] === 'wrong' ? '需巩固' : currentRecord.marks[String(question)] === 'correct' ? '已掌握' : '待核对'}`} origin={{ kind: 'practice', label: '套卷复盘', courseId, exam: { materialId: currentExam.id, question }, refs: examReadingGuide(currentExam) ? [{ materialId: currentExam.id, name: currentExam.name, page: examQuestionPage(currentExam.name, question), snippet: `第 ${question} 题 · 我的作答记录` }] : [] }}/>{errors[currentExam.id] && <div className="modal-error" role="alert">{errors[currentExam.id]} <Button onClick={() => { blocked.current.delete(currentExam.id); setErrors(current => ({ ...current, [currentExam.id]: '' })); }}>重试保存</Button></div>}
        </div>
        <details className="exam-question-picker"><summary>按章节选择其他题目</summary><div className="exam-question-groups">{groups.filter(group => allowedQuestions.some(number => number >= group.from && number <= group.to)).map(group => <section key={group.label}><h3>{group.label}</h3><div>{Array.from({ length: group.to - group.from + 1 }, (_, index) => group.from + index).filter(number => allowedQuestions.includes(number)).map(number => <button key={number} type="button" className={`${question === number ? 'active ' : ''}${currentRecord.marks[String(number)] === 'wrong' ? 'is-wrong' : ''}`} aria-pressed={question === number} onClick={() => setQuestion(number)}>{number}</button>)}</div></section>)}</div></details>
      </div>
    </div>}
  </div>;
}
