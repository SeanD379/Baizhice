'use client';
import { useRef, useState } from 'react';
import { CaptureButton } from './notebook-context';
import type { Material } from '@/lib/types';
import { sourceLocation } from '@/lib/document-labels';

export function MaterialNote({ material, page, text }: { material: Material; page: number; text: string }) {
  const element = useRef<HTMLPreElement>(null), [selection, setSelection] = useState('');
  return <><pre ref={element} className="extraction-text" onMouseUp={() => {
    const selected = window.getSelection();
    setSelection(selected?.anchorNode && selected.focusNode && element.current?.contains(selected.anchorNode) && element.current.contains(selected.focusNode) ? selected.toString().trim() : '');
  }}>{text || '此页未提取出文字，请查看原文。'}</pre>{text && <CaptureButton title={`${material.name} · ${sourceLocation(material.name, page)}`} body={selection || text} origin={{ kind: 'material', label: selection ? '资料摘录' : '资料原页', refs: [{ materialId: material.id, name: material.name, page, snippet: (selection || text).slice(0, 1000) }], needsReview: true }}/>}</>;
}
