// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OriginalFilePreview } from './original-file-preview';
import type { Material } from '@/lib/types';

vi.mock('next/dynamic', () => ({ default: () => (props: {url:string;initialPage:number;pageUnit:string}) => <div data-preview-url={props.url} data-page={props.initialPage} data-unit={props.pageUnit}/> }));
const material: Material = {id:'stored-file',courseId:'course',name:'讲义.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:1024,fixture:null,chapter:'章节',status:'extracted',excluded:false,origin:'本机上传',createdAt:'2026-10-03'};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('opens a Word layout preview without interpreting paragraph positions as printed pages', async () => {
  await act(async () => root.render(<OriginalFilePreview material={material} initialPage={12}/>));
  expect(container.querySelector('[data-preview-url]')?.getAttribute('data-preview-url')).toBe('/api/files/stored-file');
  expect(container.querySelector('[data-preview-url]')?.getAttribute('data-page')).toBeNull();
  expect(container.querySelector('section')?.getAttribute('aria-label')).toBe('Word 原文件预览');
});
it('shows a presentation as slides and preserves original PDF page navigation', async () => {
  await act(async () => root.render(<OriginalFilePreview material={{...material,name:'课件.pptx',mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}}/>));
  expect(container.querySelector('[data-unit]')?.getAttribute('data-unit')).toBe('张幻灯片');
  await act(async () => root.render(<OriginalFilePreview material={{...material,name:'试卷.pdf',mime:'application/pdf'}} initialPage={5}/>));
  expect(container.querySelector('[data-preview-url]')?.getAttribute('data-preview-url')).toBe('/api/files/stored-file');
  expect(container.querySelector('[data-page]')?.getAttribute('data-page')).toBe('5');
});
it('displays original image bytes through the file endpoint', async () => {
  await act(async () => root.render(<OriginalFilePreview material={{...material,name:'笔记.png',mime:'image/png'}}/>));
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/files/stored-file');
  expect(container.querySelector('img')?.getAttribute('alt')).toBe('笔记.png');
});
it('preserves raw text whitespace and treats an empty file as loaded', async () => {
  vi.stubGlobal('fetch',vi.fn(async () => new Response('  第一行\n\n第二行')));
  await act(async () => root.render(<OriginalFilePreview material={{...material,name:'笔记.txt',mime:'text/plain'}}/>));
  await vi.waitFor(() => expect(container.querySelector('pre')?.textContent).toBe('  第一行\n\n第二行'));
  vi.mocked(fetch).mockResolvedValueOnce(new Response(''));
  await act(async () => root.render(<OriginalFilePreview material={{...material,id:'empty-file',name:'空白.txt',mime:'text/plain'}}/>));
  await vi.waitFor(() => expect(container.querySelector('pre')?.textContent).toBe(''));
  expect(container.querySelector('[role="status"]')).toBeNull();
});
it('shows a retry when the original text file is unavailable', async () => {
  vi.stubGlobal('fetch',vi.fn(async () => new Response('missing',{status:404})));
  await act(async () => root.render(<OriginalFilePreview material={{...material,name:'笔记.txt',mime:'text/plain'}}/>));
  await vi.waitFor(() => expect(container.querySelector('.preview-error')?.textContent).toContain('重试'));
  expect(container.querySelector('pre')).toBeNull();
});
