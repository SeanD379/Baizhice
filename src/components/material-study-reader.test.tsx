// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MaterialStudyReader } from './material-study-reader';
import type { Material, Reference } from '@/lib/types';
import { studyPresets, studyQuestionBody, type StudyPreset, type MaterialAnnotation, type MaterialStudyTask } from '@/lib/material-study';
import { parseOriginalQuestions } from '@/lib/question-bank';
import type { NotebookStore } from './use-notebook';
import type { PreviewAnnotationProps } from './preview-annotations';

let previewAnnotations: PreviewAnnotationProps;
vi.mock('./original-file-preview', () => ({ OriginalFilePreview: ({ studyAnnotations }: { studyAnnotations: PreviewAnnotationProps }) => {previewAnnotations=studyAnnotations;return <div>
  <button onClick={() => studyAnnotations.onPick?.({ kind: 'text', quote: '汇率', prefix: '', suffix: '', rects: [], displayPage: 1 })}>选择原文文字</button>
  <button onClick={() => studyAnnotations.onPick?.({ kind: 'region', quote: '区域名词', prefix: '', suffix: '', rects: [{ x: .1, y: .1, width: .2, height: .2 }], displayPage: 1 })}>选择已识别区域</button>
</div>; } }));

const material: Material = { id: 'm', courseId: 'c', name: '包含名词与定义的资料.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1, fixture: null, chapter: '章节', status: 'ready', excluded: false, origin: 'upload', createdAt: '' };
const second: Material = { ...material, id: 'second', name: '另一个文件的对比材料.docx' };
const reference: Reference = { materialId: 'm', name: material.name, page: 2, location: 'paragraph', sourceHash: 'source', snippet: '汇率' };
const annotation = (id = 'a', from = material): MaterialAnnotation => ({ id, materialId: from.id, courseId: 'c', name: from.name, sourceHash: 'source', extractionHash: 'extraction', anchor: { kind: 'text', quote: '汇率', prefix: '', suffix: '', rects: [], displayPage: 1 }, refs: [{ ...reference, materialId: from.id, name: from.name }], instruction: '请整理这些名词的解释', confirmedText: true, revision: 1, createdAt: '2026-10-04T00:00:00Z', updatedAt: '' });
const study = (overrides: Partial<MaterialStudyTask> = {}): MaterialStudyTask => ({ id: 'task', courseId: 'c', revision: 1, mode: 'annotations', materialIds: ['m'], annotationIds: ['a'], preset: 'notes', state: 'ready', done: 1, total: 1, sections: [{ id: 'section', title: '概念整理', body: '原文已有解释', refs: [reference], review: 'pending', generation: { provider: 'DeepSeek', model: 'deepseek-chat', draftId: 'task', contentOrigin: 'source' } }], warnings: [], error: '', createdAt: '2026-10-04T00:00:00Z', updatedAt: '', ...overrides });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let root: Root, container: HTMLDivElement, annotations: MaterialAnnotation[], tasks: MaterialStudyTask[], calls: Record<string, unknown>[], withheld: string[], configured: boolean, failedAction: string, notebook: NotebookStore;
let recognizedText:string,recognizedConfidence:number,recognitionResponse:Promise<Response>|undefined;
const onNotebook = vi.fn(), onReference = vi.fn(), onPractice = vi.fn(), onReload = vi.fn(async () => {});
const button = (label: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label)!;
const click = async (label: string) => { expect(button(label), `button ${label}`).toBeTruthy(); await act(async () => button(label).click()); };
const byLabel = <T extends Element = HTMLInputElement>(label: string) => document.querySelector(`[aria-label="${label}"]`) as T;
async function changeSelect(label: string, value: string) { await act(async () => { const input = byLabel<HTMLSelectElement>(label); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); }); }
async function edit(label: string, value: string) { await act(async () => { const input = byLabel<HTMLInputElement | HTMLTextAreaElement>(label); Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function render(from=material) { await act(async () => root.render(<MaterialStudyReader courseId="c" material={from} materials={[material, second]} notebook={notebook} onNotebook={onNotebook} onReference={onReference} onPractice={onPractice} onReload={onReload}/>)); }
async function openAnnotations() { await act(async () => container.querySelector<HTMLButtonElement>('.material-study-toolbar [aria-label="批注与草稿"]')!.click()); }
async function selectAnnotation(index = 1) { await act(async () => byLabel(`选择批注 ${index}`).dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
async function openDrafts() { await openAnnotations(); await act(async () => document.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')!.click()); }
async function editDraft(index=1) { await act(async()=>byLabel<HTMLButtonElement>(`编辑草稿 ${index}`)!.click()); }
const generationCalls = () => calls.filter(call => String(call.action).startsWith('study-'));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100);
  localStorage.clear(); annotations = [annotation(), annotation('b')]; tasks = []; calls = []; withheld = []; configured = true; failedAction = '';
  recognizedText='区域名词';recognizedConfidence=98;recognitionResponse=undefined;
  onNotebook.mockClear(); onReference.mockClear(); onPractice.mockClear(); onReload.mockClear();
  const data = { courseId: 'c', revision: 5, updatedAt: '', document: { chapters: [{ id: 'chapter', title: '已有章节' }], pages: [{ id: 'page', title: '个人页面' }], inbox: [], trash: [] } };
  notebook = { data, flush: vi.fn(async () => true), getCurrent: vi.fn(() => data), reload: vi.fn(async () => {}) } as unknown as NotebookStore;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') {
      if (url.includes('/annotations')) return response({ annotations, sourceHash: 'source' });
      if (url.startsWith('/api/practice-hub')) return response({ configured, withheldMaterials: withheld, records: [] });
      if (url.startsWith('/api/generation')) return response({ tasks, configured });
      return response({ banks: [], configured, imports: [material, second].map(item => ({ materialId: item.id, state: 'ready' })) });
    }
    const body = JSON.parse(init.body as string); calls.push(body);
    if (body.action === failedAction || `${body.action}:${body.preset}` === failedAction) return response({ error: '请求失败，草稿已保留' }, 500);
    if (body.action === 'recognize') return recognitionResponse??response({text:recognizedText,confidence:recognizedConfidence});
    if (url.includes('/annotations')) { const saved = { ...annotation('saved'), anchor: body.anchor, instruction: body.instruction, confirmedText: body.confirmedText }; annotations.push(saved); return response({ annotation: saved }); }
    if (body.action === 'study-organize') { const next = study({ id:`task-${body.preset}`, annotationIds: body.annotationIds, materialIds: body.materialIds, preset: body.preset }); tasks = [next,...tasks.filter(item=>item.id!==next.id)]; return response({ task: next }); }
    if (body.action === 'study-edit') { const current = tasks.find(item => item.id === body.taskId)!; const next = { ...current, revision: current.revision + 1, sections: current.sections.map(section => { const changed = body.edits?.find((item: { id: string }) => item.id === section.id); return { ...section, ...changed, question:section.question?{...section.question,...changed?.question}:undefined, review: body.approveIds?.includes(section.id) ? 'approved' : changed ? 'pending' : section.review }; }) } as MaterialStudyTask; tasks = [next]; return response({ task: next }); }
    if (body.action === 'study-adopt') { const next = { ...tasks[0], revision: tasks[0].revision + 1, sections: tasks[0].sections.map(section => ({ ...section, review: 'adopted' as const, ...(section.question?{practice:{materialId:section.question.materialId,questionId:section.question.id}}:{adopted: [{ pageId: 'page', pageTitle: '个人页面', chapterTitle: '已有章节' }]}) })) }; tasks = [next]; return response({ task: next }); }
    return response({});
  }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
it.each(['notebook','mistakes','papers'])('offers four real destinations and saves the selected %s destination before review',async destination=>{
  const question=parseOriginalQuestions({id:'m',name:material.name},[{page:1,text:'名词解释\n1.汇率'}])[0];
  tasks=[study({sections:[{id:'q',title:'汇率',body:studyQuestionBody(question),refs:[reference],destination:'practice',question,review:'approved'}]})];
  await render();await openDrafts();const select=byLabel<HTMLSelectElement>('草稿 1 收录去向');expect(select).toBeTruthy();
  expect([...select.options].map(option=>option.textContent)).toEqual(['活页笔记','知识点巩固','错题复盘','套卷练习']);
  expect(select.value).toBe('practice');await changeSelect('草稿 1 收录去向',destination);expect(generationCalls()).toEqual([]);expect(document.querySelector('.study-draft-meta small')?.textContent).toBe('待审核');
  await click('保存草稿');expect(generationCalls().at(-1)?.edits).toEqual([expect.objectContaining({id:'q',destination})]);
  expect(tasks[0].sections[0].review).toBe('pending');
});
it('enables practice destinations only for question drafts',async()=>{
  tasks=[study()];await render();await openDrafts();let select=byLabel<HTMLSelectElement>('草稿 1 收录去向');expect(select).toBeTruthy();
  expect(select.value).toBe('notebook');expect([...select.options].filter(option=>option.disabled).map(option=>option.value)).toEqual(['practice','mistakes','papers']);
  expect(generationCalls()).toEqual([]);
});
it('restores a personal destination from the draft cache without sending a request',async()=>{
  const question=parseOriginalQuestions({id:'m',name:material.name},[{page:1,text:'名词解释\n1.汇率'}])[0];
  tasks=[study({sections:[{id:'q',title:'汇率',body:studyQuestionBody(question),refs:[reference],destination:'practice',question,review:'approved'}]})];
  localStorage.setItem('lms.study.draft:task',JSON.stringify({q:{title:'汇率',body:studyQuestionBody(question),destination:'papers'}}));
  await render();await openDrafts();expect(byLabel<HTMLSelectElement>('草稿 1 收录去向').value).toBe('papers');
  expect(button('收录到套卷练习').disabled).toBe(true);expect(generationCalls()).toEqual([]);
});
it('limits annotations, draft counts and selected drafts to the current material',async()=>{
  annotations=[annotation(),annotation('foreign',second)];
  tasks=[study({id:'foreign-task',materialIds:['second'],sections:[{...study().sections[0],title:'其他资料草稿',refs:[{...reference,materialId:'second'}]}]}),study()];
  await render();await openAnnotations();
  expect(document.querySelectorAll('.study-annotation')).toHaveLength(1);
  expect(document.querySelector('[role="tab"]')?.textContent).toBe('批注 1');
  expect(container.textContent).not.toContain('跨文件');
  await act(async()=>document.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')!.click());
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('草稿 1');
  expect(document.querySelector('.study-draft-title')?.textContent).toBe('概念整理');
  expect(container.textContent).not.toContain('其他资料草稿');expect(byLabel('选择整理草稿')).toBeNull();
});
it('clears the previous material selection when switching files and loads only the new file drafts',async()=>{
  annotations=[annotation(),annotation('foreign',second)];
  tasks=[study(),study({id:'foreign-task',materialIds:['second'],sections:[{...study().sections[0],title:'另一份资料的知识点',refs:[{...reference,materialId:'second'}]}]})];
  await render();await openAnnotations();await selectAnnotation();await render(second);
  expect(document.querySelectorAll('.study-annotation')).toHaveLength(1);
  expect(byLabel<HTMLInputElement>('选择批注 1').checked).toBe(false);
  await act(async()=>document.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')!.click());
  expect(document.querySelector('.study-draft-title')?.textContent).toBe('另一份资料的知识点');
  expect(container.textContent).not.toContain('概念整理');
});
it('opens a draft source directly at its current material quote with one click',async()=>{
  tasks=[study({materialIds:['m','second'],sections:[{...study().sections[0],refs:[{...reference,materialId:'second'},reference]}]})];
  await render();await openDrafts();
  expect(document.querySelector('details.study-card-sources')).toBeNull();
  await click('查看出处');
  expect(onReference).toHaveBeenCalledTimes(1);
  expect(onReference).toHaveBeenCalledWith({...reference,anchor:{quote:reference.snippet}});
  expect(document.querySelector('.material-annotation-editor')).toBeNull();
});
it('closes the narrow review drawer when navigating to an original source',async()=>{
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(600);tasks=[study()];
  await render();await openDrafts();expect(document.querySelector('.material-review-floating')).not.toBeNull();
  await click('查看出处');
  expect(document.querySelector('.material-review-floating')).toBeNull();
  expect(onReference).toHaveBeenCalledWith({...reference,anchor:{quote:reference.snippet}});
});
it('reviews and adopts only current material sections from a historical mixed file draft',async()=>{
  tasks=[study({materialIds:['m','second'],sections:[study().sections[0],{...study().sections[0],id:'foreign',title:'其他资料草稿',refs:[{...reference,materialId:'second'}]}]})];
  await render();await openDrafts();expect(document.querySelectorAll('.study-candidate')).toHaveLength(1);
  await click('审核通过');expect(generationCalls().at(-1)?.approveIds).toEqual(['section']);
  await click('收录到活页');await click('确认收录');
  expect(generationCalls().at(-1)?.chosenIds).toEqual(['section']);
});
it('preserves another file personal edits when saving the current file from a mixed draft',async()=>{
  tasks=[study({materialIds:['m','second'],sections:[study().sections[0],{...study().sections[0],id:'foreign',title:'其他资料草稿',refs:[{...reference,materialId:'second'}]}]})];
  const foreign={title:'另一份资料的个人修订',body:'仍未保存的个人理解'};
  localStorage.setItem('lms.study.draft:task',JSON.stringify({section:{title:'概念整理',body:'当前资料的修订'},foreign}));
  await render();await openDrafts();await click('保存草稿');
  expect(generationCalls().at(-1)?.edits).toEqual([{id:'section',title:'概念整理',body:'当前资料的修订'}]);
  expect(localStorage.getItem('lms.study.draft:task')).toBe(JSON.stringify({foreign}));
  expect(tasks[0].sections[1].body).toBe('原文已有解释');
  await click('审核通过');expect(button('收录到活页').disabled).toBe(false);
  await render(second);expect(document.querySelector('.study-draft-title')?.textContent).toBe(foreign.title);
  await click('保存草稿');expect(generationCalls().at(-1)?.edits).toEqual([{id:'foreign',...foreign}]);expect(tasks[0].sections[1].body).toBe(foreign.body);
});
it('displays existing model errors using the AI assistant name while retaining completed drafts',async()=>{
  tasks=[study({state:'partial',error:'DeepSeek 返回了无法读取的内容，没有创建新版本，请重试。',warnings:['deepseek-flash 暂时不可用']})];
  await render();await openDrafts();
  expect(container.textContent).not.toMatch(/deepseek/i);expect(container.textContent).toContain('AI 助手');
  expect(container.textContent).toContain('已完成的草稿已保留');expect(document.querySelectorAll('.study-candidate')).toHaveLength(1);
});
it('restores the review width and supports keyboard resizing within readable pane limits', async () => {
  localStorage.setItem('lms.study.review-width:c', '430'); await render(); await openAnnotations();
  const separator = byLabel<HTMLDivElement>('调整资料预览和批注栏宽度');
  expect(separator.getAttribute('aria-orientation')).toBe('vertical'); expect(separator.getAttribute('aria-valuenow')).toBe('430');
  await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(separator.getAttribute('aria-valuenow')).toBe('446'); expect(localStorage.getItem('lms.study.review-width:c')).toBe('446');
  await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
  expect(separator.getAttribute('aria-valuenow')).toBe('768');
  await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  expect(separator.getAttribute('aria-valuenow')).toBe('280');
  await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(separator.getAttribute('aria-valuenow')).toBe('360'); expect(generationCalls()).toHaveLength(0);
});

it('offers four presets with notes as the default and never calls AI on opening or changing operations', async () => {
  await render(); await click('选择原文文字');
  expect(byLabel('批注整理要求')).toBeNull();
  const options = [...document.querySelectorAll<HTMLInputElement>('[aria-label="选择批注预设"] input[type="radio"]')];
  expect(options.map(option => option.value)).toEqual(['notes', 'concepts', 'compare', 'qa']);
  expect(options[0].checked).toBe(true);
  for (const option of options) await act(async () => option.click());
  expect(generationCalls()).toHaveLength(0);
});

it('opens annotation editing only from its dedicated action and keeps the selected preset',async()=>{
  annotations[0].instruction=studyPresets.qa.description;await render();await openAnnotations();
  const card=document.querySelector('.study-annotation')!;
  await act(async()=>card.querySelector<HTMLElement>('.annotation-quote')!.click());
  expect(onReference).not.toHaveBeenCalled();expect(document.querySelector('.material-annotation-editor')).toBeNull();
  const editButton=byLabel<HTMLButtonElement>('编辑批注 1');expect(editButton).toBeTruthy();
  expect(editButton.nextElementSibling).toBe(byLabel('删除批注 1'));
  await act(async()=>editButton.click());
  expect(onReference).toHaveBeenCalledWith(expect.objectContaining({materialId:material.id,anchor:expect.objectContaining({quote:'汇率'})}));
  expect(document.querySelector('.material-annotation-editor')).not.toBeNull();
  expect(document.querySelector<HTMLInputElement>('[aria-label="选择批注预设"] input[value="qa"]')!.checked).toBe(true);expect(generationCalls()).toEqual([]);
});

it('shows the chosen organization option below the quote without the redundant file or source text',async()=>{
  annotations[0].instruction=studyPresets.compare.description;await render();await openAnnotations();
  const cards=document.querySelectorAll('.study-annotation');
  expect(cards[0].querySelector('.annotation-instruction')?.textContent).toContain('对比辨析');
  expect(cards[0].textContent).not.toContain(material.name);expect(cards[0].textContent).not.toContain('查看出处');
  expect(cards[1].querySelector('.annotation-instruction')?.textContent).toContain('未选择整理选项');
  expect(cards[1].textContent).not.toContain(annotations[1].instruction);
});

it('shows only the annotation editor until saving or cancelling returns to the batch list',async()=>{
  await render();await openAnnotations();await selectAnnotation();
  await act(async()=>byLabel<HTMLButtonElement>('编辑批注 1').click());
  expect(document.querySelector('.study-annotation')).toBeNull();expect(button('生成整理草稿')).toBeUndefined();
  await act(async()=>byLabel<HTMLButtonElement>('取消编辑批注').click());
  expect(byLabel<HTMLInputElement>('选择批注 1').checked).toBe(true);
  await act(async()=>byLabel<HTMLButtonElement>('编辑批注 1').click());
  await act(async()=>document.querySelector<HTMLInputElement>('[aria-label="选择批注预设"] input[value="notes"]')!.click());
  await click('保存批注');expect(document.querySelector('.material-annotation-editor')).toBeNull();
  expect(document.querySelectorAll('.study-annotation').length).toBeGreaterThan(0);expect(button('生成整理草稿')).toBeTruthy();
  expect(calls.at(-1)).toMatchObject({id:'a',revision:1,instruction:studyPresets.notes.description});expect(generationCalls()).toEqual([]);
});

it('reads drafts as cards and opens inputs only for explicit editing, then saves without adopting',async()=>{
  tasks=[study()];await render();await openDrafts();
  expect(byLabel('知识点 1 正文')).toBeNull();expect(document.querySelector('.study-draft-title')?.textContent).toBe('概念整理');
  await editDraft();await edit('知识点 1 正文','核对后的正文');await click('保存草稿');
  expect(byLabel('知识点 1 正文')).toBeNull();expect(document.querySelector('.study-candidate')?.textContent).toContain('核对后的正文');
  expect(tasks[0].sections[0].review).toBe('pending');expect(generationCalls().map(call=>call.action)).toEqual(['study-edit']);
});

it('separates labeled draft paragraphs while preserving the original body for editing',async()=>{
  const next=study(),body='【定义】金融远期的定义。 【要点】约定交割价格。\n【示例（AI 补充）】一个简短例子。';next.sections[0].body=body;tasks=[next];
  await render();await openDrafts();
  const paragraphs=[...document.querySelectorAll('.study-draft-body>p')];
  expect(paragraphs.map(paragraph=>paragraph.textContent)).toEqual(['【定义】金融远期的定义。','【要点】约定交割价格。','【示例（AI 补充）】一个简短例子。']);
  expect(paragraphs.map(paragraph=>paragraph.querySelector('strong')?.textContent)).toEqual(['【定义】','【要点】','【示例（AI 补充）】']);
  expect(document.querySelector('.study-annotation .study-draft-body')).toBeNull();
  await editDraft();expect(byLabel<HTMLTextAreaElement>('知识点 1 正文').value).toBe(body);
});

it('keeps adopted cards readable without editing controls and opens their notebook location',async()=>{
  const next=study();next.sections[0].review='adopted';next.sections[0].adopted=[{pageId:'page',pageTitle:'个人页面',chapterTitle:'已有章节'}];tasks=[next];
  await render();await openDrafts();expect(container.textContent).toContain('已收录');
  expect(byLabel('编辑草稿 1')).toBeNull();expect(document.querySelector('.study-draft-actions')).toBeNull();expect(byLabel('知识点 1 正文')).toBeNull();
  await act(async()=>byLabel<HTMLButtonElement>('打开活页 1').click());expect(onNotebook).toHaveBeenCalledWith('page');expect(generationCalls()).toEqual([]);
});

it('previews a hovered annotation from the current file without opening its editor or changing the selection',async()=>{
  await render();await openAnnotations();
  const card=document.querySelectorAll('.study-annotation')[1];
  await act(async()=>card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
  expect(previewAnnotations.highlightedId).toBe('b');expect(previewAnnotations.focusAnchor).toEqual(annotations[1].anchor);
  expect(byLabel<HTMLInputElement>('选择批注 2').checked).toBe(false);expect(onReference).not.toHaveBeenCalled();expect(document.querySelector('.material-annotation-editor')).toBeNull();
  await act(async()=>card.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body})));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,150)));
  expect(previewAnnotations.highlightedId).toBeUndefined();expect(generationCalls()).toHaveLength(0);
});

it('keeps the source preview during a brief pointer exit and reentry',async()=>{
  await render();await openAnnotations();const card=document.querySelectorAll('.study-annotation')[1];
  await act(async()=>card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
  await act(async()=>card.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body})));
  expect(previewAnnotations.highlightedId).toBe('b');
  await act(async()=>card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,150)));
  expect(previewAnnotations.highlightedId).toBe('b');expect(onReference).not.toHaveBeenCalled();
});

it('saves a text annotation without any AI request', async () => {
  await render(); await click('选择原文文字'); await act(async()=>document.querySelector<HTMLInputElement>('[aria-label="选择批注预设"] input[value="concepts"]')!.click()); await click('保存批注');
  expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ confirmedText: true, instruction: '为选中的概念补充解释，标注 AI 补充，审核后再收录。', anchor: { quote: '汇率' } });
  expect(generationCalls()).toHaveLength(0);
});

it('requires explicit region-text verification before an annotation can be organized', async () => {
  await render(); await click('选择已识别区域'); await openAnnotations(); await act(async()=>document.querySelector<HTMLInputElement>('[aria-label="选择批注预设"] input[value="concepts"]')!.click()); await click('保存批注');
  const selected = byLabel<HTMLInputElement>('选择批注 3'); expect(selected.disabled).toBe(true); expect(generationCalls()).toHaveLength(0);
});
const imageSelection=(quote='区域名词')=>({kind:'region' as const,quote,prefix:'',suffix:'',rects:[{x:.1,y:.1,width:.2,height:.2}],displayPage:1,image:'data:image/png;base64,crop'});
it('switches between grab, box and text tools without requesting AI',async()=>{
  await render();await click('拖拽浏览');expect(previewAnnotations.mode).toBe('pan');
  const openTools=()=>act(async()=>button('批注').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
  await openTools();await click('框选批注');expect(previewAnnotations.mode).toBe('region');
  await openTools();await click('文字批注');expect(previewAnnotations.mode).toBe('text');expect(generationCalls()).toEqual([]);
});
it('recognizes a crop even when native text exists and saves both sources without calling AI',async()=>{
  await render();await act(async()=>previewAnnotations.onPick?.(imageSelection()));
  expect(calls[0]).toMatchObject({action:'recognize',image:imageSelection().image});expect(previewAnnotations.composer).toBeTruthy();expect(document.querySelector('.material-review-pane')).toBeNull();
  await act(async()=>previewAnnotations.composer!.onChange(studyPresets.concepts.description));
  await act(async()=>previewAnnotations.composer!.onDetails());expect(document.querySelector<HTMLDetailsElement>('.annotation-recognition')!.open).toBe(false);
  await click('保存批注');expect(calls.at(-1)).toMatchObject({confirmedText:true,image:imageSelection().image,anchor:{quote:'区域名词',recognition:{sourceText:'区域名词',ocrText:'区域名词'}}});expect(generationCalls()).toEqual([]);
});
it('preserves the native text and requires review when OCR disagrees',async()=>{
  recognizedText='另一个识别结果';await render();await act(async()=>previewAnnotations.onPick?.(imageSelection()));await act(async()=>previewAnnotations.composer!.onDetails());
  expect(byLabel<HTMLTextAreaElement>('核对选区文字').value).toBe('区域名词');expect(document.querySelector<HTMLDetailsElement>('.annotation-recognition')!.open).toBe(true);expect(document.querySelector<HTMLInputElement>('.study-check input')!.checked).toBe(false);
});
it('ignores recognition that finishes after the user cancels the selection',async()=>{
  let finish!:(value:Response)=>void;recognitionResponse=new Promise(resolve=>{finish=resolve;});await render();await act(async()=>previewAnnotations.onPick?.(imageSelection()));
  expect(previewAnnotations.composer!.busy).toBe('识别选区文字');await act(async()=>previewAnnotations.composer!.onCancel());await act(async()=>finish(response({text:'旧识别结果',confidence:99})));
  expect(previewAnnotations.pending).toBeUndefined();expect(previewAnnotations.composer).toBeUndefined();expect(document.querySelector('.material-annotation-editor')).toBeNull();
});

it('keeps confirmation concise with the actual selected files and count, and cancels without sending', async () => {
  annotations.forEach(item=>item.instruction=studyPresets.concepts.description);localStorage.setItem('lms.study.consent:c', 'true'); await render(); await openAnnotations(); await selectAnnotation(); await selectAnnotation(2); await click('生成整理草稿');
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('补充概念解释'); expect(dialog.textContent).toContain(material.name); expect(dialog.textContent).not.toContain(second.name); expect(dialog.textContent).toContain('2 条');
  expect(dialog.textContent).toContain('整理方式');expect(dialog.textContent).toContain('整理范围');
  expect(dialog.textContent).not.toContain('DeepSeek');expect(dialog.textContent).not.toContain('视觉与文字');expect(generationCalls()).toHaveLength(0);
  await click('取消'); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(generationCalls()).toHaveLength(0);
});

it('hides saved marks during browsing and panning, and shows them in annotation and draft review',async()=>{
  tasks=[study()];await render();expect(previewAnnotations.annotations).toEqual([]);
  await openAnnotations();expect(previewAnnotations.annotations?.map(item=>item.id)).toEqual(['a','b']);
  await act(async()=>byLabel<HTMLButtonElement>('拖拽浏览').click());expect(previewAnnotations.mode).toBe('pan');expect(previewAnnotations.annotations).toEqual([]);
  await openAnnotations();expect(previewAnnotations.annotations).toEqual([]);
  await act(async()=>document.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')!.click());
  expect(previewAnnotations.annotations?.map(item=>item.id)).toEqual(['a','b']);
  await act(async()=>byLabel<HTMLButtonElement>('关闭审核栏').click());expect(previewAnnotations.annotations).toEqual([]);
});

it('previews hovered and selected cards during panning, then restores clean browsing',async()=>{
  await render();await click('拖拽浏览');await openAnnotations();expect(previewAnnotations.annotations).toEqual([]);
  await act(async()=>document.querySelector('.study-annotation')!.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
  expect(previewAnnotations.highlightedId).toBe('a');expect(previewAnnotations.mode).toBe('browse');expect(previewAnnotations.focusAnchor?.quote).toBe('汇率');
  await act(async()=>document.querySelector('.study-annotation')!.dispatchEvent(new MouseEvent('mouseout',{bubbles:true})));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,150)));expect(previewAnnotations.mode).toBe('pan');expect(previewAnnotations.annotations).toEqual([]);
  await selectAnnotation(1);expect(previewAnnotations.highlightedId).toBe('a');
  await selectAnnotation(2);expect(previewAnnotations.highlightedId).toBe('b');expect(previewAnnotations.annotations?.map(item=>item.id)).toEqual(['a','b']);
  await selectAnnotation(2);expect(previewAnnotations.highlightedId).toBe('a');await selectAnnotation(1);expect(previewAnnotations.annotations).toEqual([]);
});

it('automatically routes whole-file content independently of selected annotation presets',async()=>{
  annotations.forEach(item=>item.instruction=studyPresets.concepts.description);await render();await click('整理知识点');
  const dialog=document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('自动识别知识与题目');expect(dialog.textContent).toContain('整份资料');expect(dialog.textContent).not.toContain('补充概念解释');expect(generationCalls()).toEqual([]);
  await click('同意并生成草稿');
  expect(generationCalls()).toEqual([{action:'study-organize',courseId:'c',mode:'material',preset:'notes',routing:'auto',materialIds:['m'],annotationIds:[],confirmed:true}]);
});

it('reviews and adopts question drafts into knowledge practice without flushing or writing a notebook',async()=>{
  const question=parseOriginalQuestions({id:'m',name:material.name},[{page:1,text:'名词解释\n1.汇率'}])[0];
  tasks=[study({mode:'material',routing:'auto',sections:[{id:'q',title:'汇率',body:studyQuestionBody(question),refs:[reference],destination:'practice',question,review:'pending'}]})];
  await render();await openDrafts();expect(byLabel<HTMLSelectElement>('草稿 1 收录去向').value).toBe('practice');
  expect(button('收录到知识点巩固').disabled).toBe(true);
  expect(generationCalls()).toEqual([]);await editDraft();await edit('题目 1 答案','已核对的参考答案');await click('保存草稿');await click('审核通过');
  await click('收录到知识点巩固');expect(document.querySelector('[role="dialog"]')?.textContent).toContain('知识点巩固 · 1 题');expect(byLabel('知识点收录位置')).toBeNull();
  await click('确认收录');const request=generationCalls().find(call=>call.action==='study-adopt');expect(request?.targets).toEqual([]);expect(request).not.toHaveProperty('notebookRevision');expect(notebook.flush).not.toHaveBeenCalled();
  expect(byLabel<HTMLButtonElement>('打开知识点巩固 1')).toBeTruthy();await act(async()=>byLabel<HTMLButtonElement>('打开知识点巩固 1').click());expect(onPractice).toHaveBeenCalledWith('m','knowledge');expect(onNotebook).not.toHaveBeenCalled();
});

it.each(['notes', 'concepts', 'compare', 'qa'])('sends only the confirmed %s preset and selection, then opens the saved draft', async preset => {
  annotations[1].instruction=studyPresets[preset as StudyPreset].description;await render(); await openAnnotations(); await selectAnnotation(2); await click('生成整理草稿'); await click('同意并生成草稿');
  expect(generationCalls()).toEqual([{ action: 'study-organize', courseId: 'c', mode: 'annotations', materialIds: ['m'], annotationIds: ['b'], preset, confirmed: true }]);
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('草稿'); expect(document.querySelector('.study-draft-title')?.textContent).toBe('概念整理');
});

it('organizes mixed presets separately after confirming their actual selection',async()=>{
  annotations[0].instruction=studyPresets.notes.description;annotations[1].instruction=studyPresets.qa.description;
  await render();await openAnnotations();await selectAnnotation();await selectAnnotation(2);await click('生成整理草稿');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('复习问答');expect(generationCalls()).toHaveLength(0);
  await click('同意并生成草稿');
  expect(generationCalls()).toEqual([
    {action:'study-organize',courseId:'c',mode:'annotations',materialIds:['m'],annotationIds:['a'],preset:'notes',confirmed:true},
    {action:'study-organize',courseId:'c',mode:'annotations',materialIds:['m'],annotationIds:['b'],preset:'qa',confirmed:true},
  ]);
});

it('preserves a submitted preset group when a later group fails and allows retry',async()=>{
  annotations[0].instruction=studyPresets.notes.description;annotations[1].instruction=studyPresets.qa.description;failedAction='study-organize:qa';
  await render();await openAnnotations();await selectAnnotation();await selectAnnotation(2);await click('生成整理草稿');await click('同意并生成草稿');
  expect(tasks).toHaveLength(1);expect(tasks[0].annotationIds).toEqual(['a']);expect(document.querySelector('[role="dialog"]')?.textContent).toContain('请求失败');
  failedAction='';await click('同意并生成草稿');expect(tasks).toHaveLength(2);expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('continues an interrupted task with its original preset and IDs rather than the current annotation selection', async () => {
  tasks = [study({ preset: 'qa', materialIds: ['m'], annotationIds: ['b'], state: 'partial', done: 1, total: 2, error: '上一批次失败' })];
  annotations[0].instruction=studyPresets.concepts.description;await render(); await openAnnotations(); await selectAnnotation(); await act(async () => document.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')!.click());
  await click('继续未完成批次'); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('复习问答'); await click('同意并生成草稿');
  expect(generationCalls()[0]).toMatchObject({ taskId: 'task', preset: 'qa', annotationIds: ['b'], materialIds: ['m'] });
});

it('retains AI supplementation and question-origin labels after a local edit and explicit save', async () => {
  const next = study({ preset: 'concepts' }); next.sections[0].generation = { ...next.sections[0].generation!, contentOrigin: 'ai-supplement' }; tasks = [next];
  await render(); await openDrafts(); expect(container.textContent).toContain('AI 补充解释'); expect(document.querySelector('.study-card-source')?.getAttribute('title')).toBe('提问出处，非答案依据');
  await editDraft();
  await edit('知识点 1 正文', '人工修订的补充说明'); await click('保存草稿');
  expect(container.textContent).toContain('AI 补充解释'); expect(tasks[0].sections[0].generation?.contentOrigin).toBe('ai-supplement'); expect(tasks[0].sections[0].review).toBe('pending');
});

it('restores a local draft on refresh and requires review again before it can be adopted', async () => {
  const next = study(); next.sections[0].review = 'approved'; tasks = [next];
  localStorage.setItem('lms.study.draft:task', JSON.stringify({ section: { title: '恢复后的标题', body: '恢复后的个人修订', excluded: false } }));
  await render(); await openDrafts(); await editDraft();expect(byLabel<HTMLInputElement>('知识点 1 标题').value).toBe('恢复后的标题'); expect(button('收录到活页').disabled).toBe(true);
  await click('保存草稿'); expect(tasks[0].sections[0].review).toBe('pending'); expect(button('收录到活页').disabled).toBe(true);
  await click('审核通过'); expect(button('收录到活页').disabled).toBe(false); expect(generationCalls().filter(call => call.action === 'study-adopt')).toHaveLength(0);
  await click('收录到活页'); await changeSelect('知识点收录位置', 'page:page'); await click('确认收录');
  expect(generationCalls().at(-1)).toMatchObject({ action: 'study-adopt', chosenIds: ['section'], notebookRevision: 5, targets: [{ sectionId: 'section', pageId: 'page' }] }); expect(notebook.flush).toHaveBeenCalled();
});

it('preserves the reviewed draft and never adopts if existing notebook edits cannot synchronize', async () => {
  const next = study(); next.sections[0].review = 'approved'; tasks = [next]; vi.mocked(notebook.flush).mockResolvedValue(false);
  await render(); await openDrafts(); await click('收录到活页'); await click('确认收录');
  expect(generationCalls().filter(call => call.action === 'study-adopt')).toHaveLength(0); expect(document.body.textContent).toContain('同步'); expect(document.querySelector('.study-candidate')?.textContent).toContain('原文已有解释');
});

it('keeps stale-source drafts visible but prevents review and adoption', async () => {
  const next = study({ stale: true }); next.sections[0].review = 'approved'; tasks = [next]; annotations[0].stale = true;
  await render(); await openDrafts(); expect(document.querySelector('.study-draft-title')?.textContent).toBe('概念整理'); expect(button('审核通过').disabled).toBe(true); expect(button('收录到活页').disabled).toBe(true);
  expect(container.textContent).toContain('来源或批注已变化'); expect(generationCalls()).toHaveLength(0);
});

it('hides withheld server drafts and cached personal edits without destroying the cache', async () => {
  tasks = [study({ withheld: true, sections: [] })]; withheld = ['m'];
  const cached = JSON.stringify({ section: { title: '考试期间秘密标题', body: '考试期间秘密解析', excluded: false } }); localStorage.setItem('lms.study.draft:task', cached);
  await render(); await openDrafts(); expect(container.textContent).not.toContain('秘密'); expect(container.textContent).toContain('未交卷'); expect(byLabel('知识点 1 正文')).toBeNull(); expect(localStorage.getItem('lms.study.draft:task')).toBe(cached);
  expect(generationCalls()).toHaveLength(0);
});

it.each(['exam', 'configuration'])('explains %s and prevents organizing before sending annotations', async reason => {
  if (reason === 'exam') withheld = ['m']; else configured = false;
  await render(); await openAnnotations(); await selectAnnotation();
  expect(button('生成整理草稿').disabled).toBe(true); expect(container.textContent).toContain(reason === 'exam' ? '未交卷' : '尚未配置'); expect(generationCalls()).toHaveLength(0);
});

it('keeps the explicit confirmation open after a generation failure and retries the same scope', async () => {
  annotations[0].instruction=studyPresets.compare.description;await render(); await openAnnotations(); await selectAnnotation(); await click('生成整理草稿'); failedAction = 'study-organize'; await click('同意并生成草稿');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('请求失败'); expect(tasks).toHaveLength(0);
  failedAction = ''; await click('同意并生成草稿'); expect(generationCalls()).toHaveLength(2); expect(generationCalls()[1]).toEqual(generationCalls()[0]);
});
