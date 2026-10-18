'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CheckCheck, ChevronLeft, ChevronRight, CircleAlert, FileText, List, PanelLeft, PencilLine, Settings2 } from 'lucide-react';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { Markdown } from './markdown';
import { sourceLocation } from '@/lib/document-labels';
import type { Reference, Section, Version } from '@/lib/types';

type FontSize = 'small' | 'standard' | 'large';
type ReadingPreferences = {
  pinnedToc: boolean;
  showChapters: boolean;
  showCitations: boolean;
  pageMotion: boolean;
  fontSize: FontSize;
};
type SectionPage = {
  kind: 'section';
  id: string;
  sectionId: string;
  sectionIndex: number;
  title: string;
  body: string;
  continuation: number;
  isLast: boolean;
  refs: Reference[];
  needsReview?: boolean;
  edited?: boolean;
};
type CoveragePage = { kind: 'coverage'; id: 'coverage' };
export type NotebookPage = SectionPage | CoveragePage;

const preferencesKey = 'lms.outline.reader.preferences';
const defaultPreferences: ReadingPreferences = { pinnedToc: false, showChapters: true, showCitations: true, pageMotion: true, fontSize: 'standard' };

function splitLongBlock(block: string, limit: number) {
  const chunks: string[] = [];
  let remaining = block.trim();
  while (remaining.length > limit) {
    const candidates = [remaining.lastIndexOf('\n', limit), remaining.lastIndexOf('。', limit), remaining.lastIndexOf('；', limit), remaining.lastIndexOf('，', limit), remaining.lastIndexOf(' ', limit)];
    const cut = Math.max(...candidates, Math.floor(limit * .65));
    chunks.push(remaining.slice(0, cut + (remaining[cut] === '。' || remaining[cut] === '；' ? 1 : 0)).trim());
    remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function paginateBody(body: string, limit: number) {
  const rawBlocks = body.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  const blocks = rawBlocks.flatMap(block => block.length > limit ? splitLongBlock(block, limit) : block);
  if (!blocks.length) return [''];
  const pages: string[] = [];
  let current = '';
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (current && candidate.length > limit) {
      pages.push(current);
      current = block;
    } else current = candidate;
  }
  if (current || !pages.length) pages.push(current);
  return pages;
}

export function buildNotebookPages(sections: Section[], drafts: Record<string, string>, limit = 850): NotebookPage[] {
  const pages: NotebookPage[] = [];
  sections.forEach((section, sectionIndex) => {
    const bodies = paginateBody(drafts[section.id] ?? section.body, limit);
    bodies.forEach((body, continuation) => pages.push({
      kind: 'section', id: `${section.id}-${continuation}`, sectionId: section.id, sectionIndex, title: section.title, body, continuation,
      isLast: continuation === bodies.length - 1, refs: section.refs, needsReview: section.needsReview, edited: section.edited,
    }));
  });
  pages.push({ kind: 'coverage', id: 'coverage' });
  return pages;
}

function safePreferences(value: string | null): ReadingPreferences {
  if (!value) return defaultPreferences;
  try {
    const parsed = JSON.parse(value) as Partial<ReadingPreferences>;
    return {
      pinnedToc: typeof parsed.pinnedToc === 'boolean' ? parsed.pinnedToc : defaultPreferences.pinnedToc,
      showChapters: typeof parsed.showChapters === 'boolean' ? parsed.showChapters : defaultPreferences.showChapters,
      showCitations: typeof parsed.showCitations === 'boolean' ? parsed.showCitations : defaultPreferences.showCitations,
      pageMotion: typeof parsed.pageMotion === 'boolean' ? parsed.pageMotion : defaultPreferences.pageMotion,
      fontSize: parsed.fontSize === 'small' || parsed.fontSize === 'large' ? parsed.fontSize : 'standard',
    };
  } catch { return defaultPreferences; }
}

type Props = {
  courseName: string;
  version: Version;
  drafts: Record<string, string>;
  dirty: boolean;
  hasGenerated: boolean;
  editingId: string | null;
  busy: string;
  onEditingChange: (id: string | null) => void;
  onDraftChange: (section: Section, body: string) => void;
  onOpenReference: (reference: Reference) => void;
  onConfirmReferences: (sectionId: string) => void;
};

export function OutlineNotebook({ courseName, version, drafts, dirty, hasGenerated, editingId, busy, onEditingChange, onDraftChange, onOpenReference, onConfirmReferences }: Props) {
  const pages = useMemo(() => buildNotebookPages(version.sections, drafts), [drafts, version.sections]);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [pageIndex, setPageIndex] = useState(0);
  const [compact, setCompact] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const pageKey = `lms.outline.reader.page.${version.courseId}.${version.id}`;
  const pageStep = compact ? 1 : 2;
  const tocPinned = preferences.pinnedToc && !compact;
  const spreadStart = compact ? pageIndex : Math.floor(pageIndex / 2) * 2;
  const visiblePages = pages.slice(spreadStart, spreadStart + pageStep);
  const activePage = pages[spreadStart];
  const activeSection = activePage?.kind === 'section' ? version.sections.find(section => section.id === activePage.sectionId) : version.sections.at(-1);

  useEffect(() => {
    try {
      setPreferences(safePreferences(window.localStorage.getItem(preferencesKey)));
      const savedPage = Number(window.localStorage.getItem(pageKey));
      if (Number.isInteger(savedPage) && savedPage >= 0) setPageIndex(Math.min(savedPage, pages.length - 1));
    } catch { /* Reading remains available without browser storage. */ }
  }, [pageKey, pages.length]);

  useEffect(() => {
    const element = readerRef.current;
    if (!element) return;
    const update = () => setCompact(element.clientWidth < 760);
    update();
    if (!('ResizeObserver' in window)) return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [preferences.pinnedToc]);

  useEffect(() => {
    try { window.localStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch { /* Preferences are optional. */ }
  }, [preferences]);

  useEffect(() => {
    setPageIndex(current => Math.min(current, Math.max(0, pages.length - 1)));
  }, [pages.length]);

  useEffect(() => {
    try { window.localStorage.setItem(pageKey, String(pageIndex)); } catch { /* Reading position is optional. */ }
  }, [pageIndex, pageKey]);

  function goTo(index: number) {
    const bounded = Math.max(0, Math.min(index, pages.length - 1));
    setPageIndex(compact ? bounded : Math.floor(bounded / 2) * 2);
    setJumpOpen(false);
    setTocOpen(false);
  }

  function goToSection(sectionId: string) {
    const index = pages.findIndex(page => page.kind === 'section' && page.sectionId === sectionId);
    if (index >= 0) goTo(index);
  }

  function updatePreference<K extends keyof ReadingPreferences>(key: K, value: ReadingPreferences[K]) {
    setPreferences(current => ({ ...current, [key]: value }));
  }

  function handleReaderKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, button, a')) return;
    if (event.key === 'ArrowRight' && spreadStart + pageStep < pages.length) { event.preventDefault(); goTo(spreadStart + pageStep); }
    if (event.key === 'ArrowLeft' && spreadStart > 0) { event.preventDefault(); goTo(spreadStart - pageStep); }
  }

  const toc = <nav className="notebook-toc" aria-label="提纲目录">
    <div className="notebook-toc-heading"><div><span>复习目录</span><small>{version.sections.length} 个知识点</small></div>{tocPinned && <Button size="icon" variant="ghost" aria-label="取消固定目录" onClick={() => updatePreference('pinnedToc', false)}><PanelLeft size={16}/></Button>}</div>
    {version.sections.map((section, index) => {
      const first = pages.findIndex(page => page.kind === 'section' && page.sectionId === section.id);
      const last = pages.findLastIndex(page => page.kind === 'section' && page.sectionId === section.id);
      const current = activePage?.kind === 'section' && activePage.sectionId === section.id;
      return <button key={section.id} className={current ? 'active' : ''} aria-current={current ? 'location' : undefined} onClick={() => goToSection(section.id)}><span>{String(index + 1).padStart(2, '0')}</span><b>{section.title}</b><small>{first === last ? first + 1 : `${first + 1}–${last + 1}`} 页</small></button>;
    })}
    {!preferences.pinnedToc && <button className="notebook-pin-action" onClick={() => { updatePreference('pinnedToc', true); setTocOpen(false); }}><PanelLeft size={15}/><b>固定到左侧</b></button>}
  </nav>;

  return <section className={`outline-notebook font-${preferences.fontSize} ${preferences.pageMotion ? 'with-page-motion' : ''}`}>
    <header className="notebook-toolbar">
      <div><span>{courseName}</span><h2>{version.title || '期末复习提纲'}</h2><small>版本 {version.number} · {dirty ? '有未保存修改' : '已保存至本机'}</small></div>
      <div className="notebook-tools">
        <Button className={tocOpen || tocPinned ? 'active' : ''} onClick={() => { if (tocPinned) updatePreference('pinnedToc', false); else setTocOpen(value => !value); setSettingsOpen(false); }}><List size={16}/>目录</Button>
        <Button className={settingsOpen ? 'active' : ''} onClick={() => { setSettingsOpen(value => !value); setTocOpen(false); }}><Settings2 size={16}/>阅读设置</Button>
        <Button onClick={() => activeSection && onEditingChange(activeSection.id)} disabled={!activeSection}><PencilLine size={16}/>编辑</Button>
      </div>
    </header>

    {preferences.showChapters && <div className="notebook-chapters" aria-label="章节快捷跳转">{version.sections.map((section, index) => <button key={section.id} className={activePage?.kind === 'section' && activePage.sectionId === section.id ? 'active' : ''} onClick={() => goToSection(section.id)}>{String(index + 1).padStart(2, '0')} {section.title}</button>)}</div>}

    <div className={`notebook-layout ${tocPinned ? 'toc-pinned' : ''}`}>
      {tocPinned && <aside className="notebook-toc-pinned">{toc}</aside>}
      <div className="notebook-reader" ref={readerRef} tabIndex={0} onKeyDown={handleReaderKey} aria-label="复习提纲笔记本，使用左右方向键翻页">
        {!tocPinned && tocOpen && <aside className="notebook-flyout notebook-toc-flyout">{toc}</aside>}
        {settingsOpen && <aside className="notebook-flyout notebook-settings" aria-label="阅读设置">
          <div className="notebook-settings-heading"><b>阅读设置</b><button onClick={() => setSettingsOpen(false)} aria-label="关闭阅读设置">×</button></div>
          <fieldset><legend>目录方式</legend><div className="notebook-segmented"><button className={!preferences.pinnedToc ? 'active' : ''} onClick={() => updatePreference('pinnedToc', false)}>按需抽屉</button><button className={preferences.pinnedToc ? 'active' : ''} onClick={() => { updatePreference('pinnedToc', true); setTocOpen(false); }}>固定左侧</button></div></fieldset>
          <fieldset><legend>页面工具</legend><label><span>章节快捷标签</span><input type="checkbox" checked={preferences.showChapters} onChange={event => updatePreference('showChapters', event.target.checked)}/></label><label><span>来源标记</span><input type="checkbox" checked={preferences.showCitations} onChange={event => updatePreference('showCitations', event.target.checked)}/></label><label><span>翻页动效</span><input type="checkbox" checked={preferences.pageMotion} onChange={event => updatePreference('pageMotion', event.target.checked)}/></label></fieldset>
          <fieldset><legend>字号</legend><div className="notebook-segmented three">{(['small', 'standard', 'large'] as FontSize[]).map(size => <button key={size} className={preferences.fontSize === size ? 'active' : ''} onClick={() => updatePreference('fontSize', size)}>{size === 'small' ? '小' : size === 'standard' ? '标准' : '大'}</button>)}</div></fieldset>
        </aside>}

        <div className={`notebook-spread ${compact ? 'single-page' : ''}`} aria-live="polite">
          {visiblePages.map((page, visibleIndex) => <article className="notebook-page" key={page.id} aria-label={`第 ${spreadStart + visibleIndex + 1} 页`}>
            <span className="notebook-page-number">{spreadStart + visibleIndex + 1}</span>
            {page.kind === 'coverage' ? <div className="notebook-coverage"><BookOpen size={25}/><span>复习范围</span><h3>本次复习范围</h3><p>仅覆盖已选资料中的知识点，不代表全部考试范围。</p><small>{hasGenerated ? 'AI 助手 内容已匹配引用摘录，正确性仍需人工核对。' : '此提纲由预设演示逻辑生成。'}</small></div> : <>
              <header className="notebook-page-heading"><span>{String(page.sectionIndex + 1).padStart(2, '0')}</span><div><small>{page.continuation ? `知识点 · 续 ${page.continuation}` : '知识点与例题'}</small><h3>{page.title}</h3></div></header>
              <Markdown text={page.body}/>
              {page.isLast && preferences.showCitations && <div className="notebook-citations">{page.refs.map((reference, index) => <button key={`${reference.materialId}-${index}`} onClick={() => onOpenReference(reference)}><FileText size={13}/><span>{reference.name}</span><em>{sourceLocation(reference.name, reference.page)}</em><ChevronRight size={12}/></button>)}</div>}
              {page.isLast && (page.needsReview || drafts[page.sectionId] !== undefined) && <div className="notebook-review-note"><CircleAlert size={14}/><span>内容或引用待核对，请对照原文检查。</span>{page.needsReview && !dirty && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => onConfirmReferences(page.sectionId)}>我已核对</Button>}</div>}
              {page.isLast && page.edited && !page.needsReview && drafts[page.sectionId] === undefined && <span className="notebook-personal-edit"><CheckCheck size={13}/>个人编辑 · 已核对引用</span>}
            </>}
          </article>)}
          {!compact && visiblePages.length === 1 && <article className="notebook-page notebook-page-empty" aria-hidden="true"><BookOpen size={28}/><span>已读到末页</span></article>}
        </div>

        <footer className="notebook-pager">
          <Button variant="ghost" disabled={spreadStart === 0} onClick={() => goTo(spreadStart - pageStep)}><ChevronLeft size={17}/>上一页</Button>
          <div className="notebook-page-jump"><button onClick={() => setJumpOpen(value => !value)} aria-expanded={jumpOpen}>{compact ? `第 ${spreadStart + 1} 页` : `第 ${spreadStart + 1}${visiblePages.length > 1 ? `–${spreadStart + visiblePages.length}` : ''} 页`} / 共 {pages.length} 页</button>{jumpOpen && <div className="notebook-page-grid">{pages.map((_, index) => <button key={index} className={index >= spreadStart && index < spreadStart + pageStep ? 'active' : ''} onClick={() => goTo(index)}>{index + 1}</button>)}</div>}</div>
          <Button variant="ghost" disabled={spreadStart + pageStep >= pages.length} onClick={() => goTo(spreadStart + pageStep)}>下一页<ChevronRight size={17}/></Button>
        </footer>
      </div>
    </div>

    <Modal open={!!editingId} onOpenChange={open => { if (!open) onEditingChange(null); }} title={`编辑 · ${version.sections.find(section => section.id === editingId)?.title ?? ''}`} description="阅读与编辑分开进行，完成后会回到当前知识点。" wide>
      {editingId && version.sections.find(section => section.id === editingId) && ((section) => <div className="notebook-editor"><label htmlFor={`notebook-edit-${section.id}`}>编辑内容 <small>支持 Markdown 和数学公式</small></label><textarea id={`notebook-edit-${section.id}`} value={drafts[section.id] ?? section.body} maxLength={8000} onChange={event => onDraftChange(section, event.target.value)}/><div><span>修改后请重新核对引用是否仍支持你的表述。</span><Button onClick={() => onEditingChange(null)}>完成编辑，返回阅读</Button></div></div>)(version.sections.find(section => section.id === editingId)!)}
    </Modal>
  </section>;
}
