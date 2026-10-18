'use client';
import { useRef, useState } from 'react';
import { insertAnswerFormat, type AnswerFormat } from '@/lib/rich-answer';
import { Markdown } from './markdown';

export function RichAnswerEditor({ id, value, onChange, disabled }: { id: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState('');
  function insert(format: AnswerFormat) {
    const el = input.current;
    if (!el || disabled) return;
    const change = insertAnswerFormat(value, el.selectionStart, el.selectionEnd, format);
    if (!change) { setMessage('已达到 8000 字符上限，请删减后再插入。'); return; }
    setMessage('');
    onChange(change.value);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(change.start, change.end); });
  }
  return <div className="rich-answer-editor">
    <p id={`${id}-help`}>选中文字后添加格式，或在光标处插入。公式使用 LaTeX；答案仍以 Markdown 文本自动保存。</p>
    <div className="answer-toolbar" role="group" aria-label="答案格式">
      {([['paragraph', '段落'], ['list', '列表'], ['bold', '加粗'], ['formula', '公式']] as const).map(([format, label]) => <button key={format} type="button" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => insert(format)}>{label}</button>)}
    </div>
    <textarea ref={input} id={id} aria-describedby={`${id}-help ${id}-count`} value={value} maxLength={8000} disabled={disabled} placeholder="先写出已知条件，再写比较过程和结论…" onChange={e => { setMessage(''); onChange(e.target.value); }}/>
    <small id={`${id}-count`}>{value.length} / 8000 字符</small>
    <p role="status">{message}</p>
    <details><summary>预览排版与公式</summary>{value ? <Markdown text={value}/> : <p>写下答案后，在这里预览。</p>}</details>
  </div>;
}
