// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const pdf = vi.hoisted(() => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: vi.fn(() => ({ promise: new Promise(() => {}), destroy: async () => {} })) }));
vi.mock('pdfjs-dist', () => pdf);
beforeEach(() => { vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/baizhice'); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('loads login branding and the static artwork from the application path', async () => {
  const { LoginForm } = await import('./login-form');
  const html = renderToStaticMarkup(<LoginForm available/>);
  expect(html).toContain('src="/baizhice/brand/baizhice-symbol-blue.png"');
  expect(html).toContain('src="/baizhice/brand/login-book-poster.png"');
});
it('renders existing canonical notebook images under the application without rewriting stored nodes', async () => {
  const { NotebookContent } = await import('./notebook-content');
  const node = { type: 'image', attrs: { src: '/api/notebook-assets/abc-123.png', alt: 'notes' } };
  expect(renderToStaticMarkup(<NotebookContent node={node}/>)).toContain('src="/baizhice/api/notebook-assets/abc-123.png"');
  expect(node.attrs.src).toBe('/api/notebook-assets/abc-123.png');
});
it('loads PDF data and its worker from the application path', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const { default: PdfPreview } = await import('./pdf-preview');
  const container = document.createElement('div'), root = createRoot(container);
  try {
    await act(async () => root.render(<PdfPreview url="/api/files/pdf-one"/>));
    expect(pdf.GlobalWorkerOptions.workerSrc).toBe('/baizhice/pdf.worker.min.mjs');
    expect(pdf.getDocument).toHaveBeenCalledWith({ url: '/baizhice/api/files/pdf-one' });
  } finally { await act(async () => root.unmount()); }
});
