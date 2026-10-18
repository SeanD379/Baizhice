'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { defaultLibraryFilters, validateLibraryFilters, type LibraryFilters } from '@/lib/library-filters';

export function LibraryFilterPanel({ value, onApply }: { value: LibraryFilters; onApply: (filters: LibraryFilters) => void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  function change(patch: Partial<LibraryFilters>) { setDraft(current => ({ ...current, ...patch })); setError(''); }
  return <form id="library-filter-settings" className="library-filter-panel" aria-label="资料筛选与排序设置" onSubmit={event => {
    event.preventDefault();
    const message = validateLibraryFilters(draft); setError(message);
    if (!message) onApply(draft);
  }}>
    <div className="library-filter-fields">
      <fieldset><legend>文件大小</legend><div className="library-filter-range">
        <input type="number" min="0" step="any" aria-label="最小文件大小" placeholder="最小" value={draft.minSize} onChange={event => change({ minSize: event.target.value })}/><span>至</span>
        <input type="number" min="0" step="any" aria-label="最大文件大小" placeholder="最大" value={draft.maxSize} onChange={event => change({ maxSize: event.target.value })}/>
        <select aria-label="文件大小单位" value={draft.unit} onChange={event => change({ unit: event.target.value as LibraryFilters['unit'] })}><option>KB</option><option>MB</option></select>
      </div></fieldset>
      <fieldset><legend>导入日期</legend><div className="library-filter-range">
        <input type="date" aria-label="导入开始日期" value={draft.fromDate} onChange={event => change({ fromDate: event.target.value })}/><span>至</span>
        <input type="date" aria-label="导入结束日期" value={draft.toDate} onChange={event => change({ toDate: event.target.value })}/>
      </div></fieldset>
      <fieldset><legend>排列顺序</legend><div className="library-filter-range">
        <select aria-label="排序依据" value={draft.sortBy} onChange={event => change({ sortBy: event.target.value as LibraryFilters['sortBy'] })}><option value="createdAt">导入日期</option><option value="size">文件大小</option><option value="name">资料名称</option></select>
        <select aria-label="排序方向" value={draft.direction} onChange={event => change({ direction: event.target.value as LibraryFilters['direction'] })}><option value="desc">降序</option><option value="asc">升序</option></select>
      </div></fieldset>
      <fieldset className="library-filter-types"><legend>文件类型 <small>不选表示不限</small></legend><div>{['PDF', 'Word', 'PPT', '图片', '文字'].map(type => <label key={type}><input type="checkbox" checked={draft.types.includes(type)} onChange={event => change({ types: event.target.checked ? [...draft.types, type] : draft.types.filter(item => item !== type) })}/>{type}</label>)}</div></fieldset>
    </div>
    {error && <p className="library-filter-error" role="alert">{error}</p>}
    <div className="library-filter-footer"><span>仅筛选当前文件夹中的资料</span><Button type="button" variant="ghost" onClick={() => { setDraft(defaultLibraryFilters); setError(''); onApply(defaultLibraryFilters); }}>重置</Button><Button type="submit" variant="primary">应用</Button></div>
  </form>;
}
