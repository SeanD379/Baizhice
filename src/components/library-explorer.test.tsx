// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LibraryExplorer } from './library-explorer';
import type { Folder, Material } from '@/lib/types';
import { localDay, moveConfirmationDateKey } from '@/lib/library-filters';

const drag = vi.hoisted(() => ({ props: null as null | { onStart: (ids: string[]) => void; onDrop: (materials: Material[], targetId: string) => void }, cancel: vi.fn(), finish: vi.fn(async () => undefined) }));
vi.mock('./library-drag', () => ({ useLibraryDrag: (props: NonNullable<typeof drag.props>) => { drag.props = props; return { cancel: drag.cancel, finish: drag.finish, draggingIds: [], overlay: null }; } }));
const onMoved = vi.fn(), onToast = vi.fn(), onOpen = vi.fn(), onReload = vi.fn(async () => undefined);
const notes: Material[] = [
  { id: 'a', courseId: 'course-a', name: '古诗.pdf', mime: 'application/pdf', size: 1024, createdAt: '2026-09-27T12:00:00', folderId: null, fixture: null, chapter: '原章节', status: 'ready', excluded: false, origin: 'test' },
  { id: 'b', courseId: 'course-a', name: '阅读.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 2048, createdAt: '2026-09-28T12:00:00', folderId: null, fixture: null, chapter: '原章节', status: 'ready', excluded: false, origin: 'test' },
];
async function renderNotes(batchMode = false) { await act(async () => root.render(<LibraryExplorer courseId="course-a" materials={notes} folders={folders} mathDemo={false} onOpen={onOpen} onDelete={vi.fn()} onUpload={vi.fn()} onSamples={vi.fn()} onReload={onReload} onMoved={onMoved} onToast={onToast} status={() => '可阅读'}/>)); if (batchMode) await click('批量管理'); }
async function click(label: string) { const button = [...document.querySelectorAll('button')].find(element => element.textContent === label)!; await act(async () => button.click()); }
async function change(label: string, value: string) {
  const input = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLSelectElement;
  await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}

let root: Root;
let container: HTMLDivElement;
const folders: Folder[] = [
  { id: 'root', courseId: 'course-a', parentId: null, name: '练习题', createdAt: '2026-09-28' },
  { id: 'other', courseId: 'course-a', parentId: null, name: '讲义', createdAt: '2026-09-28' },
  { id: 'child', courseId: 'course-a', parentId: 'root', name: '阅读理解', createdAt: '2026-09-28' },
  { id: 'grandchild', courseId: 'course-a', parentId: 'child', name: '古诗文', createdAt: '2026-09-28' },
];

beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear(); onReload.mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'new-child', courseId: 'course-a', parentId: 'other', name: '阅读理解' }))));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<LibraryExplorer courseId="course-a" materials={[]} folders={folders} mathDemo={false} onOpen={vi.fn()} onDelete={vi.fn()} onUpload={vi.fn()} onSamples={vi.fn()} onReload={async () => undefined} onMoved={vi.fn()} onToast={vi.fn()} status={() => ''}/>));
});

afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

it('groups child folders under their parent and can collapse the branch', async () => {
  const names = () => [...container.querySelectorAll('.library-folder-row .library-folder-item span')].map(element => element.textContent);
  expect(names()).toEqual(['练习题', '阅读理解', '古诗文', '讲义']);
  await act(async () => (container.querySelector('button[aria-label="收起练习题"]') as HTMLButtonElement).click());
  expect(names()).toEqual(['练习题', '讲义']);
  await act(async () => (container.querySelector('button[aria-label="展开练习题"]') as HTMLButtonElement).click());
  expect(names()).toEqual(['练习题', '阅读理解', '古诗文', '讲义']);
});

it('creates a child from the parent menu and allows names used in another branch', async () => {
  await act(async () => (container.querySelector('button[aria-label="讲义的更多操作"]') as HTMLButtonElement).click());
  const create = [...container.querySelectorAll('[role="menuitem"]')].find(element => element.textContent === '新建子文件夹') as HTMLButtonElement;
  expect(create).toBeTruthy();
  await act(async () => create.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('新建子文件夹');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('讲义');
  const input = document.querySelector('[role="dialog"] input') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '阅读理解');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fetch).toHaveBeenCalledWith('/api/folders', expect.objectContaining({ method: 'POST', body: JSON.stringify({ courseId: 'course-a', name: '阅读理解', parentId: 'other' }) }));
});

it('shows the current path and child folders when opening a parent', async () => {
  const buttons = [...container.querySelectorAll('.library-folder-row .library-folder-item')] as HTMLButtonElement[];
  await act(async () => buttons.find(button => button.textContent === '练习题0')!.click());
  expect(container.querySelector('.library-subfolders')?.textContent).toContain('阅读理解');
  await act(async () => (container.querySelector('.library-subfolders button') as HTMLButtonElement).click());
  expect(container.querySelector('.library-files-heading')?.textContent).toContain('练习题 / 阅读理解');
  expect(container.querySelector('.library-subfolders')?.textContent).toContain('古诗文');
});

it('explains that deleting a parent also removes its nested folders while preserving materials', async () => {
  await act(async () => (container.querySelector('button[aria-label="练习题的更多操作"]') as HTMLButtonElement).click());
  const remove = [...container.querySelectorAll('[role="menuitem"]')].find(element => element.textContent === '删除文件夹') as HTMLButtonElement;
  await act(async () => remove.click());
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain('其中的 2 个子文件夹也会删除');
  expect(dialog?.textContent).toContain('资料会移到“未分类”，不会删除原文件');
  expect(fetch).not.toHaveBeenCalled();
});

it('selects visible results, shows mixed selection and clears selection on search', async () => {
  await renderNotes(true);
  const all = container.querySelector('[aria-label="全选当前筛选结果"]') as HTMLInputElement;
  await act(async () => (container.querySelector('[aria-label="选择古诗.pdf"]') as HTMLInputElement).click());
  expect(all.indeterminate).toBe(true);
  await act(async () => all.click()); expect(container.querySelector('.library-selection-bar')?.textContent).toContain('已选 2 份');
  await change('搜索当前文件夹', '古诗');
  expect(container.querySelector('.library-selection-bar')).toBeNull();
  expect(container.querySelectorAll('.material-row')).toHaveLength(1);
  await act(async () => all.click()); expect(container.querySelector('.library-selection-bar')?.textContent).toContain('已选 1 份');
  expect(onOpen).not.toHaveBeenCalled();
});

it('keeps selection when only sorting changes, applies range filters on submit and can reset empty results', async () => {
  await renderNotes(true);
  await act(async () => (container.querySelector('[aria-label="全选当前筛选结果"]') as HTMLInputElement).click());
  await click('筛选与排序');
  await change('排序依据', 'size'); await change('排序方向', 'asc');
  await click('应用'); expect(container.querySelector('.library-selection-bar')?.textContent).toContain('已选 2 份');
  expect(container.querySelector('.material-name b')?.textContent).toBe('古诗.pdf');
  await change('最小文件大小', '100');
  expect(container.querySelectorAll('.material-row')).toHaveLength(2);
  await click('应用');
  expect(container.querySelector('.library-selection-bar')).toBeNull();
  expect(container.querySelector('.library-empty')?.textContent).toContain('没有符合条件');
  await click('清除筛选'); expect(container.querySelectorAll('.material-row')).toHaveLength(2);
});

it('submits one batch request and updates returned materials even when reload fails', async () => {
  await renderNotes(true);
  await act(async () => (container.querySelector('[aria-label="全选当前筛选结果"]') as HTMLInputElement).click());
  await click('移动到…'); await change('目标文件夹', 'root');
  const moved = notes.map(item => ({ ...item, folderId: 'root' }));
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ materials: moved })));
  onReload.mockRejectedValueOnce(new Error('刷新失败'));
  await click('确认移动');
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith('/api/materials', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ courseId: 'course-a', materialIds: ['b', 'a'], folderId: 'root' }) }));
  expect(onMoved).toHaveBeenCalledWith(moved);
  expect(onToast).toHaveBeenLastCalledWith(expect.stringContaining('工作区刷新失败'));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('confirms a drag before requesting, and cancellation does not save today preference', async () => {
  await renderNotes(true);
  await act(async () => { drag.props!.onStart(['a', 'b']); drag.props!.onDrop(notes, 'child'); });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('练习题 / 阅读理解');
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => (document.querySelector('.library-skip-confirm input') as HTMLInputElement).click());
  await click('取消');
  expect(localStorage.getItem(moveConfirmationDateKey)).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  expect(container.querySelector('.library-selection-bar')?.textContent).toContain('已选 2 份');
  expect(drag.cancel).toHaveBeenCalled();
});

it('remembers today only after a successful confirmed move', async () => {
  await renderNotes();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ materials: notes.map(item => ({ ...item, folderId: 'root' })) })));
  await act(async () => drag.props!.onDrop(notes, 'root'));
  await act(async () => (document.querySelector('.library-skip-confirm input') as HTMLInputElement).click());
  await click('确认移动');
  expect(localStorage.getItem(moveConfirmationDateKey)).toBe(localDay());
  expect(drag.finish).toHaveBeenCalledWith('root'); expect(onMoved).toHaveBeenCalledOnce();
});

it('skips drag confirmation today but restores it for an earlier stored date', async () => {
  await renderNotes();
  localStorage.setItem(moveConfirmationDateKey, localDay());
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ materials: notes.map(item => ({ ...item, folderId: 'root' })) })));
  await act(async () => drag.props!.onDrop(notes, 'root'));
  expect(fetch).toHaveBeenCalledOnce(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  localStorage.setItem(moveConfirmationDateKey, '2000-01-01');
  await act(async () => drag.props!.onDrop(notes, 'root'));
  expect(document.querySelector('[role="dialog"]')).toBeTruthy(); expect(fetch).toHaveBeenCalledOnce();
});

it('keeps the entire selection and original rows after a failed move', async () => {
  await renderNotes(true);
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: '目标文件夹已删除' }), { status: 400 }));
  await act(async () => { drag.props!.onStart(['a', 'b']); drag.props!.onDrop(notes, 'root'); });
  await click('确认移动');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('目标文件夹已删除');
  expect(container.querySelectorAll('.material-row')).toHaveLength(2);
  expect(container.querySelector('.library-selection-bar')?.textContent).toContain('已选 2 份');
  expect(onMoved).not.toHaveBeenCalled(); expect(drag.finish).not.toHaveBeenCalled();
});

it('does not allow submitting a batch already in its target folder', async () => {
  await renderNotes(); await act(async () => drag.props!.onDrop(notes, ''));
  expect(([...document.querySelectorAll('button')].find(button => button.textContent === '确认移动') as HTMLButtonElement).disabled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});


it('hides selection until batch management is opened and removes redundant view buttons', async () => {
  await renderNotes();
  expect(container.querySelector('.library-checkbox')).toBeNull();
  expect(container.querySelector('button[aria-label="查看古诗.pdf"]')).toBeNull();
  await act(async () => (container.querySelector('.material-name') as HTMLButtonElement).click());
  expect(onOpen).toHaveBeenCalledWith(notes[1]);
  await click('批量管理');
  expect(container.querySelectorAll('.library-checkbox')).toHaveLength(3);
  await act(async () => (container.querySelector('[aria-label="全选当前筛选结果"]') as HTMLInputElement).click());
  await click('退出批量管理');
  expect(container.querySelector('.library-checkbox')).toBeNull();
  expect(container.querySelector('.library-selection-bar')).toBeNull();
  await click('批量管理');
  expect((container.querySelector('[aria-label="全选当前筛选结果"]') as HTMLInputElement).checked).toBe(false);
});

it('does not expose batch selection during an ordinary single file drag', async () => {
  await renderNotes();
  await act(async () => drag.props!.onStart(['a']));
  expect(container.querySelector('.library-checkbox')).toBeNull();
  expect(container.querySelector('.library-selection-bar')).toBeNull();
});

async function renderMaster(selectedMaterialId?: string, onClearSelection = vi.fn()) {
  await act(async () => root.render(<LibraryExplorer courseId="course-a" materials={notes} folders={folders} mathDemo={false} onOpen={onOpen} onClearSelection={onClearSelection} onDelete={vi.fn()} onUpload={vi.fn()} onSamples={vi.fn()} onReload={onReload} onMoved={onMoved} onToast={onToast} status={() => '可阅读'} masterDetail selectedMaterialId={selectedMaterialId}/>));
}

it('shows a master list without table columns and preserves the current reader selection', async () => {
  await renderMaster('b');
  expect(container.querySelector('.library-master-heading')?.textContent).toContain('文件2');
  expect(container.querySelector('.library-folder-rail')).toBeTruthy();
  expect(container.querySelector('.material-head')).toBeNull();
  expect(container.querySelector('.column-chapter')).toBeNull();
  expect(container.querySelector('.material-name[aria-current="page"] b')?.textContent).toBe('阅读.docx');
  expect(container.querySelector('.library-master-row-meta')?.textContent).toContain('原章节');
  expect(container.querySelector('.library-master-row-summary')?.textContent).toContain('Word · 2 KB');
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => (container.querySelectorAll('.material-name')[1] as HTMLButtonElement).click());
  expect(onOpen).toHaveBeenCalledWith(notes[0]);
});

it('selects the first visible material once when the reader has no matching selection', async () => {
  await renderMaster();
  expect(onOpen).toHaveBeenCalledOnce();
  expect(onOpen).toHaveBeenCalledWith(notes[1]);
  await renderMaster();
  expect(onOpen).toHaveBeenCalledOnce();
  await renderMaster('b');
  await change('搜索当前文件夹', '古诗');
  expect(onOpen).toHaveBeenLastCalledWith(notes[0]);
});

it('clears the reader when a master-list search has no results and keeps it clear on rerender', async () => {
  const onClearSelection = vi.fn();
  await renderMaster('b', onClearSelection);
  await change('搜索当前文件夹', '不存在的资料');
  expect(container.querySelectorAll('.material-row')).toHaveLength(0);
  expect(onClearSelection).toHaveBeenCalledOnce();
  expect(onOpen).not.toHaveBeenCalled();
  await renderMaster(undefined, onClearSelection);
  expect(onClearSelection).toHaveBeenCalledOnce();
});

it('collapses and restores the folder area without removing nested folder controls', async () => {
  await renderMaster('b');
  const toggle = container.querySelector('button[aria-label="资料文件夹"]') as HTMLButtonElement;
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelectorAll('.library-folder-row')).toHaveLength(4);
  await act(async () => (container.querySelector('button[aria-label="讲义的更多操作"]') as HTMLButtonElement).click());
  expect(container.querySelector('[role="menu"]')?.textContent).toContain('新建子文件夹');
  expect(container.querySelector('[role="menu"]')?.textContent).toContain('删除文件夹');
  await act(async () => toggle.click());
  expect(container.querySelector('.library-folder-rail')).toBeTruthy();
});

it('retains batch selection and drag move controls in the master list', async () => {
  await renderMaster('b');
  expect(container.querySelectorAll('[data-material-drag]')).toHaveLength(2);
  await click('批量管理');
  await act(async () => (container.querySelector('[aria-label="全选当前筛选结果"]') as HTMLInputElement).click());
  expect(container.querySelector('.library-selection-bar')?.textContent).toContain('已选 2 份');
  await click('移动到…');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('批量移动资料');
  expect(document.querySelector('[aria-label="目标文件夹"]')?.textContent).toContain('练习题 / 阅读理解 / 古诗文');
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps folders available while changing filters in the independent file area', async () => {
  await renderMaster('b');
  const filterToggle = container.querySelector('button[aria-label="筛选与排序"]') as HTMLButtonElement;
  await act(async () => filterToggle.click());
  expect(container.querySelector('.library-folder-rail')).toBeTruthy();
  expect(container.querySelector('#library-filter-settings')).toBeTruthy();
  expect(container.querySelector('button[aria-label="资料文件夹"]')?.getAttribute('aria-expanded')).toBe('true');
  await act(async () => filterToggle.click());
  expect(container.querySelector('#library-filter-settings')).toBeNull();
});
it('supports keyboard collapse, restoration and the course-specific saved splitter ratio',async()=>{
  await renderMaster('b');const separator=container.querySelector('[role="separator"]')!;
  expect(separator.getAttribute('aria-valuenow')).toBe('35');
  const key=async(value:string)=>act(async()=>separator.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true})));
  await key('ArrowDown');expect(separator.getAttribute('aria-valuenow')).toBe('40');
  await key('Home');expect(container.querySelector('.library-split-list')?.getAttribute('data-folder-collapsed')).toBe('true');
  await key('End');expect(container.querySelector('.library-split-list')?.getAttribute('data-files-collapsed')).toBe('true');
  await key('Enter');expect(separator.getAttribute('aria-valuenow')).toBe('40');
  expect(localStorage.getItem('lms.library.split:course-a')).toBe('0.4');
  await key('Home');await act(async()=>root.unmount());root=createRoot(container);await renderMaster('b');
  expect(container.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')).toBe('0');
  await act(async()=>container.querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  expect(container.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')).toBe('40');
});
