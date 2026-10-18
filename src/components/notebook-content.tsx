'use client';
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import katex from 'katex';
import { ArrowUpRight, CheckCheck, ChevronDown, FileText } from 'lucide-react';
import { notebookListStyle, notebookOriginLabel, referenceOriginLabel, type NotebookOrigin, type RichNode } from '@/lib/notebook';
import type { Reference } from '@/lib/types';
import { referenceLocation } from '@/lib/document-labels';
import { localImageBlob } from './notebook-local-assets';

function NotebookImage({ src, alt }: { src: string; alt: string }) {
  const [local, setLocal] = useState('');
  useEffect(() => {
    if (!src.startsWith('notebook-local:')) return;
    let cancelled = false, url = '';
    void localImageBlob(src).then(blob => { if (!cancelled && blob) { url = URL.createObjectURL(blob); setLocal(url); } }).catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [src]);
  return <img src={src.startsWith('notebook-local:') ? local || undefined : src} alt={alt}/>;
}

function inline(node: RichNode): ReactNode {
  let result: ReactNode = node.text ?? '';
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') result = <strong>{result}</strong>;
    if (mark.type === 'italic') result = <em>{result}</em>;
    if (mark.type === 'strike') result = <s>{result}</s>;
    if (mark.type === 'code') result = <code>{result}</code>;
    if (mark.type === 'underline') result = <u>{result}</u>;
    if (mark.type === 'link') { const href = String(mark.attrs?.href ?? ''); if (/^(https?:\/\/|mailto:|\/api\/)/i.test(href)) result = <a href={href} target="_blank" rel="noreferrer">{result}</a>; }
  }
  return result;
}
export function SourceNote({ origin, onReference, onConfirm }: { origin: NotebookOrigin; onReference?: (reference: Reference) => void; onConfirm?: () => void }) {
  const groups = new Map<string, { name: string; refs: Reference[] }>();
  for (const reference of origin.refs ?? []) { const group = groups.get(reference.materialId) ?? { name: reference.name, refs: [] }; group.refs.push(reference); groups.set(reference.materialId, group); }
  const sourceName = groups.size === 1 ? [...groups.values()][0].name : `${groups.size} 份资料`;
  return <footer className="loose-source"><span>{notebookOriginLabel(origin)}{origin.needsReview && ' · 待核对'}</span>{!!groups.size && <details className="loose-source-refs"><summary title={referenceOriginLabel(origin.generation)}><FileText size={12}/><span>{sourceName}</span><small>{origin.refs.length} 处出处</small><ChevronDown size={12}/></summary><div className="loose-source-list">{origin.generation?.contentOrigin === 'ai-supplement' && <p>{referenceOriginLabel(origin.generation)}</p>}{[...groups.entries()].map(([id, group]) => <div key={id}><strong>{group.name}</strong><div>{group.refs.map((reference, index) => <button key={index} type="button" onClick={() => onReference?.(reference)} title={reference.snippet} aria-label={`查看 ${reference.name} · ${referenceLocation(reference)}`}>{referenceLocation(reference)}<ArrowUpRight size={11}/></button>)}</div></div>)}</div></details>}{origin.exam && <a href={`/?course=${encodeURIComponent(origin.courseId ?? 'high-school-chinese')}&view=practice&section=papers&paper=${encodeURIComponent(origin.exam.materialId)}&question=${origin.exam.question}`} target="_blank" rel="noreferrer">回到原题<ArrowUpRight size={11}/></a>}{origin.kind === 'chat' && origin.conversationId && <a href={`/?course=${encodeURIComponent(origin.courseId ?? 'high-school-chinese')}&view=home&chat=${encodeURIComponent(origin.conversationId)}`} target="_blank" rel="noreferrer">回到对话<ArrowUpRight size={11}/></a>}{onConfirm && origin.needsReview && !!origin.refs?.length && <button type="button" onClick={onConfirm}><CheckCheck size={13}/>我已核对</button>}</footer>;
}
export function NotebookContent({ node, onReference, onConfirm }: { node: RichNode; onReference?: (reference: Reference) => void; onConfirm?: (id: string, origin: NotebookOrigin) => void }): ReactNode {
  const content = node.content?.map((child, index) => <Fragment key={index}><NotebookContent node={child} onReference={onReference} onConfirm={onConfirm}/></Fragment>);
  if (node.type === 'text') return inline(node);
  if (node.type === 'inlineMath' || node.type === 'blockMath') {
    const html = katex.renderToString(String(node.attrs?.latex ?? ''), { displayMode: node.type === 'blockMath', throwOnError: false, trust: false, strict: 'ignore' });
    return node.type === 'blockMath' ? <div className="notebook-formula" dangerouslySetInnerHTML={{ __html: html }}/> : <span dangerouslySetInnerHTML={{ __html: html }}/>;
  }
  if (node.type === 'paragraph') return <p>{content?.length ? content : <br/>}</p>;
  if (node.type === 'table') { const columns = (node.content?.[0]?.content ?? []).reduce((count, cell) => count + (Number(cell.attrs?.colspan) || 1), 0); return <div className="notebook-table-scroll"><table style={{ minWidth: columns * 100 }}><tbody>{content}</tbody></table></div>; }
  if (node.type === 'tableRow') return <tr>{content}</tr>;
  if (node.type === 'tableCell' || node.type === 'tableHeader') { const align = node.attrs?.align; const style: CSSProperties = { textAlign: align === 'left' || align === 'center' || align === 'right' ? align : undefined }; const attrs = { colSpan: Number(node.attrs?.colspan) || 1, rowSpan: Number(node.attrs?.rowspan) || 1, style }; return node.type === 'tableHeader' ? <th {...attrs}>{content}</th> : <td {...attrs}>{content}</td>; }
  if (node.type === 'heading') { const level = Number(node.attrs?.level ?? 2); if (level === 1) return <h2 data-heading-level="1">{content}</h2>; if (level === 2) return <h3 data-heading-level="2">{content}</h3>; return <h4 data-heading-level="3">{content}</h4>; }
  if (node.type === 'bulletList') return <ul style={{ listStyleType: notebookListStyle(node) }}>{content}</ul>;
  if (node.type === 'orderedList') return <ol start={Number(node.attrs?.start ?? 1)} style={{ listStyleType: notebookListStyle(node) }}>{content}</ol>;
  if (node.type === 'listItem') return <li>{content}</li>;
  if (node.type === 'blockquote') return <blockquote>{content}</blockquote>;
  if (node.type === 'codeBlock') return <pre><code>{content}</code></pre>;
  if (node.type === 'hardBreak') return <br/>;
  if (node.type === 'horizontalRule') return <hr/>;
  if (node.type === 'image') { const src = String(node.attrs?.src ?? ''); return /^(\/api\/notebook-assets\/[a-f0-9-]+\.(png|jpg|webp)|notebook-local:[a-f0-9-]+)$/.test(src) ? <NotebookImage src={src} alt={String(node.attrs?.alt ?? '笔记图片')}/> : <p>原内容包含图片，请重新添加图片以便保存。</p>; }
  if (node.type === 'sourceBlock') { const origin = node.attrs?.origin as NotebookOrigin | undefined; return <section className="loose-source-block">{content}{origin && <SourceNote origin={origin} onReference={onReference} onConfirm={onConfirm ? () => onConfirm(String(node.attrs?.id), origin) : undefined}/>}</section>; }
  return <>{content}</>;
}
