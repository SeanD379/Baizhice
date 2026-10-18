'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, Check, FileText, ListChecks } from 'lucide-react';
import { hubRequest } from './practice-hub';
import { originalRequest } from './use-original-session';
import { Button } from './ui/button';
import { Markdown } from './markdown';
import SpotlightCard from './react-bits/SpotlightCard';
import LatticeLoader from './react-bits/LatticeLoader';
import { Modal } from './ui/modal';
import { richMarkdown, sourceBlocks, notebookOriginLabel, referenceOriginLabel, type NotebookData, type NotebookOrigin, type KnowledgePage } from '@/lib/notebook';
import { originalKindNames, type OriginalQuestion, type QuestionBankData } from '@/lib/question-bank-types';
import { sourceLocation } from '@/lib/document-labels';
import type { PracticeHubSummary, PracticeLocation } from '@/lib/practice-hub';
import type { Reference } from '@/lib/types';

type Selection = { questions: string[]; knowledge: string[]; generated: string[]; generatedFor: string };
type Stage = 'idle' | 'consent' | 'preparing' | 'review' | 'starting' | 'failed';
const emptySelection = (): Selection => ({ questions: [], knowledge: [], generated: [], generatedFor: '' });
const ready = (question: OriginalQuestion) => !!question.answer.trim() && question.answerSource !== 'none' && !!question.explanation.trim() && !question.knowledgeSourceStale;
function readSelection(key: string): Selection {
  try { const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null'); if (saved && ['questions', 'knowledge', 'generated'].every(field => Array.isArray(saved[field]) && saved[field].every((id: unknown) => typeof id === 'string'))) return { ...saved, generatedFor: typeof saved.generatedFor === 'string' ? saved.generatedFor : '' }; } catch { /* A malformed cache must not prevent opening the file. */ }
  return emptySelection();
}

export function FilePractice({ courseId, materialId, onOpen, onSource }: { courseId: string; materialId: string; onOpen: (location: PracticeLocation) => void | Promise<void>; onSource: (reference: Reference) => void }) {
  const cacheKey = `lms.file-practice:${courseId}:${materialId}`;
  const tabId = useId();
  const [selection, setSelection] = useState<Selection>(() => readSelection(cacheKey));
  const [bank, setBank] = useState<QuestionBankData | null>(null), [knowledge, setKnowledge] = useState<KnowledgePage[]>([]), [summary, setSummary] = useState<PracticeHubSummary | null>(null);
  const [configured, setConfigured] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<'questions' | 'knowledge'>('questions'), [bulk, setBulk] = useState(false), [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState({ label: '', done: 0, total: 0 }), operation = useRef(0), consented = useRef(''), mounted = useRef(true), starting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { try { sessionStorage.setItem(cacheKey, JSON.stringify(selection)); } catch { /* The current selection still works when browser storage is unavailable. */ } }, [cacheKey, selection]);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    void Promise.all([
      hubRequest<{ banks: QuestionBankData[]; configured: boolean }>(`/api/question-banks?courseId=${encodeURIComponent(courseId)}`),
      hubRequest<NotebookData>(`/api/notebooks/${encodeURIComponent(courseId)}`),
      hubRequest<PracticeHubSummary>(`/api/practice-hub?courseId=${encodeURIComponent(courseId)}&section=knowledge`),
    ]).then(([result, notebook, hub]) => {
      if (!alive) return;
      const current = result.banks.find(bank => bank.materialId === materialId) ?? null;
      const pages = notebook.document.pages.flatMap(page => {
        const blocks = sourceBlocks(page.doc).filter(block => (block.attrs?.origin as NotebookOrigin | undefined)?.refs.some(ref => ref.materialId === materialId));
        return blocks.length && blocks.every(block => !(block.attrs?.origin as NotebookOrigin).needsReview) ? [{ ...page, doc: { type: 'doc', content: blocks } }] : [];
      });
      setBank(current); setKnowledge(pages); setSummary(hub); setConfigured(result.configured);
      if (!current?.questions.some(question => question.practiceArea === 'knowledge')) setTab('knowledge');
      setSelection(value => ({ ...value, questions: value.questions.filter(id => current?.questions.some(question => question.id === id && question.practiceArea === 'knowledge' && !question.knowledgeSourceStale)), knowledge: value.knowledge.filter(id => pages.some(page => page.id === id)), generated: value.generated.filter(id => current?.questions.some(question => question.id === id && !question.knowledgeSourceStale)) }));
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : '文件内容读取失败，请重试。'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; operation.current++; };
  }, [courseId, materialId, revision]);
  const staleKnowledgeQuestions = bank?.questions.filter(question => question.practiceArea === 'knowledge' && question.knowledgeSourceStale) ?? [];
  const questions = bank?.questions.filter(question => question.practiceArea === 'knowledge' && !question.knowledgeSourceStale) ?? [];
  const chosen = questions.filter(question => selection.questions.includes(question.id));
  const selectedKnowledge = knowledge.filter(page => selection.knowledge.includes(page.id));
  const material = summary?.materials.find(material => material.id === materialId);
  const blocked = loading ? '' : !summary || !Array.isArray(summary.withheldMaterials) ? '考试状态暂不可用，请重试读取。' : summary.withheldMaterials.includes(materialId) ? '这份资料有未交卷考试，请先交卷，再查看答案或准备复习。' : !material?.available || material.status === 'conflict' ? '所选资料暂不可用，请回到知识点巩固重新选择。' : bank?.stale ? '原文件已更新，请在我的资料中重新核对并收录。' : '';
  const locked = ['consent', 'preparing', 'starting'].includes(stage), busy = stage === 'preparing' || stage === 'starting';
  const count = chosen.length + selectedKnowledge.length;
  const knowledgeKey = [...selection.knowledge].sort().join('|');
  const scopeKey = JSON.stringify([selection.questions, selection.knowledge]);
  const needsKnowledge = selectedKnowledge.length > 0 && (selection.generatedFor !== knowledgeKey || !selection.generated.length || selection.generated.some(id => !questions.some(question => question.id === id)));
  const missing = chosen.filter(question => !ready(question));
  function changeSelection(next: Selection) { setSelection(next); setStage('idle'); setError(''); consented.current = ''; }
  function toggleQuestion(question: OriginalQuestion) {
    if (!selection.questions.includes(question.id) && chosen.filter(item => item.origin === question.origin).length >= (question.origin === 'variant' ? 5 : 10)) { setError(question.origin === 'variant' ? '每轮最多选择 5 道 AI 自编题。' : '每轮最多选择 10 道原题，可以分组复习。'); return; }
    changeSelection({ ...selection, questions: selection.questions.includes(question.id) ? selection.questions.filter(id => id !== question.id) : [...selection.questions, question.id] });
  }
  function toggleKnowledge(id: string) {
    if (!selection.knowledge.includes(id) && selection.knowledge.length >= 12) { setError('每次最多选择 12 个知识点，请分组复习。'); return; }
    changeSelection({ ...selection, knowledge: selection.knowledge.includes(id) ? selection.knowledge.filter(value => value !== id) : [...selection.knowledge, id] });
  }
  async function checkExam() {
    const current = await hubRequest<PracticeHubSummary>(`/api/practice-hub?courseId=${encodeURIComponent(courseId)}&section=knowledge`);
    setSummary(current);
    if (!Array.isArray(current.withheldMaterials) || current.withheldMaterials.includes(materialId) || !current.materials.some(material => material.id === materialId && material.available && material.status !== 'conflict')) throw Error('资料或考试状态发生变化，请重新核对后继续。');
  }
  async function readBank() {
    const result = await hubRequest<{ banks: QuestionBankData[] }>(`/api/question-banks?courseId=${encodeURIComponent(courseId)}`), current = result.banks.find(bank => bank.materialId === materialId);
    if (!current || current.stale) throw Error('题库来源已变化，请重新核对。');
    setBank(current); return current;
  }
  async function startRound(ids: string[], reviewed = false) {
    if (starting.current) return;
    if (!ids.length) { setError('请至少选择一道已准备好的题目。'); return; }
    starting.current = true;
    setStage('starting'); setError(''); setProgress({ label: '正在准备本次练习…', done: 0, total: 0 });
    try {
      await checkExam();
      let current = await readBank();
      const selected = ids.map(id => current.questions.find(question => question.id === id));
      if (selected.some(question => !question || !ready(question))) throw Error('所选题目的答案或解析尚未准备完成，请先补齐。');
      if (reviewed && chosen.some(question => { const live = current.questions.find(item => item.id === question.id); return !live || JSON.stringify([live.prompt, live.options, live.answer, live.explanation]) !== JSON.stringify([question.prompt, question.options, question.answer, question.explanation]); })) throw Error('题目或答案发生变化，请重新核对后继续。');
      const pending = selected.filter(question => question!.practiceReview === 'pending').map(question => question!.id);
      if (pending.length) {
        if (!reviewed) throw Error('请先核对 AI 生成的题目、答案与解析。');
        current = (await hubRequest<{ bank: QuestionBankData }>('/api/question-banks', { action: 'review-knowledge', courseId, bankId: current.id, revision: current.revision, questionIds: pending })).bank;
        setBank(current);
      }
      const data = await originalRequest({ action: 'original-load', courseId, context: 'knowledge', questionIds: ids, mode: 'practice', newRound: true, readyOnly: true });
      await onOpen({ section: 'knowledge', activity: 'practice', materialId, scope: data.scope, fromFile: true });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '本次练习准备失败，请重试。'); setStage(reviewed ? 'review' : 'failed'); } finally { starting.current = false; }
  }
  async function prepare() {
    const token = ++operation.current, active = () => operation.current === token;
    setStage('preparing'); setError(''); setProgress({ label: '正在检查所选内容…', done: 0, total: chosen.length });
    try {
      await checkExam(); if (!active()) return;
      let current = bank, ids = [...selection.questions];
      if (needsKnowledge) {
        const slots = 5 - chosen.filter(question => question.origin === 'variant').length;
        if (slots < 1) throw Error('本轮已选择 5 道 AI 自编题，请减少选择后再从知识点出题。');
        setProgress({ label: `正在从 ${selectedKnowledge.length} 个知识点生成题目与答案…`, done: 0, total: 0 });
        const result = await hubRequest<{ bank: QuestionBankData; questionIds: string[] }>('/api/question-banks', { action: 'generate-knowledge', courseId, materialId, pageIds: selection.knowledge, count: slots, confirmed: true });
        if (!active()) {
          if (mounted.current) { setBank(value => !value || value.revision < result.bank.revision ? result.bank : value); setSelection(value => [...value.knowledge].sort().join('|') === knowledgeKey && !(value.generatedFor === knowledgeKey && result.questionIds.every(id => value.generated.includes(id))) ? { ...value, questions: [...new Set([...value.questions, ...result.questionIds])], generated: result.questionIds, generatedFor: knowledgeKey } : value); }
          return;
        }
        current = result.bank; ids = [...ids, ...result.questionIds];
        setBank(current); setSelection(value => ({ ...value, questions: ids, generated: result.questionIds, generatedFor: knowledgeKey }));
      }
      if (!current) throw Error('题目尚未收录，请先在我的资料中核对并收录。');
      const selected = () => ids.map(id => current!.questions.find(question => question.id === id));
      if (selected().some(question => !question)) throw Error('所选题目已变化，请重新选择。');
      const incomplete = selected().filter(question => !ready(question!)).map(question => question!.id);
      if (incomplete.length) {
        if (current.state !== 'processing') await hubRequest('/api/question-banks', { action: 'analyze', courseId, materialIds: [materialId], questionIds: incomplete, confirmed: true });
        do {
          if (!active()) return;
          current = await readBank();
          if (!active()) return;
          if (selected().some(question => !question)) throw Error('所选题目已变化，请重新选择。');
          const completed = selected().filter(question => ready(question!)).length;
          setProgress({ label: '正在补齐答案与解析…', done: completed, total: ids.length });
          if (completed === ids.length) break;
          if (current.state !== 'processing') throw Error(current.error || '部分所选题目仍缺少答案或解析，已完成内容保留，可重试。');
          await new Promise(resolve => setTimeout(resolve, 2000));
        } while (active());
      }
      if (!active()) return;
      await checkExam(); if (!active()) return;
      setBank(current); setTab('questions'); setStage('review'); setProgress({ label: '题目、答案与解析已准备好，请核对后开始。', done: ids.length, total: ids.length });
    } catch (reason) { if (active()) { setError(reason instanceof Error ? reason.message : '准备未完成，已有内容保留，请重试。'); setStage('failed'); } }
  }
  function begin() {
    if (!count || loading || blocked || busy) return;
    setError('');
    if (chosen.filter(question => question.origin === 'original').length > 10 || chosen.filter(question => question.origin === 'variant').length > 5) { setError('本轮最多 10 道原题和 5 道 AI 自编题，请调整选择。'); return; }
    if (needsKnowledge || missing.length) {
      if (!configured) { setError('AI 助手暂未启用，无法补齐所选内容；可选择已有答案与解析的题目。'); return; }
      if (consented.current === scopeKey) void prepare(); else setStage('consent');
    } else if (chosen.some(question => question.answerSource === 'ai' || question.practiceReview === 'pending')) { setTab('questions'); setStage('review'); }
    else void startRound(selection.questions);
  }
  function returnToSelection() { operation.current++; setStage('idle'); setError(''); }
  const references = (page: KnowledgePage) => sourceBlocks(page.doc).flatMap(block => (block.attrs?.origin as NotebookOrigin).refs).filter(ref => ref.materialId === materialId);
  function tabKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'questions' : event.key === 'End' ? 'knowledge' : tab === 'questions' ? 'knowledge' : 'questions';
    setTab(next); event.currentTarget.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId)}-${next}`)?.focus();
  }
  return <div className="file-practice">
    <header className="file-practice-header"><div><h1>{material?.name ?? bank?.name ?? '资料内容'}</h1><p>{questions.length} 道题目 · {knowledge.length} 个知识点</p></div><div className="file-practice-actions"><Button disabled={loading || !!blocked || locked} aria-expanded={bulk} onClick={() => setBulk(value => !value)}><ListChecks size={16}/>批量选择</Button><Button variant="primary" disabled={loading || !!blocked || busy || stage === 'consent' || !count} onClick={begin}>开始复习（{count} 项）<ArrowRight size={16}/></Button></div></header>
    {error && <p className="file-practice-error" role="alert">{error}<Button size="sm" onClick={() => loading || !summary ? setRevision(value => value + 1) : begin()}>重试{!summary ? '读取' : '准备'}</Button></p>}
    {!loading && !blocked && staleKnowledgeQuestions.length > 0 && <p className="file-practice-blocked" role="status">{staleKnowledgeQuestions.length} 道知识点练习的来源已更新，已暂停使用。核对原知识点后可重新生成，已有记录保留。<Button size="sm" onClick={() => void onOpen({ section: 'knowledge', activity: 'organize', pageId: staleKnowledgeQuestions[0].knowledgeSource?.pageIds[0] })}>核对原知识点</Button></p>}
    {loading ? <div className="file-practice-preparation" role="status"><LatticeLoader label="正在读取已收录内容…" color="var(--hub-action)" glow={false}/></div> : blocked ? <p className="file-practice-blocked" role="status">{blocked}<Button onClick={() => setRevision(value => value + 1)}>重新读取</Button></p> : <>
      {bulk && <div className="file-practice-bulk"><span>已选 {chosen.length} 道题目、{selectedKnowledge.length} 个知识点</span><Button size="sm" disabled={locked} onClick={() => changeSelection({ ...selection, questions: [...questions.filter(question => question.origin === 'original').slice(0, 10), ...questions.filter(question => question.origin === 'variant').slice(0, 5)].map(question => question.id) })}>选择本轮题目</Button><Button size="sm" disabled={locked || knowledge.length > 12} onClick={() => changeSelection({ ...selection, knowledge: knowledge.map(page => page.id) })}>全选知识点</Button><Button size="sm" disabled={locked} onClick={() => changeSelection({ ...selection, questions: [], knowledge: [] })}>清空选择</Button><small>每轮最多 10 道原题、5 道 AI 自编题；最多选择 12 个知识点。</small></div>}
      {stage === 'consent' && <section className="file-practice-preparation"><h2>准备本次复习</h2><p>{needsKnowledge && `从 ${selectedKnowledge.length} 个知识点生成练习。`}{missing.length > 0 && `补齐 ${missing.length} 题答案与解析。`}AI 助手只处理所选内容，可能产生 API 费用；资料已有答案保留。</p><div><Button onClick={returnToSelection}>返回选择</Button><Button variant="primary" onClick={() => { consented.current = scopeKey; void prepare(); }}>准备所选内容</Button></div></section>}
      {stage === 'review' && <section className="file-practice-preparation"><h2><Check size={18}/>核对题目、答案与解析</h2><p>下方已展开所选题目的答案。AI 结果不等于标准答案，请结合原文核对；可以取消不合适的题目。</p><div><Button onClick={returnToSelection}>返回选择</Button><Button variant="primary" disabled={!chosen.length} onClick={() => void startRound(selection.questions, true)}>已核对，开始复习</Button></div></section>}
      <div className="file-practice-tabs" role="tablist" aria-label="文件收录内容" onKeyDown={tabKeys}><button type="button" id={`${tabId}-questions`} role="tab" tabIndex={tab === 'questions' ? 0 : -1} aria-controls={`${tabId}-panel`} aria-selected={tab === 'questions'} onClick={() => setTab('questions')}>题目（{questions.length}）</button><button type="button" id={`${tabId}-knowledge`} role="tab" tabIndex={tab === 'knowledge' ? 0 : -1} aria-controls={`${tabId}-panel`} aria-selected={tab === 'knowledge'} onClick={() => setTab('knowledge')}>知识点（{knowledge.length}）</button></div>
      <div className="file-practice-cards" id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${tab}`}>
        {tab === 'questions' ? questions.length ? questions.map(question => <SpotlightCard theme="light" key={question.id} className="file-practice-card" spotlightColor="var(--hub-accent)" intensity={0.06} borderGlow={0.12} proximity={0} ambient={false} flare={false}>
          <label className="file-practice-card-heading"><input type="checkbox" aria-label={`选择题目 ${question.id}`} checked={selection.questions.includes(question.id)} disabled={locked} onChange={() => toggleQuestion(question)}/><strong>{originalKindNames[question.kind]} · {question.origin === 'variant' ? 'AI 自编' : '原题'} {question.number}</strong><small>{ready(question) ? question.practiceReview === 'pending' ? '待核对' : '答案已就绪' : '待补答案与解析'}</small></label>
          {question.context && <details><summary>查看共同材料</summary><Markdown text={question.context}/></details>}<Markdown text={question.prompt}/>{question.options.length > 0 && <div className="file-practice-options">{question.options.map(option => <div key={option.label}><strong>{option.label}.</strong><Markdown text={option.text}/></div>)}</div>}{question.media?.map(media => <figure key={media.url}><img src={media.url} alt={media.label}/></figure>)}
          <div className="file-practice-card-actions"><details className="file-practice-answer" open={stage === 'review' && selection.questions.includes(question.id) || undefined}><summary>查看答案与解析</summary><strong>{question.answerSource === 'ai' ? 'AI 参考答案' : question.answerSource === 'manual' ? '我的修订答案' : question.answerSource === 'none' ? '参考答案（待补齐）' : '资料答案'}</strong><Markdown text={question.answer || '答案待补齐'}/><strong>{question.explanationSource === 'ai' || question.answerSource === 'ai' ? 'AI 补充解析' : '解析'}</strong><Markdown text={question.explanation || '解析待补齐'}/>{question.warnings.length > 0 && <ul>{question.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</details>
          {question.sources[0] && <button type="button" className="file-practice-source" onClick={() => onSource({ materialId, ...question.sources[0], name: material!.name })}><FileText size={14}/>查看出处 · {sourceLocation(material!.name, question.sources[0].page)}</button>}</div>
        </SpotlightCard>) : <p className="file-practice-empty">这份资料还没有收录题目，可以选择知识点生成练习。</p> : knowledge.length ? knowledge.map(page => {
          const origin = sourceBlocks(page.doc)[0].attrs?.origin as NotebookOrigin, reference = references(page)[0];
          return <SpotlightCard theme="light" key={page.id} className="file-practice-card" spotlightColor="var(--hub-accent)" intensity={0.06} borderGlow={0.12} proximity={0} ambient={false} flare={false}><label className="file-practice-card-heading"><input type="checkbox" aria-label={`选择知识点 ${page.id}`} checked={selection.knowledge.includes(page.id)} disabled={locked} onChange={() => toggleKnowledge(page.id)}/><strong>{page.title}</strong><small>知识点</small></label><Markdown text={richMarkdown(page.doc)}/><p className="file-practice-origin">{notebookOriginLabel(origin)} · {referenceOriginLabel(origin.generation)}</p>{reference && <button type="button" className="file-practice-source" onClick={() => onSource(reference)}><FileText size={14}/>查看出处 · {sourceLocation(reference.name, reference.page)}</button>}</SpotlightCard>;
        }) : <p className="file-practice-empty">这份资料还没有关联已核对的知识点。</p>}
      </div>
    </>}
    <Modal open={busy} onOpenChange={open => { if (!open && stage === 'preparing') returnToSelection(); }} title="正在准备复习" description={material?.name ?? '所选内容'}>
      <section className="practice-loading-screen" data-starting={stage === 'starting'} aria-live="polite">
        <LatticeLoader label={progress.label} doneLabel="已准备" errorLabel="未完成" pattern="sweep" grid={4} cellSize={12} gap={5} fontSize={14} showTimer={false} color="var(--hub-action)" glow={false}/>
        {progress.total > 0 ? <><div className="practice-loading-count"><strong>{Math.round(progress.done / progress.total * 100)}<small>%</small></strong><span>已准备 {progress.done} / {progress.total} 题</span></div><progress aria-label="答案准备进度" value={progress.done} max={progress.total}/></> : <div className="practice-loading-indeterminate" role="status" aria-label={progress.label}><span/></div>}
        <p>{stage === 'starting' ? '正在打开本轮题目' : '答案与解析准备好后，先核对再开始。'}</p>
        {stage === 'preparing' && <Button onClick={returnToSelection}>返回选择</Button>}
      </section>
    </Modal>
  </div>;
}
