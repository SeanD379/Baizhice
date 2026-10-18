// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PdfPreview from './pdf-preview';
import type { AnnotationStroke } from '@/lib/exam-record';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 11, getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    }) }),
    destroy: async () => undefined,
  }),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {},
  } as unknown as CanvasRenderingContext2D);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  canvas.dispatchEvent(event);
}

it('records ink on the current source page and erases the selected stroke', async () => {
  const onChange = vi.fn();
  let strokes: Record<string, AnnotationStroke[]> = {};
  await act(async () => root.render(<PdfPreview url="/exam.pdf" initialPage={8} annotations={strokes} onAnnotationsChange={onChange}/>));
  await vi.waitFor(() => expect(container.querySelector('.pdf-page-surface')?.getAttribute('style')).toContain('width: 240px'));
  const ink = container.querySelector('.pdf-ink-layer') as HTMLCanvasElement;
  vi.spyOn(ink, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 240, height: 320 } as DOMRect);
  ink.setPointerCapture = vi.fn();
  ink.hasPointerCapture = vi.fn(() => true);
  ink.releasePointerCapture = vi.fn();
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.pdf-annotation-tools button'));
  expect(container.querySelector('.pdf-annotation-settings')).toBeNull();
  await act(async () => buttons.find(button => button.textContent?.includes('画笔'))!.click());
  expect(container.querySelector('.pdf-annotation-settings')).not.toBeNull();
  expect(container.querySelectorAll('.pdf-annotation-settings .pdf-ink-colors button')).toHaveLength(3);
  expect(container.querySelector<HTMLInputElement>('input[aria-label="更多画笔颜色"]')).not.toBeNull();
  await act(async () => (container.querySelector<HTMLButtonElement>('button[aria-label="红色画笔"]')!).click());
  const width = container.querySelector<HTMLInputElement>('input[aria-label="画笔粗细"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(width, '6');
    width.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { pointer(ink, 'pointerdown', 60, 128); pointer(ink, 'pointermove', 80, 148); pointer(ink, 'pointerup', 80, 148); });
  expect(onChange).toHaveBeenCalledWith(8, expect.arrayContaining([expect.objectContaining({ tool: 'pen', color: '#c53b32', width: 6, points: expect.any(Array) })]));
  strokes = { '8': onChange.mock.lastCall![1] };
  await act(async () => root.render(<PdfPreview url="/exam.pdf" initialPage={8} annotations={strokes} onAnnotationsChange={onChange}/>));
  await act(async () => buttons.find(button => button.textContent?.includes('橡皮擦'))!.click());
  expect(container.querySelectorAll('.pdf-annotation-main button')).toHaveLength(5);
  expect(container.querySelector<HTMLInputElement>('input[aria-label="擦拭范围"]')).toBeNull();
  expect(container.querySelector<HTMLButtonElement>('.pdf-annotation-settings button[aria-pressed="true"]')?.textContent).toContain('整笔擦');
  await act(async () => { pointer(ink, 'pointerdown', 60, 128); pointer(ink, 'pointerup', 60, 128); });
  expect(onChange).toHaveBeenLastCalledWith(8, []);
});

it('offers highlighter presets and accepts a typed zoom percentage', async () => {
  await act(async () => root.render(<PdfPreview url="/exam.pdf" initialPage={8} annotations={{}} onAnnotationsChange={vi.fn()}/>));
  await vi.waitFor(() => expect(container.querySelector('.pdf-page-surface')?.getAttribute('style')).toContain('width: 240px'));
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('.pdf-annotation-tools button')).find(button => button.textContent?.includes('荧光笔'))!.click());
  expect(container.querySelectorAll('.pdf-annotation-settings .pdf-ink-colors button')).toHaveLength(3);
  expect(container.querySelector<HTMLInputElement>('input[aria-label="更多荧光笔颜色"]')).not.toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[aria-label="荧光笔粗细"]')?.value).toBe('18');
  const input = container.querySelector<HTMLInputElement>('input[aria-label="缩放比例（百分比）"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '135');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  await vi.waitFor(() => expect(input.value).toBe('135'));
  await vi.waitFor(() => expect(container.querySelector('.pdf-page-surface')?.getAttribute('style')).toContain('width: 324px'));
});

it('erases only the touched part of a stroke', async () => {
  const onChange = vi.fn();
  const stroke: AnnotationStroke = { tool: 'pen', color: '#c53b32', points: [[.1, .5], [.2, .5], [.3, .5], [.4, .5], [.5, .5]] };
  await act(async () => root.render(<PdfPreview url="/exam.pdf" initialPage={8} annotations={{ '8': [stroke] }} onAnnotationsChange={onChange}/>));
  await vi.waitFor(() => expect(container.querySelector('.pdf-page-surface')?.getAttribute('style')).toContain('width: 240px'));
  const ink = container.querySelector('.pdf-ink-layer') as HTMLCanvasElement;
  vi.spyOn(ink, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 240, height: 320 } as DOMRect);
  ink.setPointerCapture = vi.fn();
  ink.hasPointerCapture = vi.fn(() => true);
  ink.releasePointerCapture = vi.fn();
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('.pdf-annotation-main button')).find(button => button.textContent?.includes('橡皮擦'))!.click());
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('.pdf-annotation-settings button')).find(button => button.textContent?.includes('范围擦'))!.click());
  await act(async () => { pointer(ink, 'pointerdown', 72, 160); pointer(ink, 'pointerup', 72, 160); });
  expect(onChange).toHaveBeenLastCalledWith(8, [
    { ...stroke, points: [[.1, .5], [.2, .5]] },
    { ...stroke, points: [[.4, .5], [.5, .5]] },
  ]);
});

it('uses the chosen eraser size when sweeping across ink', async () => {
  const onChange = vi.fn();
  const stroke: AnnotationStroke = { tool: 'pen', color: '#c53b32', points: [[.3, .5]] };
  await act(async () => root.render(<PdfPreview url="/exam.pdf" initialPage={8} annotations={{ '8': [stroke] }} onAnnotationsChange={onChange}/>));
  await vi.waitFor(() => expect(container.querySelector('.pdf-page-surface')?.getAttribute('style')).toContain('width: 240px'));
  const ink = container.querySelector('.pdf-ink-layer') as HTMLCanvasElement;
  vi.spyOn(ink, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 240, height: 320 } as DOMRect);
  ink.setPointerCapture = vi.fn();
  ink.hasPointerCapture = vi.fn(() => true);
  ink.releasePointerCapture = vi.fn();
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('.pdf-annotation-main button')).find(button => button.textContent?.includes('橡皮擦'))!.click());
  expect(container.querySelector<HTMLInputElement>('input[aria-label="擦拭范围"]')).toBeNull();
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('.pdf-annotation-settings button')).find(button => button.textContent?.includes('范围擦'))!.click());
  const size = container.querySelector<HTMLInputElement>('input[aria-label="擦拭范围"]')!;
  await act(async () => pointer(ink, 'pointermove', 90, 160));
  expect(container.querySelector<HTMLElement>('.pdf-erase-cursor')?.style.width).toBe('32px');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(size, '8');
    size.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(size.value).toBe('8');
  expect(container.querySelector<HTMLElement>('.pdf-erase-cursor')?.style.width).toBe('8px');
  await act(async () => { pointer(ink, 'pointerdown', 90, 160); pointer(ink, 'pointerup', 90, 160); });
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(size, '48');
    size.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelector<HTMLElement>('.pdf-erase-cursor')?.style.width).toBe('48px');
  await act(async () => { pointer(ink, 'pointerdown', 90, 160); pointer(ink, 'pointerup', 90, 160); });
  expect(onChange).toHaveBeenLastCalledWith(8, []);
});

it('erases continuously between pointer events in range mode', async () => {
  const onChange = vi.fn();
  const stroke: AnnotationStroke = { tool: 'pen', color: '#c53b32', points: [[.3, .5]] };
  await act(async () => root.render(<PdfPreview url="/exam.pdf" initialPage={8} annotations={{ '8': [stroke] }} onAnnotationsChange={onChange}/>));
  await vi.waitFor(() => expect(container.querySelector('.pdf-page-surface')?.getAttribute('style')).toContain('width: 240px'));
  const ink = container.querySelector('.pdf-ink-layer') as HTMLCanvasElement;
  vi.spyOn(ink, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 240, height: 320 } as DOMRect);
  ink.setPointerCapture = vi.fn();
  ink.hasPointerCapture = vi.fn(() => true);
  ink.releasePointerCapture = vi.fn();
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('.pdf-annotation-main button')).find(button => button.textContent?.includes('橡皮擦'))!.click());
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('.pdf-annotation-settings button')).find(button => button.textContent?.includes('范围擦'))!.click());
  const size = container.querySelector<HTMLInputElement>('input[aria-label="擦拭范围"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(size, '8');
    size.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { pointer(ink, 'pointerdown', 24, 160); pointer(ink, 'pointermove', 120, 160); pointer(ink, 'pointerup', 120, 160); });
  expect(onChange).toHaveBeenLastCalledWith(8, []);
});
