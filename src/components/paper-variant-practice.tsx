'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileText, LoaderCircle, Play, Sparkles } from 'lucide-react';
import type { Material } from '@/lib/types';
import type { PracticeHubSummary, PracticeLocation } from '@/lib/practice-hub';
import { originalKindNames, type OriginalQuestion, type QuestionBankData } from '@/lib/question-bank-types';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { Markdown } from './markdown';
import { hubRequest, HubEmpty, useHubSummary, useStudyCatalog } from './practice-hub';
import { originalRequest } from './use-original-session';

type Props = { courseId: string; materials: Material[]; location: PracticeLocation; onOpen: (location: PracticeLocation) => void | Promise<void>; onUpload: () => void };
function QuestionPreview({ question }: { question: OriginalQuestion }) {
  return <><div className="hub-variant-topic">{question.topics.join(' · ') || '知识点待标注'}</div>{question.context && <details className="hub-variant-material"><summary>共同材料 · 查看全文</summary><Markdown text={question.context}/></details>}<Markdown text={question.prompt}/>{question.options.length > 0 && <div className="hub-variant-options">{question.options.map(option => <div key={option.label}><strong>{option.label}.</strong><Markdown text={option.text}/></div>)}</div>}{question.media?.map((media, i) => <figure className="hub-variant-media" key={`${media.url}:${i}`}><img src={media.url} alt={media.label}/>{media.label && <figcaption>{media.label}</figcaption>}</figure>)}</>;
}

export function PaperVariantPractice({ courseId, materials, location, onOpen, onUpload }: Props) {
  const section = location.section === 'mistakes' ? 'mistakes' : 'papers';
  const summary = useHubSummary(courseId, section), catalog = useStudyCatalog(summary.data);
  const wrong = catalog.filter(question => question.mistake && question.available && question.ref.engine === 'original');
  const [banks, setBanks] = useState<QuestionBankData[]>([]), [configured, setConfigured] = useState(false), [loadingBanks, setLoadingBanks] = useState(true), [bankError, setBankError] = useState(''), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [consent, setConsent] = useState(false), [actionError, setActionError] = useState(''), [protectedNow, setProtectedNow] = useState(false), [freshIds, setFreshIds] = useState<string[] | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let alive = true; setLoadingBanks(true); setBankError('');
    void hubRequest<{ banks: QuestionBankData[]; configured: boolean }>(`/api/question-banks?courseId=${encodeURIComponent(courseId)}`).then(result => { if (alive) { setBanks(result.banks); setConfigured(result.configured); } }).catch(e => { if (alive) setBankError(e.message); }).finally(() => { if (alive) setLoadingBanks(false); });
    return () => { alive = false; };
  }, [courseId, revision]);
  useEffect(() => { if (freshIds?.length) resultHeading.current?.scrollIntoView({ block: 'start' }); }, [freshIds]);
  const eligible = materials.filter(material => !material.excluded && !['review', 'conflict'].includes(material.status) && !material.conflictResolution && (section !== 'mistakes' || wrong.some(question => question.ref.materialId === material.id)));
  const materialId = location.materialId ?? eligible.find(material => material.chapter === '历年套卷')?.id ?? eligible[0]?.id ?? '';
  const selectedMaterial = eligible.find(material => material.id === materialId), bank = selectedMaterial && banks.find(item => item.materialId === materialId);
  const originals = bank?.questions.filter(question => question.origin === 'original' && (section !== 'mistakes' || wrong.some(item => item.ref.questionId === question.id))) ?? [];
  const base = location.question ? originals.find(question => question.id === location.question || question.number === location.question) : originals[0];
  const variants = base ? (bank?.questions.filter(question => question.origin === 'variant' && question.id.startsWith(`${base.id}:variant:`)) ?? []).filter(question => freshIds === null || freshIds.includes(question.id)).slice(-5) : [];
  const protectionKnown = !!summary.data && Array.isArray(summary.data.withheldMaterials), protectedMaterial = protectedNow || !!summary.data?.withheldMaterials?.includes(materialId);
  const loading = loadingBanks || !summary.data && !summary.error;
  const unavailable = !selectedMaterial ? '所选试卷暂不可用，请重新选择试卷。' : !protectionKnown ? '考试状态暂不可用，请刷新后重试。' : protectedMaterial ? '这份原卷有未交卷考试，交卷后再核对答案或生成同类题。' : bank?.stale ? '原文件已更新，请重新读取试卷。' : !base ? location.question ? '原题已更新，请重新选择一道原题。' : '先读取试卷，再选择一道完整原题。' : !base.answer.trim() ? '这道原题缺少参考答案，请先补齐并核对答案。' : !configured ? '尚未配置 AI 出题服务，可以先核对与准备原题。' : '';
  const canGenerate = !loading && !busy && !!base && !!bank && !unavailable && !bankError && !summary.error;
  const canStart = !loading && !busy && protectionKnown && !protectedMaterial && !!bank && !bank.stale && !!variants.length && !bankError && !summary.error;
  function refresh() { setActionError(''); setProtectedNow(false); setRevision(value => value + 1); summary.refresh(); }
  function select(material: string, question?: string) { void onOpen({ section, activity: 'variants', materialId: material, ...(question ? { question } : {}) }); }
  async function checkExam() {
    const current = await hubRequest<PracticeHubSummary>(`/api/practice-hub?courseId=${encodeURIComponent(courseId)}&section=${section}`);
    if (!Array.isArray(current.withheldMaterials)) throw Error('考试状态暂不可用，请刷新后重试。');
    if (current.withheldMaterials.includes(materialId)) { setProtectedNow(true); throw Error('这份原卷有未交卷考试，请先完成考试。'); }
  }
  async function readPaper() {
    setBusy(true); setActionError('');
    try { const result = await hubRequest<{ banks: QuestionBankData[] }>('/api/question-banks', { action: 'prepare', courseId, materialIds: [materialId] }); setBanks(items => [...items.filter(item => item.materialId !== materialId), ...result.banks]); setFreshIds(null); }
    catch (e) { setActionError(e instanceof Error ? e.message : '试卷读取失败，请重试。'); } finally { setBusy(false); }
  }
  async function generate() {
    if (!canGenerate || !bank || !base) return;
    setBusy(true); setActionError('');
    try {
      await checkExam();
      const previous = new Set(bank.questions.map(question => question.id));
      const result = await hubRequest<{ bank: QuestionBankData }>('/api/question-banks', { action: 'variants', courseId, bankId: bank.id, questionId: base.id, count: 5, confirmed: true });
      setBanks(items => items.map(item => item.id === result.bank.id ? result.bank : item));
      setFreshIds(result.bank.questions.filter(question => question.origin === 'variant' && question.id.startsWith(`${base.id}:variant:`) && !previous.has(question.id)).map(question => question.id));
      setConsent(false);
    } catch (e) { setActionError(e instanceof Error ? e.message : '生成失败，已有题目保留，请重试。'); } finally { setBusy(false); }
  }
  async function start() {
    if (!canStart) return;
    setBusy(true); setActionError('');
    try { await checkExam(); const result = await originalRequest({ action: 'original-load', courseId, context: 'knowledge', questionIds: variants.map(question => question.id), mode: 'practice', newRound: true }); await onOpen({ section, activity: 'practice', scope: result.scope, variant: true, ...(section === 'mistakes' ? { materialId, fromFile: true } : {}) }); }
    catch (e) { setActionError(e instanceof Error ? e.message : '练习启动失败，请重试。'); } finally { setBusy(false); }
  }
  return <div className="hub-function-surface hub-variant-workspace">
    <div className="hub-activity-intro"><Sparkles size={24}/><div><h2>{section === 'mistakes' ? '错题同类题加练' : '同类题加练'}</h2><p>{section === 'mistakes' ? '选择一份资料中的原始错题，围绕这道题生成最多 5 道同类题。' : '选一道原题，让 AI 围绕相同知识点生成最多 5 道新题，检验你是否会做同类题。'}</p></div></div>
    <ol className="hub-variant-steps" aria-label="同类题加练流程"><li><span>1</span>选择一道原题</li><li><span>2</span>生成同类题</li><li><span>3</span>开始练习</li></ol>
    {(bankError || summary.error || actionError && !consent) && <div role="alert" className="hub-variant-notice"><p>{bankError || summary.error || actionError}</p><Button size="sm" onClick={refresh} disabled={busy}>刷新重试</Button></div>}
    {!eligible.length ? <HubEmpty icon="papers" title="先准备一份原卷" text="导入试卷，读取完整原题后，就能选择其中一道题生成同类题。" action="导入试卷" onClick={onUpload}/> : <>
      <div className="hub-variant-selectors"><label>{section === 'mistakes' ? '错题资料' : '试卷'}<select aria-label={section === 'mistakes' ? '同类题错题资料' : '同类题试卷'} value={materialId} disabled={busy || loading} onChange={e => select(e.target.value)}>{!selectedMaterial && <option value={materialId}>所选资料暂不可用</option>}{eligible.map(material => <option value={material.id} key={material.id}>{material.name}</option>)}</select></label><label>{section === 'mistakes' ? '原始错题' : '原题'}<select aria-label="选择原题" value={base?.id ?? ''} disabled={busy || loading || !originals.length || bank?.stale} onChange={e => select(materialId, e.target.value)}><option value="">请选择一道原题</option>{originals.map(question => <option value={question.id} key={question.id}>第 {question.number} 题 · {originalKindNames[question.kind]} · {question.prompt.replace(/\s+/g, ' ').slice(0, 55)}</option>)}</select></label></div>
      {loading ? <p role="status" className="hub-small-copy">正在读取原题与考试状态…</p> : <>
        {unavailable && <p role="status" className="hub-variant-notice">{unavailable}</p>}
        <div className="hub-variant-actions"><Button variant="primary" disabled={!canGenerate} onClick={() => { setActionError(''); setConsent(true); }}><Sparkles size={16}/>生成最多 5 道同类题</Button>{selectedMaterial && (!bank || bank.stale || !originals.length) && <Button disabled={busy || !protectionKnown || protectedMaterial} onClick={() => void readPaper()}>{busy && <LoaderCircle size={15} className="spin"/>}{bank?.stale ? '重新读取试卷' : '读取试卷'}</Button>}{selectedMaterial && !protectedMaterial && <Button variant="ghost" disabled={busy || !protectionKnown} onClick={() => onOpen({ section, activity: section === 'mistakes' ? 'sources' : 'analysis', materialId, question: base?.id })}>核对原题与答案<ArrowRight size={15}/></Button>}</div>
        {base && !bank?.stale && <section className="hub-variant-base"><div className="hub-variant-question-heading"><h3>原题 · 第 {base.number} 题</h3><span>{originalKindNames[base.kind]}</span></div><QuestionPreview question={base}/><p className="hub-question-source"><FileText size={14}/>{selectedMaterial?.name}</p>{protectionKnown && !protectedMaterial && base.answer.trim() && <details className="hub-variant-reference"><summary>核对参考答案与生成依据</summary><small>{({ original: '原文答案', supplement: '补充答案', manual: '我的修订', ai: 'AI 参考答案', none: '待核对' })[base.answerSource]}</small><Markdown text={base.answer}/><Markdown text={base.explanation}/></details>}</section>}
        {variants.length > 0 && protectionKnown && !protectedMaterial && !bank?.stale && <section className="hub-variant-results"><div className="hub-variant-result-heading"><div><h3 ref={resultHeading} role="status">{freshIds === null ? '最近生成的同类题' : '本次生成的同类题'} · {variants.length} 道</h3><p>AI 自编 · 答题后查看参考答案与解析</p></div><Button variant="primary" disabled={!canStart} onClick={() => void start()}>{busy ? <LoaderCircle size={15} className="spin"/> : <Play size={15}/>}开始 {variants.length} 道同类题</Button></div><div className="hub-variant-question-list">{variants.map((question, i) => <article key={question.id}><div className="hub-variant-question-heading"><h4>同类题 {i + 1}</h4><span>AI 自编</span></div><QuestionPreview question={question}/></article>)}</div></section>}
      </>}
    </>}
    <Modal open={consent} onOpenChange={open => { if (!busy) setConsent(open); }} title="生成同类题" description="将所选原题、共同材料、选项、参考答案与解析发送给 AI 助手，会产生 API 费用。" error={actionError}><p>以第 {base?.number} 题为依据，生成最多 5 道 AI 自编同类题。生成内容需要核对。</p><div className="modal-footer"><Button disabled={busy} onClick={() => setConsent(false)}>取消</Button><Button variant="primary" disabled={!canGenerate} onClick={() => void generate()}>{busy && <LoaderCircle size={15} className="spin"/>}同意发送并生成</Button></div></Modal>
  </div>;
}
