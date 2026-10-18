// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PdfPreview from './pdf-preview';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({ promise: new Promise(() => {}), destroy: async () => undefined }),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('enters and exits fullscreen when the PDF page area is double-clicked', async () => {
  await act(async () => root.render(<PdfPreview url="/sample.pdf" name="课程讲义.pdf"/>));

  const pageArea = container.querySelector('.pdf-canvas') as HTMLDivElement;
  await act(async () => pageArea.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(document.body.querySelector('.pdf-fullscreen')).toBeTruthy();
  expect(document.body.querySelector('button[aria-label="退出全屏阅读"]')).toBeTruthy();

  const fullscreenPageArea = document.body.querySelector('.pdf-fullscreen .pdf-canvas') as HTMLDivElement;
  await act(async () => fullscreenPageArea.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(document.body.querySelector('.pdf-fullscreen')).toBeNull();
});

it('jumps to a question page from the PDF navigation', async () => {
  await act(async () => root.render(<PdfPreview url="/sample.pdf" landmarks={[{ label: '第 6–9 题', page: 5 }]}/>));
  const button = container.querySelector('.pdf-landmarks button') as HTMLButtonElement;
  await act(async () => button.click());
  expect(button.getAttribute('aria-current')).toBe('page');
  expect(container.querySelector('canvas')?.getAttribute('aria-label')).toBe('原文件第 5 页');
});

it('uses slide navigation and labels for a presentation preview', async () => {
  await act(async () => root.render(<PdfPreview url="/slides.pdf" pageUnit="张幻灯片"/>));
  expect(container.querySelector('button[aria-label="上一张幻灯片"]')).toBeTruthy();
  expect(container.querySelector('button[aria-label="下一张幻灯片"]')).toBeTruthy();
  expect(container.querySelector('.pdf-tools')?.textContent).toContain('第 1 / 1 张幻灯片');
  expect(container.querySelector('canvas')?.getAttribute('aria-label')).toBe('原文件第 1 张幻灯片');
});
