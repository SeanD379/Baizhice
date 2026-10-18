'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Extension, Node, type Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu, type BubbleMenuProps } from '@tiptap/react/menus';
import { closeHistory } from '@tiptap/pm/history';
import { AllSelection, NodeSelection, Selection, TextSelection, type SelectionBookmark } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Mathematics } from '@tiptap/extension-mathematics';
import { createTable, TableKit } from '@tiptap/extension-table';
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, Check, ChevronDown, ChevronRight, Heading2, ImagePlus, Italic, Link, List, ListOrdered, Merge, Minus, Plus, Quote, Redo2, RemoveFormatting, Sigma, Split, Strikethrough, Table2, Type, Underline, Undo2 } from 'lucide-react';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { bulletListStyles, notebookListStyle, notebookOriginLabel, orderedListStyles, referenceOriginLabel, type RichNode } from '@/lib/notebook';
import { localImageBlob, retainNotebookImage } from './notebook-local-assets';

const NotebookImage = Image.extend({
  addNodeView() { return ({ node }) => {
    const dom = window.document.createElement('img'); dom.alt = node.attrs.alt ?? '笔记图片';
    let objectUrl = '', disposed = false;
    if (String(node.attrs.src).startsWith('notebook-local:')) void localImageBlob(node.attrs.src).then(blob => { if (blob && !disposed) { objectUrl = URL.createObjectURL(blob); dom.src = objectUrl; } });
    else dom.src = node.attrs.src;
    return { dom, destroy() { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); } };
  }; },
});

const SourceBlock = Node.create({
  name: 'sourceBlock', group: 'block', content: 'block+', defining: true, isolating: true,
  addAttributes: () => ({ id: { default: null, rendered: false }, origin: { default: null, rendered: false } }),
  parseHTML: () => [],
  renderHTML: ({ node }) => ['section', { class: `loose-source-block${node.attrs.origin?.kind === 'ai' || node.attrs.origin?.generation ? ' notebook-generated-piece' : ''}`, 'data-source-label': node.attrs.origin ? `${notebookOriginLabel(node.attrs.origin)}${node.attrs.origin.generation?.contentOrigin === 'ai-supplement' ? ` · ${referenceOriginLabel(node.attrs.origin.generation)}` : ''}` : '来源内容', 'data-source-review': node.attrs.origin?.needsReview ? 'true' : 'false' }, 0],
});
const ListStyle = Extension.create({
  name: 'notebookListStyle',
  addGlobalAttributes: () => ['bulletList', 'orderedList'].map(type => ({ types: [type], attributes: { listStyleType: {
    default: null,
    parseHTML: (element: HTMLElement) => { const value = element.style.listStyleType || (type === 'orderedList' ? ({ a: 'lower-alpha', i: 'lower-roman', '1': 'decimal' } as Record<string, string>)[element.getAttribute('type') ?? ''] : ''); return notebookListStyle({ type, attrs: { listStyleType: value } }); },
    renderHTML: (attributes: Record<string, unknown>) => ({ style: `list-style-type: ${notebookListStyle({ type, attrs: attributes })}` }),
  } } })),
});
function TableSizePicker({ onInsert }: { onInsert: (rows: number, columns: number) => void }) {
  const [size, setSize] = useState({ rows: 1, columns: 1 });
  return <><DropdownMenu.Label><span aria-live="polite">{size.columns} 列 × {size.rows} 行</span></DropdownMenu.Label><div className="notebook-table-picker" role="group" aria-label="选择表格尺寸">
    {Array.from({ length: 40 }, (_, index) => { const rows = Math.floor(index / 5) + 1, columns = index % 5 + 1; return <DropdownMenu.Item asChild key={index} onSelect={() => onInsert(rows, columns)}><button type="button" aria-label={`${columns} 列 × ${rows} 行`} data-selected={rows <= size.rows && columns <= size.columns} onPointerEnter={() => setSize({ rows, columns })} onFocus={() => setSize({ rows, columns })} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const column = Math.max(1, Math.min(5, columns + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0))), row = Math.max(1, Math.min(8, rows + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)));
      const grid = event.currentTarget.parentElement; (grid?.querySelectorAll('button')[(row - 1) * 5 + column - 1] as HTMLButtonElement)?.focus();
    }}/></DropdownMenu.Item>; })}
  </div><p className="notebook-picker-hint">最多 5 列，插入后可继续增加行</p></>;
}
const blockMenuOptions: BubbleMenuProps['options'] = { placement: 'left-start', offset: 6, flip: false, shift: { padding: 8 } };
const textMenuOptions: BubbleMenuProps['options'] = { placement: 'top', offset: 8, flip: true, shift: { padding: 8 } };
const tableMenuOptions: BubbleMenuProps['options'] = { placement: 'top', offset: 60, flip: false, shift: { padding: 8 } };
export function NotebookEditor({ document, onChange, onUploadingChange, historyContainer }: { document: RichNode; onChange: (document: RichNode) => void; onUploadingChange?: (uploading: boolean) => void; historyContainer: RefObject<HTMLDivElement | null> }) {
  const [error, setError] = useState(''), [uploading, setUploading] = useState(false), [formula, setFormula] = useState(''), [mathOpen, setMathOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false), [formatMenuOpen, setFormatMenuOpen] = useState(false), [tableMenuOpen, setTableMenuOpen] = useState<'rows' | 'header' | null>(null), [linkOpen, setLinkOpen] = useState(false), [link, setLink] = useState('');
  const [narrowMenu, setNarrowMenu] = useState(false);
  const mathTarget = useRef<{ pos: number; kind: 'inline' | 'block' } | null>(null);
  const currentEditor = useRef<Editor | null>(null);
  const target = useRef<SelectionBookmark | null>(null), imageTarget = useRef<SelectionBookmark | null>(null);
  const visibility = useRef({ uploading, mathOpen, linkOpen, menuOpen, formatMenuOpen, tableMenuOpen }); visibility.current = { uploading, mathOpen, linkOpen, menuOpen, formatMenuOpen, tableMenuOpen };
  const fileInput = useRef<HTMLInputElement>(null), change = useRef(onChange); change.current = onChange;
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), ListStyle, NotebookImage.configure({ allowBase64: false }), SourceBlock, TableKit.configure({ table: { renderWrapper: true, cellMinWidth: 100 } }), Mathematics.configure({ katexOptions: { throwOnError: false, trust: false }, inlineOptions: { onClick: (node, pos) => { mathTarget.current = { pos, kind: 'inline' }; saveTarget(); setFormula(node.attrs.latex); setMathOpen(true); } }, blockOptions: { onClick: (node, pos) => { mathTarget.current = { pos, kind: 'block' }; saveTarget(); setFormula(node.attrs.latex); setMathOpen(true); } } })],
    content: document,
    editorProps: { attributes: { class: 'notebook-rich-input', 'aria-label': '知识点正文', role: 'textbox', 'aria-multiline': 'true' }, handlePaste: (_view, event, slice) => {
      let tooWide = false; slice.content.descendants(node => { if (node.type.name === 'table' && TableMap.get(node).width > 5) tooWide = true; });
      if (tooWide) { event.preventDefault(); setError('表格最多支持 5 列，请减少列数后再粘贴。'); return true; }
      setError('');
      const file = Array.from(event.clipboardData?.files ?? []).find(file => file.type.startsWith('image/'));
      if (file) { event.preventDefault(); imageTarget.current = editor?.state.selection.getBookmark() ?? null; void upload(file); return true; } return false;
    }, handleDrop: (view, event, _slice, moved) => {
      if (moved) return false;
      const file = Array.from(event.dataTransfer?.files ?? []).find(file => file.type.startsWith('image/')); if (!file) return false;
      event.preventDefault();
      const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
      imageTarget.current = position ? Selection.near(view.state.doc.resolve(position.pos)).getBookmark() : view.state.selection.getBookmark();
      void upload(file); return true;
    } },
    onTransaction: ({ transaction }) => {
      if (target.current) target.current = target.current.map(transaction.mapping);
      if (imageTarget.current) imageTarget.current = imageTarget.current.map(transaction.mapping);
      if (mathTarget.current) mathTarget.current.pos = transaction.mapping.map(mathTarget.current.pos);
    },
    onUpdate: ({ editor }) => change.current(editor.getJSON() as RichNode),
  });
  currentEditor.current = editor;
  useEffect(() => { const query = window.matchMedia('(max-width: 600px)'), update = () => setNarrowMenu(query.matches); update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  function saveTarget() { const editor = currentEditor.current; if (editor) target.current = editor.state.selection.getBookmark(); }
  useEffect(() => {
    const input = fileInput.current; if (!input) return;
    const cancel = () => { imageTarget.current = null; };
    input.addEventListener('cancel', cancel); return () => input.removeEventListener('cancel', cancel);
  }, [editor]);
  function restoreTarget(bookmark = target.current) {
    if (!editor || editor.isDestroyed) return;
    if (bookmark) editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)));
    editor.commands.focus();
  }
  function blockRange() {
    if (!editor) return null;
    const position = editor.state.selection.$from, depth = position.depth >= 1 && position.node(1).type.name === 'sourceBlock' ? 2 : 1;
    const from = position.depth >= depth ? position.before(depth) : position.pos, node = editor.state.doc.nodeAt(from);
    return node ? { from, to: from + node.nodeSize, node, depth } : null;
  }
  function insertBlock(node: RichNode) {
    if (!editor) return;
    setError('');
    const block = blockRange(); if (!block) return;
    const replacement = block.node.type.name === 'paragraph' && !block.node.content.size;
    const from = replacement ? block.from : block.to;
    const created = editor.schema.nodeFromJSON(node), paragraph = editor.schema.nodes.paragraph.create();
    const transaction = editor.state.tr.replaceWith(from, replacement ? block.to : from, [created, paragraph]);
    transaction.setSelection(TextSelection.create(transaction.doc, from + created.nodeSize + 1));
    editor.view.dispatch(transaction.scrollIntoView()); editor.commands.focus();
  }
  async function upload(file: File) {
    if (!editor || uploading) return;
    imageTarget.current ??= editor.state.selection.getBookmark();
    setError(''); setUploading(true); onUploadingChange?.(true);
    try {
      const src = await retainNotebookImage(file);
      if (editor.isDestroyed) return;
      restoreTarget(imageTarget.current); insertBlock({ type: 'image', attrs: { src, alt: file.name || '粘贴图片' } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '图片上传失败，请保留原图片重试。'); }
    finally { imageTarget.current = null; setUploading(false); onUploadingChange?.(false); }
  }
  const showBlockMenu = useCallback<NonNullable<BubbleMenuProps['shouldShow']>>(({ editor, view, state }) => {
    const current = visibility.current;
    return !view.composing && !current.uploading && !current.mathOpen && !current.linkOpen && !current.formatMenuOpen && !current.tableMenuOpen && (current.menuOpen || editor.isFocused && (state.selection.empty || state.selection instanceof NodeSelection));
  }, []);
  const showTextMenu = useCallback<NonNullable<BubbleMenuProps['shouldShow']>>(({ editor, view, state, from, to }) => {
    const current = visibility.current;
    return !view.composing && !current.uploading && !current.menuOpen && !current.tableMenuOpen && !current.mathOpen && !current.linkOpen && (current.formatMenuOpen || editor.isFocused) && (state.selection instanceof TextSelection || state.selection instanceof AllSelection) && !state.selection.empty && !!state.doc.textBetween(from, to).trim();
  }, []);
  const showTableMenu = useCallback<NonNullable<BubbleMenuProps['shouldShow']>>(({ editor, view, state, from, to }) => {
    const current = visibility.current;
    if (view.composing || current.uploading || current.menuOpen || current.formatMenuOpen || current.mathOpen || current.linkOpen || !(current.tableMenuOpen || editor.isFocused) || !editor.isActive('table')) return false;
    if (current.tableMenuOpen || state.selection instanceof CellSelection || state.selection instanceof NodeSelection) return true;
    if (!state.selection.empty) return state.selection instanceof TextSelection && !!state.doc.textBetween(from, to).trim();
    for (let depth = state.selection.$from.depth; depth > 0; depth--) {
      const cell = state.selection.$from.node(depth);
      if (cell.type.name === 'tableCell' || cell.type.name === 'tableHeader') {
        let hasContent = false;
        cell.descendants(node => { if (node.isText && node.text?.trim() || node.isLeaf && !node.isText) hasContent = true; });
        return !hasContent;
      }
    }
    return false;
  }, []);
  const blockAnchor = useCallback(() => {
    if (!editor) return null;
    const block = blockRange(), dom = block && editor.view.nodeDOM(block.from);
    if (!(dom instanceof HTMLElement)) return null;
    return { getBoundingClientRect: () => { const rect = dom.getBoundingClientRect(); return new DOMRect(editor.view.dom.getBoundingClientRect().left, rect.top, 0, 32); } };
  }, [editor]);
  const tableAnchor = useCallback(() => {
    if (!editor) return null;
    const dom = editor.view.domAtPos(editor.state.selection.from).node;
    const table = (dom instanceof Element ? dom : dom.parentElement)?.closest('table');
    if (!table) return null;
    return { getBoundingClientRect: () => { const rect = table.getBoundingClientRect(); return new DOMRect(window.innerWidth <= 600 ? window.innerWidth / 2 : rect.left + rect.width / 2, rect.top, 0, 0); } };
  }, [editor]);
  if (!editor) return <p role="status">正在打开编辑页…</p>;
  function moveBlock(direction: number) {
    if (!editor) return;
    const block = blockRange(); if (!block) return;
    const { state, view } = editor, position = state.selection.$from, parent = position.node(block.depth - 1), index = position.index(block.depth - 1), destination = index + direction;
    if (destination < 0 || destination >= parent.childCount) return;
    let start = block.depth === 1 ? 0 : position.start(block.depth - 1);
    for (let offset = 0; offset < Math.min(index, destination); offset++) start += parent.child(offset).nodeSize;
    const first = parent.child(Math.min(index, destination)), second = parent.child(Math.max(index, destination));
    const offset = state.selection.from - block.from, selectedStart = start + (direction > 0 ? second.nodeSize : 0);
    const transaction = closeHistory(state.tr).replaceWith(start, start + first.nodeSize + second.nodeSize, [second, first]);
    transaction.setSelection(Selection.near(transaction.doc.resolve(Math.min(transaction.doc.content.size, selectedStart + offset))));
    view.dispatch(transaction.scrollIntoView()); editor.commands.focus();
  }
  function setParagraphType(level: 0 | 1 | 2 | 3) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (editor.isActive('bulletList')) chain.toggleBulletList();
    if (editor.isActive('orderedList')) chain.toggleOrderedList();
    if (editor.isActive('blockquote')) chain.toggleBlockquote();
    if (level) chain.setHeading({ level }); else chain.setParagraph();
    chain.run();
  }
  function setListStyle(type: 'bulletList' | 'orderedList', style: string) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (!editor.isActive(type)) { if (type === 'bulletList') chain.toggleBulletList(); else chain.toggleOrderedList(); }
    chain.updateAttributes(type, { listStyleType: style }).run();
  }
  function currentTable() {
    if (!editor) return null;
    const selection = editor.state.selection;
    if (selection instanceof NodeSelection && selection.node.type.name === 'table') return selection.node;
    for (let depth = selection.$from.depth; depth > 0; depth--) if (selection.$from.node(depth).type.name === 'table') return selection.$from.node(depth);
    return null;
  }
  function tableColumns() { const table = currentTable(); return table ? TableMap.get(table).width : 0; }
  const firstRow = currentTable()?.firstChild, headerEnabled = !!firstRow?.childCount && firstRow.content.content.every(cell => cell.type.name === 'tableHeader');
  const paragraphItems = ([0, 1, 2, 3] as const).map(level => <DropdownMenu.Item key={level} aria-label={['正文', '一级标题', '二级标题', '三级标题'][level]} onSelect={() => { restoreTarget(); setParagraphType(level); }}><span className="notebook-style-preview">{level ? `H${level}` : 'T'}</span>{['正文', '一级标题', '二级标题', '三级标题'][level]}{editor.isActive(level ? 'heading' : 'paragraph', level ? { level } : {}) && <Check size={14} className="notebook-menu-check"/>}</DropdownMenu.Item>);
  const submenus = [
    { label: '标题', icon: Heading2, content: paragraphItems.slice(1) },
    ...([{ label: '列表', icon: List, type: 'bulletList', styles: bulletListStyles, labels: ['实心圆', '空心圆', '方块'], previews: ['●', '○', '▪'] }, { label: '编号', icon: ListOrdered, type: 'orderedList', styles: orderedListStyles, labels: ['数字', '字母', '罗马数字'], previews: ['1.', 'a.', 'i.'] }] as const).map(({ label, icon, type, styles, labels, previews }) => ({ label, icon, content: styles.map((style, index) => <DropdownMenu.Item key={style} aria-label={labels[index]} onSelect={() => { restoreTarget(); setListStyle(type, style); }}><span className="notebook-style-preview">{previews[index]}</span>{labels[index]}{editor.isActive(type) && notebookListStyle({ type, attrs: editor.getAttributes(type) }) === style && <Check size={14} className="notebook-menu-check"/>}</DropdownMenu.Item>) })),
  ];
  function closeMenuFocus(event: Event) { event.preventDefault(); if (!visibility.current.mathOpen && !visibility.current.linkOpen) editor?.commands.focus(); }
  const inserts = [
    { label: '引用', icon: Quote, action: () => editor.chain().focus().toggleBlockquote().run() },
    { label: '图片', icon: ImagePlus, action: () => { imageTarget.current = editor.state.selection.getBookmark(); fileInput.current?.click(); } },
    { label: '公式', icon: Sigma, action: () => { mathTarget.current = null; setFormula(''); setMathOpen(true); } },
    { label: '分隔线', icon: Minus, action: () => insertBlock({ type: 'horizontalRule' }) },
    { label: '上移段落', icon: ArrowUp, action: () => moveBlock(-1) },
    { label: '下移段落', icon: ArrowDown, action: () => moveBlock(1) },
  ];
  const tableActions = [
    { label: '在前面插入行', available: editor.can().addRowBefore(), action: () => editor.commands.addRowBefore() }, { label: '在后面插入行', available: editor.can().addRowAfter(), action: () => editor.commands.addRowAfter() },
    { label: '在左侧插入列', available: tableColumns() < 5 && editor.can().addColumnBefore(), action: () => { if (tableColumns() < 5) editor.commands.addColumnBefore(); } }, { label: '在右侧插入列', available: tableColumns() < 5 && editor.can().addColumnAfter(), action: () => { if (tableColumns() < 5) editor.commands.addColumnAfter(); } },
    { label: '删除当前行', available: editor.can().deleteRow(), action: () => editor.commands.deleteRow() }, { label: '删除当前列', available: editor.can().deleteColumn(), action: () => editor.commands.deleteColumn() },
    { label: '删除表格', available: editor.can().deleteTable(), action: () => editor.commands.deleteTable() },
  ];
  const formats = [
    { label: '加粗', icon: Bold, mark: 'bold', action: () => editor.chain().focus().toggleBold().run() },
    { label: '斜体', icon: Italic, mark: 'italic', action: () => editor.chain().focus().toggleItalic().run() },
    { label: '下划线', icon: Underline, mark: 'underline', action: () => editor.chain().focus().toggleUnderline().run() },
    { label: '删除线', icon: Strikethrough, mark: 'strike', action: () => editor.chain().focus().toggleStrike().run() },
    { label: '链接', icon: Link, mark: 'link', action: () => { setError(''); saveTarget(); setLink(editor.getAttributes('link').href ?? ''); setLinkOpen(true); } },
    { label: '清除文字格式', icon: RemoveFormatting, mark: '', action: () => editor.chain().focus().unsetAllMarks().run() },
  ];
  return <div className="notebook-editor-surface">
    {historyContainer.current && createPortal(<><button type="button" aria-label="撤销" title="撤销 · Ctrl+Z" disabled={uploading || !editor.can().undo()} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16}/></button><button type="button" aria-label="重做" title="重做 · Ctrl+Shift+Z" disabled={uploading || !editor.can().redo()} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16}/></button></>, historyContainer.current)}
    <BubbleMenu editor={editor} pluginKey="notebook-block-menu" updateDelay={0} options={blockMenuOptions} shouldShow={showBlockMenu} getReferencedVirtualElement={blockAnchor}>
      <DropdownMenu.Root open={menuOpen} modal={false} onOpenChange={open => { if (open) saveTarget(); setMenuOpen(open); }}>
        <DropdownMenu.Trigger asChild><button className="notebook-block-trigger" type="button" aria-label="插入或调整内容" title="插入或调整内容" onPointerDown={saveTarget}><Plus size={17}/></button></DropdownMenu.Trigger>
        <DropdownMenu.Portal container={editor.view.dom.parentElement}><DropdownMenu.Content className="notebook-insert-menu" side="right" align="start" sideOffset={8} collisionPadding={12} onCloseAutoFocus={closeMenuFocus}>
          <DropdownMenu.Label>插入与段落</DropdownMenu.Label>
          <DropdownMenu.Item onSelect={() => { restoreTarget(); setParagraphType(0); }}><Type size={16}/>正文</DropdownMenu.Item>
          {submenus.map(({ label, icon: Icon, content }) => <DropdownMenu.Sub key={label}><DropdownMenu.SubTrigger><Icon size={16}/>{label}<ChevronRight size={14} className="notebook-menu-check"/></DropdownMenu.SubTrigger><DropdownMenu.Portal container={editor.view.dom.parentElement}><DropdownMenu.SubContent className="notebook-insert-menu" sideOffset={narrowMenu ? -204 : 4} collisionPadding={12}>{content}</DropdownMenu.SubContent></DropdownMenu.Portal></DropdownMenu.Sub>)}
          {inserts.slice(0, 3).map(({ label, icon: Icon, action }) => <DropdownMenu.Item key={label} disabled={uploading} onSelect={() => { restoreTarget(); action(); }}><Icon size={16}/>{label}</DropdownMenu.Item>)}
          <DropdownMenu.Sub><DropdownMenu.SubTrigger><Table2 size={16}/>表格<ChevronRight size={14} className="notebook-menu-check"/></DropdownMenu.SubTrigger><DropdownMenu.Portal container={editor.view.dom.parentElement}><DropdownMenu.SubContent className="notebook-insert-menu notebook-table-size-menu" sideOffset={narrowMenu ? -204 : 4} collisionPadding={12}><TableSizePicker onInsert={(rows, columns) => { restoreTarget(); insertBlock(createTable(editor.schema, rows, columns, true).toJSON() as RichNode); }}/></DropdownMenu.SubContent></DropdownMenu.Portal></DropdownMenu.Sub>
          {inserts.slice(3).map(({ label, icon: Icon, action }) => <DropdownMenu.Item key={label} disabled={uploading} onSelect={() => { restoreTarget(); action(); }}><Icon size={16}/>{label}</DropdownMenu.Item>)}
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </BubbleMenu>
    <BubbleMenu editor={editor} pluginKey="notebook-text-menu" updateDelay={100} className="notebook-text-menu" role="toolbar" aria-label="文字格式" options={textMenuOptions} shouldShow={showTextMenu}>
      <DropdownMenu.Root open={formatMenuOpen} modal={false} onOpenChange={open => { if (open) saveTarget(); setFormatMenuOpen(open); }}><DropdownMenu.Trigger asChild><button type="button" className="notebook-paragraph-select" aria-label="正文或标题" onPointerDown={saveTarget}>{editor.isActive('heading') ? `H${editor.getAttributes('heading').level}` : '正文'}<ChevronDown size={13}/></button></DropdownMenu.Trigger><DropdownMenu.Portal container={editor.view.dom.parentElement}><DropdownMenu.Content className="notebook-insert-menu" side="bottom" align="start" sideOffset={6} collisionPadding={12} onCloseAutoFocus={closeMenuFocus}>{paragraphItems}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
      {formats.map(({ label, icon: Icon, mark, action }) => <button key={label} type="button" aria-label={label} title={label} aria-pressed={!!mark && editor.isActive(mark)} onMouseDown={event => event.preventDefault()} onClick={action}><Icon size={16}/></button>)}
    </BubbleMenu>
    <BubbleMenu editor={editor} pluginKey="notebook-table-menu" updateDelay={0} className="notebook-text-menu notebook-table-menu" role="toolbar" aria-label="表格设置" options={tableMenuOptions} getReferencedVirtualElement={tableAnchor} shouldShow={showTableMenu}>
      <DropdownMenu.Root open={tableMenuOpen === 'rows'} modal={false} onOpenChange={open => { if (open) saveTarget(); setTableMenuOpen(current => open ? 'rows' : current === 'rows' ? null : current); }}><DropdownMenu.Trigger asChild><button type="button" className="notebook-paragraph-select" aria-label="行列操作" title="增删行列" onPointerDown={saveTarget}><Table2 size={16}/><ChevronDown size={13}/></button></DropdownMenu.Trigger><DropdownMenu.Portal container={editor.view.dom.parentElement}><DropdownMenu.Content className="notebook-insert-menu" side="bottom" align="start" sideOffset={6} collisionPadding={12} onCloseAutoFocus={closeMenuFocus}><DropdownMenu.Label>{tableColumns()} 列 · 最多 5 列</DropdownMenu.Label>{tableActions.map(({ label, available, action }) => <DropdownMenu.Item key={label} disabled={!available} onSelect={() => { restoreTarget(); action(); }}>{label}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
      <button type="button" aria-label="合并单元格" title="合并单元格" disabled={!editor.can().mergeCells()} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().mergeCells().run()}><Merge size={16}/></button>
      <button type="button" aria-label="拆分单元格" title="拆分单元格" disabled={!editor.can().splitCell()} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().splitCell().run()}><Split size={16}/></button>
      <DropdownMenu.Root open={tableMenuOpen === 'header'} modal={false} onOpenChange={open => { if (open) saveTarget(); setTableMenuOpen(current => open ? 'header' : current === 'header' ? null : current); }}><DropdownMenu.Trigger asChild><button type="button" className="notebook-paragraph-select" aria-label="表头设置" aria-pressed={headerEnabled} disabled={!editor.can().toggleHeaderRow()} onPointerDown={saveTarget}>表头<ChevronDown size={13}/></button></DropdownMenu.Trigger><DropdownMenu.Portal container={editor.view.dom.parentElement}><DropdownMenu.Content className="notebook-insert-menu notebook-header-menu" side="bottom" align="start" sideOffset={6} collisionPadding={12} onCloseAutoFocus={closeMenuFocus}><DropdownMenu.Label>表头设置</DropdownMenu.Label><DropdownMenu.CheckboxItem checked={headerEnabled} onCheckedChange={checked => { restoreTarget(); if (checked !== headerEnabled) editor.chain().focus().toggleHeaderRow().run(); }}><span className="notebook-checkbox-slot"><DropdownMenu.ItemIndicator><Check size={15}/></DropdownMenu.ItemIndicator></span>首行作为表头</DropdownMenu.CheckboxItem><p className="notebook-menu-description">将第一行加粗并加底色，用来标注各列名称，例如“概念”“解释”“例子”。取消勾选后恢复为普通内容。</p></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
      {([{ align: 'left', label: '左对齐', icon: AlignLeft }, { align: 'center', label: '居中对齐', icon: AlignCenter }, { align: 'right', label: '右对齐', icon: AlignRight }] as const).map(({ align, label, icon: Icon }) => <button type="button" key={align} aria-label={label} title={label} disabled={!editor.can().setCellAttribute('align', align)} aria-pressed={editor.isActive('tableCell', { align }) || editor.isActive('tableHeader', { align })} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().setCellAttribute('align', align).run()}><Icon size={16}/></button>)}
    </BubbleMenu>
    <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }}/>
    {error && !linkOpen && <p role="alert" className="modal-error">{error}</p>}{uploading && <p role="status">正在保留图片，请稍候…</p>}
    <EditorContent editor={editor}/>
    <Modal open={mathOpen} onOpenChange={open => { setMathOpen(open); if (!open) restoreTarget(); }} title="编辑公式" description="输入公式表达式，确认后显示在正文中。">
      <label className="notebook-form-label">LaTeX 公式<input value={formula} onChange={event => setFormula(event.target.value)} placeholder="例如：P(B|A)=\frac{P(A\cap B)}{P(A)}"/></label>
      <div className="modal-footer"><Button onClick={() => { setMathOpen(false); restoreTarget(); }}>取消</Button><Button variant="primary" disabled={!formula.trim()} onClick={() => { restoreTarget(); const location = mathTarget.current; if (location?.kind === 'block') editor.chain().focus().updateBlockMath({ pos: location.pos, latex: formula }).run(); else if (location) editor.chain().focus().updateInlineMath({ pos: location.pos, latex: formula }).run(); else editor.chain().focus().insertInlineMath({ latex: formula }).run(); setMathOpen(false); }}>确认公式</Button></div>
    </Modal>
    <Modal open={linkOpen} onOpenChange={open => { setLinkOpen(open); if (!open) restoreTarget(); }} title="编辑链接" description="为选中文字添加链接；清空地址可以移除链接。" error={error}>
      <label className="notebook-form-label">链接地址<input value={link} onChange={event => setLink(event.target.value)} placeholder="https://"/></label>
      <div className="modal-footer"><Button onClick={() => { setLinkOpen(false); restoreTarget(); }}>取消</Button><Button variant="primary" onClick={() => { const href = link.trim(); if (href && !/^(https?:\/\/|mailto:|\/api\/)/i.test(href)) { setError('请输入 http、https、mailto 或站内资料链接。'); return; } restoreTarget(); if (href) editor.chain().focus().setLink({ href }).run(); else editor.chain().focus().unsetLink().run(); setError(''); setLinkOpen(false); }}>确认链接</Button></div>
    </Modal>
  </div>;
}
