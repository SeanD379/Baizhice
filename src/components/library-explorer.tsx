'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, GripVertical, Image as ImageIcon, ListChecks, MoreHorizontal, PencilLine, Plus, Search, SlidersHorizontal, Trash2, Upload } from 'lucide-react';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { documentLabel, supportedFormats } from '@/lib/document-labels';
import type { Folder as MaterialFolder, Material } from '@/lib/types';
import { defaultLibraryFilters, filterLibraryMaterials, localDay, moveConfirmationDateKey, type LibraryFilters } from '@/lib/library-filters';
import { LibraryFilterPanel } from './library-filter-panel';
import { useLibraryDrag } from './library-drag';
import { LibrarySplitter,useLibrarySplit } from './library-splitter';

type Props = {
  courseId: string;
  materials: Material[];
  folders: MaterialFolder[];
  mathDemo: boolean;
  onOpen: (material: Material) => void;
  onDelete: (material: Material) => void;
  onUpload: () => void;
  onSamples: () => void;
  onReload: () => Promise<unknown>;
  onMoved: (materials: Material[]) => void;
  onToast: (message: string) => void;
  status: (material: Material) => string;
  masterDetail?: boolean;
  selectedMaterialId?: string;
  onClearSelection?: () => void;
};

type FolderEntry = { folder: MaterialFolder; parents: MaterialFolder[]; path: string };

const sizeLabel = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

async function requestJson<T>(method: string, url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '操作失败，请重试。');
  return result;
}

export function LibraryExplorer({ courseId, materials, folders, mathDemo, onOpen, onDelete, onUpload, onSamples, onReload, onMoved, onToast, status, masterDetail = false, selectedMaterialId, onClearSelection }: Props) {
  const [folderId, setFolderId] = useState('all');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [folderDialog, setFolderDialog] = useState<{ kind: 'create' | 'create-child' | 'rename' | 'delete'; folder?: MaterialFolder } | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);
  const [folderName, setFolderName] = useState('');
  const [moveMaterials, setMoveMaterials] = useState<Material[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFromDrag, setMoveFromDrag] = useState(false);
  const [skipToday, setSkipToday] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const split=useLibrarySplit(courseId);
  const [settings, setSettings] = useState(defaultLibraryFilters);
  const scope = useRef<HTMLDivElement>(null), selectAll = useRef<HTMLInputElement>(null);
  const alive = useRef(true), submitting = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const courseFolders = folders.filter(folder => folder.courseId === courseId);
  function folderBranch(parentId: string | null = null, parents: MaterialFolder[] = []): FolderEntry[] {
    return courseFolders.filter(folder => (folder.parentId ?? null) === parentId).flatMap(folder => [
      { folder, parents, path: [...parents, folder].map(item => item.name).join(' / ') },
      ...folderBranch(folder.id, [...parents, folder]),
    ]);
  }
  const folderEntries = folderBranch();
  const shownFolders = folderEntries.filter(entry => entry.parents.every(parent => !collapsedFolders.includes(parent.id)));
  const childFolders = courseFolders.filter(folder => folder.parentId === folderId);
  const scoped = materials.filter(material => folderId === 'all' || (folderId === 'uncategorized' ? !material.folderId : material.folderId === folderId));
  const counts = {
    all: scoped.length,
    ready: scoped.filter(material => (material.status === 'ready' || material.status === 'extracted') && !material.excluded).length,
    review: scoped.filter(material => material.status === 'review' && !material.excluded && !material.conflictResolution).length,
    paused: scoped.filter(material => material.conflictResolution === 'paused').length,
    excluded: scoped.filter(material => material.excluded).length,
  };
  const visible = filterLibraryMaterials(scoped.filter(material => material.name.toLowerCase().includes(query.trim().toLowerCase()) && (
    filter === 'all' || filter === 'ready' && (material.status === 'ready' || material.status === 'extracted') && !material.excluded ||
    filter === 'review' && material.status === 'review' && !material.excluded && !material.conflictResolution ||
    filter === 'paused' && material.conflictResolution === 'paused' || filter === 'excluded' && material.excluded
  )), settings);
  const visibleIds = visible.map(material => material.id).join('|');
  useEffect(() => {
    if (!masterDetail || visible.some(material => material.id === selectedMaterialId)) return;
    if (visible[0]) onOpen(visible[0]);
    else if (selectedMaterialId) onClearSelection?.();
  }, [masterDetail, selectedMaterialId, visibleIds]);
  const selected = visible.filter(material => selectedIds.includes(material.id));
  const filterCount = Number(!!(settings.minSize || settings.maxSize)) + Number(!!(settings.fromDate || settings.toDate)) + Number(!!settings.types.length);
  const settingsCount = filterCount + Number(settings.sortBy !== 'createdAt' || settings.direction !== 'desc');
  const hasFilters = !!query || filter !== 'all' || filterCount > 0;
  const drag = useLibraryDrag({ scope, visible, selectedIds, disabled: busy || moveOpen || !!folderDialog, onStart: ids => { setSelectedIds(batchMode ? ids : []); setOpenMenu(null); }, onDrop: beginDrop });
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selected.length > 0 && selected.length < visible.length; }, [selected.length, visible.length, batchMode]);
  const activeFolder = courseFolders.find(folder => folder.id === folderId);
  const activeEntry = folderEntries.find(entry => entry.folder.id === folderId);
  const title = activeFolder?.name ?? (folderId === 'uncategorized' ? '未分类' : '全部资料');
  const dialogFolderIds = folderEntries.filter(entry => entry.folder.id === folderDialog?.folder?.id || entry.parents.some(parent => parent.id === folderDialog?.folder?.id)).map(entry => entry.folder.id);
  const dialogCount = materials.filter(material => material.folderId && dialogFolderIds.includes(material.folderId)).length;
  const dialogPath = folderEntries.find(entry => entry.folder.id === folderDialog?.folder?.id)?.path;

  useEffect(() => { setFolderId('all'); setFilter('all'); setQuery(''); setCollapsedFolders([]); setSelectedIds([]); setBatchMode(false); setSettings(defaultLibraryFilters); setSettingsOpen(false); setMoveOpen(false); setMoveMaterials([]); drag.cancel(); }, [courseId]);
  useEffect(() => {
    if (!openMenu) return;
    if (masterDetail) scope.current?.querySelector<HTMLElement>('[role="menu"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('.library-item-more, .library-folder-more')) setOpenMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [openMenu, masterDetail]);

  function openFolderDialog(kind: 'create' | 'create-child' | 'rename' | 'delete', folder?: MaterialFolder) {
    setFolderName(kind === 'rename' ? folder?.name ?? '' : ''); setError(''); setOpenMenu(null); setFolderDialog({ kind, folder });
  }
  async function saveFolder() {
    if (!folderDialog) return;
    const parentId = folderDialog.kind === 'create-child' ? folderDialog.folder!.id : folderDialog.kind === 'rename' ? folderDialog.folder!.parentId : null;
    if (folderDialog.kind !== 'delete' && courseFolders.some(folder => folder.parentId === parentId && folder.name === folderName.trim() && (folderDialog.kind !== 'rename' || folder.id !== folderDialog.folder?.id))) {
      setError('同一层级已有同名文件夹。');
      return;
    }
    setBusy(true); setError('');
    try {
      if (folderDialog.kind === 'delete') {
        await requestJson('DELETE', '/api/folders', { id: folderDialog.folder?.id });
        if (dialogFolderIds.includes(folderId)) setFolderId('uncategorized');
        onToast(dialogCount ? `文件夹已删除，${dialogCount} 份资料已移到“未分类”。` : '文件夹已删除。');
      } else if (folderDialog.kind === 'create' || folderDialog.kind === 'create-child') {
        const created = await requestJson<MaterialFolder>('POST', '/api/folders', { courseId, name: folderName.trim(), parentId });
        const parents = folderEntries.find(entry => entry.folder.id === parentId)?.parents.map(parent => parent.id) ?? [];
        setCollapsedFolders(current => current.filter(id => id !== parentId && !parents.includes(id)));
        setFolderId(created.id); onToast('文件夹已创建。');
      } else {
        await requestJson('PATCH', '/api/folders', { id: folderDialog.folder?.id, name: folderName.trim() });
        onToast('文件夹已重命名。');
      }
      await onReload(); setFolderDialog(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。'); }
    finally { setBusy(false); }
  }
  function beginMove(items: Material[], targetId = '', fromDrag = false) {
    if (busy) return;
    setMoveMaterials(items); setMoveTargetId(targetId); setMoveFromDrag(fromDrag); setSkipToday(false); setError(''); setOpenMenu(null); setMoveOpen(true);
  }
  function beginDrop(items: Material[], targetId: string) {
    beginMove(items, targetId, true);
    try {
      if (window.localStorage.getItem(moveConfirmationDateKey) === localDay()) { setMoveOpen(false); void saveMove(items, targetId, false); }
    } catch { /* Confirmation remains available when browser storage is unavailable. */ }
  }
  function cancelMove() { if (!busy) { setMoveOpen(false); setMoveMaterials([]); drag.cancel(); } }
  async function saveMove(items = moveMaterials, targetId = moveTargetId, remember = moveFromDrag && skipToday) {
    const changed = items.filter(item => (item.folderId ?? '') !== targetId);
    if (!changed.length || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const result = await requestJson<{ materials: Material[] }>('PATCH', '/api/materials', { courseId, materialIds: items.map(item => item.id), folderId: targetId || null });
      if (!alive.current) { onMoved(result.materials); return; }
      setMoveOpen(false);
      if (remember) { try { window.localStorage.setItem(moveConfirmationDateKey, localDay()); } catch { /* Moving still works without browser storage. */ } }
      await drag.finish(targetId);
      onMoved(result.materials);
      if (!alive.current) return;
      setMoveMaterials([]); setSelectedIds([]);
      const message = `已将 ${changed.length} 份资料移到“${folderEntries.find(entry => entry.folder.id === targetId)?.path ?? '未分类'}”。`;
      onToast(message);
      try { await onReload(); } catch { onToast(`${message}工作区刷新失败，可稍后刷新页面。`); }
    } catch (cause) {
      if (alive.current) { drag.cancel(); setMoveOpen(true); setError(cause instanceof Error ? cause.message : '整批移动失败，请重试。'); }
    } finally { submitting.current = false; if (alive.current) setBusy(false); }
  }
  function selectFolder(id: string) { if (busy || moveOpen) return; setFolderId(id); setFilter('all'); setQuery(''); setOpenMenu(null); setSelectedIds([]); }
  function applySettings(next: LibraryFilters) {
    const conditions = (value: LibraryFilters) => JSON.stringify({ minSize: value.minSize, maxSize: value.maxSize, unit: value.unit, fromDate: value.fromDate, toDate: value.toDate, types: [...value.types].sort() });
    if (conditions(next) !== conditions(settings)) setSelectedIds([]);
    setSettings(next);
  }
  function clearFilters() { setQuery(''); setFilter('all'); setSettings(defaultLibraryFilters); setSettingsOpen(false); setSelectedIds([]); }

  const folderRail = <aside className="library-folder-rail" id={masterDetail ? 'library-master-folders' : undefined} aria-label="资料文件夹">
      <div className="library-folder-heading"><strong>文件夹</strong><button type="button" aria-label="新建文件夹" title="新建文件夹" onClick={() => openFolderDialog('create')}><Plus size={17}/></button></div>
      <nav className="library-folder-list" aria-label="选择资料文件夹">
        <button type="button" className={`library-folder-item ${folderId === 'all' ? 'selected' : ''}`} aria-current={folderId === 'all' ? 'page' : undefined} onClick={() => selectFolder('all')}><FolderOpen size={17}/><span>全部资料</span><small>{materials.length}</small></button>
        <button type="button" data-drop-folder="" data-drop-name="未分类" className={`library-folder-item ${folderId === 'uncategorized' ? 'selected' : ''}`} aria-current={folderId === 'uncategorized' ? 'page' : undefined} onClick={() => selectFolder('uncategorized')}><Folder size={17}/><span>未分类</span><small>{materials.filter(material => !material.folderId).length}</small></button>
        {shownFolders.map(({ folder, parents, path }) => <div className={`library-folder-row ${openMenu === folder.id ? 'menu-open' : ''}`} style={{ '--folder-depth': parents.length } as CSSProperties} key={folder.id}>
          {courseFolders.some(child => child.parentId === folder.id) && <button type="button" className="library-folder-toggle" aria-label={`${collapsedFolders.includes(folder.id) ? '展开' : '收起'}${path}`} aria-expanded={!collapsedFolders.includes(folder.id)} onClick={() => { setOpenMenu(null); setCollapsedFolders(current => current.includes(folder.id) ? current.filter(id => id !== folder.id) : [...current, folder.id]); }}><ChevronRight size={14}/></button>}
          <button type="button" data-drop-folder={folder.id} data-drop-name={path} className={`library-folder-item ${folderId === folder.id ? 'selected' : ''}`} aria-current={folderId === folder.id ? 'page' : undefined} onClick={() => selectFolder(folder.id)}><Folder size={17}/><span title={path}>{folder.name}</span><small>{materials.filter(material => material.folderId === folder.id).length}</small></button>
          <div className="library-folder-more"><button type="button" aria-label={`${path}的更多操作`} aria-haspopup="menu" aria-expanded={openMenu === folder.id} onClick={() => setOpenMenu(current => current === folder.id ? null : folder.id)}><MoreHorizontal size={17}/></button>{openMenu === folder.id && <div className="library-folder-menu" role="menu"><button type="button" role="menuitem" onClick={() => openFolderDialog('create-child', folder)}><Plus size={14}/>新建子文件夹</button><button type="button" role="menuitem" onClick={() => openFolderDialog('rename', folder)}><PencilLine size={14}/>重命名</button><button type="button" role="menuitem" onClick={() => openFolderDialog('delete', folder)}><Trash2 size={14}/>删除文件夹</button></div>}</div>
        </div>)}
      </nav>
      {!masterDetail && <div className="library-folder-footer"><Button variant="primary" disabled={busy} onClick={onUpload}><Upload size={17}/>上传资料</Button></div>}
    </aside>;

  return <div ref={scope} className={`library-explorer ${masterDetail ? 'library-master-list library-split-list' : ''} ${busy ? 'library-moving' : ''} ${batchMode ? 'library-batch-mode' : ''}`} aria-busy={busy} data-folder-collapsed={masterDetail&&split.share===0?'true':undefined} data-files-collapsed={masterDetail&&split.share===1?'true':undefined} style={masterDetail?{gridTemplateRows:`${split.share===0?'32px':`minmax(0, ${split.share}fr)`} 12px ${split.share===1?'48px':`minmax(0, ${1-split.share}fr)`} auto`}:undefined}>
    {folderRail}
    {masterDetail&&<LibrarySplitter scope={scope} share={split.share} onResize={split.resize} onRestore={split.restore}/>}
    <section className="library-files" aria-label={`${title}中的资料`}>
      {masterDetail ? <>
        <header className="library-master-heading"><h2>{folderId === 'all' ? '文件' : title}<span>{scoped.length}</span></h2><div className="library-master-tools"><Button size="icon" disabled={busy} aria-label="筛选与排序" title="筛选与排序" aria-expanded={settingsOpen} aria-controls="library-filter-settings" className={settingsCount ? 'library-settings-active' : ''} onClick={() => { setSettingsOpen(current => !current); setOpenMenu(null); }}><SlidersHorizontal size={18}/>{settingsCount > 0 && <small>{settingsCount}</small>}</Button><Button size="icon" disabled={busy || moveOpen} aria-label="资料文件夹" title="收起或恢复文件夹" aria-expanded={split.share>0} aria-controls="library-master-folders" onClick={() => {if(split.share===0)split.restore();else split.resize(0);setOpenMenu(null);}}><Folder size={18}/></Button></div></header>
        <label className="search-box library-master-search"><Search size={18}/><input value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setSelectedIds([]); }} placeholder={folderId === 'all' ? '搜索资料' : '搜索当前文件夹'} aria-label="搜索当前文件夹"/></label>
      </> : <header className="library-files-heading"><div><span>{activeEntry?.parents.length ? activeEntry.path : '当前文件夹'}</span><h2>{title}</h2><p>{hasFilters ? `筛选后 ${visible.length} / ${scoped.length} 份资料` : `${scoped.length} 份资料`}{childFolders.length ? ` · ${childFolders.length} 个子文件夹` : ''}</p></div><div className="library-heading-tools"><label className="search-box"><Search size={16}/><input value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setSelectedIds([]); }} placeholder="搜索当前文件夹" aria-label="搜索当前文件夹"/></label><Button disabled={busy} aria-expanded={settingsOpen} aria-controls="library-filter-settings" className={settingsCount ? 'library-settings-active' : ''} onClick={() => setSettingsOpen(current => !current)}><SlidersHorizontal size={15}/>筛选与排序{settingsCount > 0 && <small>{settingsCount}</small>}</Button><Button disabled={busy || moveOpen} aria-pressed={batchMode} onClick={() => { setBatchMode(current => !current); setSelectedIds([]); setOpenMenu(null); }}><ListChecks size={15}/>{batchMode ? '退出批量管理' : '批量管理'}</Button></div></header>}
      {settingsOpen && <LibraryFilterPanel value={settings} onApply={applySettings}/>}
      {!!childFolders.length && <div className="library-subfolders" aria-label="子文件夹">{childFolders.map(folder => <button type="button" key={folder.id} data-drop-folder={folder.id} data-drop-name={folderEntries.find(entry => entry.folder.id === folder.id)?.path} onClick={() => selectFolder(folder.id)}><Folder size={20}/><span>{folder.name}<small>{materials.filter(material => material.folderId === folder.id).length} 份资料</small></span><ChevronRight size={16}/></button>)}</div>}
      <div className={`filter-tabs ${selected.length ? 'library-tabs-with-selection' : ''}`} aria-hidden={!!selected.length} role="group" aria-label="资料状态筛选">{([['all','全部',counts.all],['ready',mathDemo ? '演示可用' : '可阅读',counts.ready],['review','待确认',counts.review],['paused','冲突暂停',counts.paused],['excluded','已排除',counts.excluded]] as const).map(([value,label,count]) => <button type="button" key={value} disabled={busy} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={() => { setFilter(value); setSelectedIds([]); }}>{label}<span>{count}</span></button>)}</div>
      {!!selected.length && <div className="library-selection-bar"><span aria-live="polite">已选 <b>{selected.length}</b> 份</span><Button disabled={busy} onClick={() => beginMove(selected)}>移动到…</Button><Button variant="ghost" disabled={busy} onClick={() => setSelectedIds([])}>取消选择</Button></div>}
      {!materials.length && !activeFolder ? <div className="library-empty"><FolderOpen size={30}/><h3>这里还没有资料</h3><p>上传讲义、笔记或套卷后，就能放进你创建的文件夹。支持 {supportedFormats}。</p><div><Button onClick={onUpload}><Upload size={16}/>上传第一份资料</Button><Button variant="ghost" onClick={onSamples}>{mathDemo ? '使用中文演示资料' : '导入高考真题'}</Button></div></div> : !visible.length ? <div className="library-empty"><Search size={27}/><h3>{hasFilters ? '没有符合条件的资料' : childFolders.length ? '这里还没有直接存放的资料' : '这个文件夹还是空的'}</h3><p>{hasFilters ? '试试清除搜索、状态或范围筛选。' : '可以从其他文件夹中移动资料到这里。'}</p><Button variant="ghost" onClick={() => hasFilters ? clearFilters() : selectFolder('all')}>{hasFilters ? '清除筛选' : '查看全部资料'}</Button></div> : <div className="material-list">{masterDetail ? batchMode && <label className="library-master-select-all"><input ref={selectAll} className="library-checkbox" type="checkbox" aria-label="全选当前筛选结果" checked={selected.length === visible.length} disabled={busy} onChange={event => setSelectedIds(event.target.checked ? visible.map(item => item.id) : [])}/>全选当前结果</label> : <div className="material-head"><span className="library-material-leading">{batchMode && <input ref={selectAll} className="library-checkbox" type="checkbox" aria-label="全选当前筛选结果" checked={selected.length === visible.length} disabled={busy} onChange={event => setSelectedIds(event.target.checked ? visible.map(item => item.id) : [])}/>}<span>资料名称</span></span><span className="column-chapter">章节归属</span><span className="column-status">状态</span><span>操作</span></div>}{visible.map(material => <div className={`material-row ${masterDetail ? 'library-master-row' : ''} ${masterDetail && selectedMaterialId === material.id ? 'library-row-current' : ''} ${openMenu === material.id ? 'menu-open' : ''} ${selectedIds.includes(material.id) ? 'library-row-selected' : ''} ${drag.draggingIds.includes(material.id) ? 'library-row-dragging' : ''}`} key={material.id}>
        <div className="library-material-leading">{batchMode && <input className="library-checkbox" type="checkbox" aria-label={`选择${material.name}`} disabled={busy} checked={selectedIds.includes(material.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, material.id] : current.filter(id => id !== material.id))}/>}<button type="button" className="library-drag-handle" data-material-drag={material.id} aria-label={`拖动${material.name}`} title="拖动到文件夹" disabled={busy || moveOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); beginMove(selectedIds.includes(material.id) ? selected : [material], material.folderId ?? ''); } }}><GripVertical size={15}/></button><button className={`material-name ${masterDetail ? 'library-master-name' : ''}`} disabled={busy} aria-current={masterDetail && selectedMaterialId === material.id ? 'page' : undefined} onClick={() => onOpen(material)}>{masterDetail ? <span className="library-master-row-content"><span className="library-master-row-meta"><span>{material.chapter || documentLabel(material.mime)}</span><time dateTime={material.createdAt}>{dateLabel(material.createdAt)}</time></span><b>{material.name}</b><small className="library-master-row-summary">{documentLabel(material.mime)} · {sizeLabel(material.size)} · {material.origin.startsWith('高考真题') ? '高考真题' : material.fixture ? '自编中文演示资料' : '本机上传'}</small><em className="library-master-row-status">{status(material)}</em></span> : <><span className={`file-icon ${material.status === 'review' ? 'file-note' : ''}`}>{material.mime.startsWith('image/') ? <ImageIcon size={23}/> : <FileText size={23}/>}<small>{documentLabel(material.mime)}</small></span><span><b>{material.name}</b><small>{sizeLabel(material.size)}<i/>{material.origin.startsWith('高考真题') ? '高考真题' : material.fixture ? '自编中文演示资料' : '本机上传'}<i/>{dateLabel(material.createdAt)}</small><em className="mobile-status">{status(material)}</em></span></>}</button></div>
        {!masterDetail && <><span className="column-chapter chapter-label">{material.chapter}</span><span className={`status-badge column-status ${material.conflictResolution === 'paused' || material.status === 'review' ? 'status-warning' : material.conflictResolution === 'accepted_reference' || material.status === 'ready' ? 'status-ready' : 'status-muted'}`}><span/>{status(material)}</span></>}
        <div className="row-actions"><div className="material-more library-item-more"><Button disabled={busy} size="icon" variant="ghost" aria-label={`${material.name}的更多操作`} aria-haspopup="menu" aria-expanded={openMenu === material.id} onClick={() => setOpenMenu(current => current === material.id ? null : material.id)}><MoreHorizontal size={18}/></Button>{openMenu === material.id && <div className="material-more-menu" role="menu"><button type="button" role="menuitem" onClick={() => beginMove([material], material.folderId ?? '')}><Folder size={15}/>移动到文件夹</button><button type="button" role="menuitem" onClick={() => { setOpenMenu(null); onDelete(material); }}><Trash2 size={15}/>删除资料</button></div>}</div></div></div>)}</div>}
    </section>
    {masterDetail && <footer className="library-master-footer"><Button variant="primary" disabled={busy} onClick={onUpload}><Upload size={17}/>上传资料</Button><Button variant="ghost" disabled={busy || moveOpen} aria-pressed={batchMode} onClick={() => { setBatchMode(current => !current); setSelectedIds([]); setOpenMenu(null); }}><ListChecks size={15}/>{batchMode ? '退出批量管理' : '批量管理'}</Button></footer>}
    <Modal error={error} open={!!folderDialog} onOpenChange={value => { if (!value && !busy) setFolderDialog(null); }} title={folderDialog?.kind === 'create' ? '新建文件夹' : folderDialog?.kind === 'create-child' ? '新建子文件夹' : folderDialog?.kind === 'rename' ? '重命名文件夹' : '删除文件夹'} description={folderDialog?.kind === 'delete' ? '资料会移到“未分类”，不会删除原文件。' : folderDialog?.kind === 'create-child' ? `创建到“${dialogPath}”中。` : '用文件夹整理当前课程的资料。'}>
      {folderDialog?.kind === 'delete' ? <><p className="muted">确定删除“{dialogPath}”吗？{dialogFolderIds.length > 1 ? `其中的 ${dialogFolderIds.length - 1} 个子文件夹也会删除。` : ''}{dialogCount} 份资料会回到“未分类”。</p><div className="modal-footer"><Button onClick={() => setFolderDialog(null)} disabled={busy}>取消</Button><Button variant="danger" onClick={() => void saveFolder()} disabled={busy}>删除文件夹</Button></div></> : folderDialog && <form onSubmit={event => { event.preventDefault(); void saveFolder(); }}><label className="form-field">文件夹名称<input autoFocus value={folderName} onChange={event => setFolderName(event.target.value)} maxLength={60} required placeholder="例如：古诗文"/></label><div className="modal-footer"><Button onClick={() => setFolderDialog(null)} disabled={busy}>取消</Button><Button type="submit" variant="primary" disabled={busy || !folderName.trim()}>保存</Button></div></form>}
    </Modal>
    <Modal error={error} open={moveOpen} onOpenChange={value => { if (!value) cancelMove(); }} title={moveMaterials.length > 1 ? '批量移动资料' : '移动资料'} description={`移动 ${moveMaterials.length} 份资料${moveMaterials.length === 1 ? `「${moveMaterials[0]?.name ?? ''}」` : ''}。章节归属和复习记录不会改变。`}>
      <form onSubmit={event => { event.preventDefault(); void saveMove(); }}><label className="form-field">目标文件夹<select aria-label="目标文件夹" disabled={busy} value={moveTargetId} onChange={event => setMoveTargetId(event.target.value)}><option value="">未分类</option>{folderEntries.map(({ folder, path }) => <option key={folder.id} value={folder.id}>{path}</option>)}</select></label><p className="library-move-summary">将 {moveMaterials.filter(item => (item.folderId ?? '') !== moveTargetId).length} 份资料移到「{folderEntries.find(entry => entry.folder.id === moveTargetId)?.path ?? '未分类'}」；整批一起成功。</p>{moveFromDrag && <label className="library-skip-confirm"><input type="checkbox" disabled={busy} checked={skipToday} onChange={event => setSkipToday(event.target.checked)}/>今日不再提示</label>}<div className="modal-footer"><Button onClick={cancelMove} disabled={busy}>取消</Button><Button type="submit" variant="primary" disabled={busy || !moveMaterials.some(item => (item.folderId ?? '') !== moveTargetId)}>{busy ? '正在移动…' : '确认移动'}</Button></div></form>
    </Modal>
    {drag.overlay}
  </div>;
}
