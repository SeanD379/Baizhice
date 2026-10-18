// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GenerationDialog } from './generation-dialog';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('action=list') ? { previews: [] } : { configured: false, model: '', pages: [{ materialId: 'paper-1', name: '试卷.pdf', page: 1, text: '题目文字', extractionHash: 'a'.repeat(64), method: 'pdf-text', warnings: [] }], unavailable: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('explains beside the disabled generate button when the AI assistant is not configured', async () => {
  await act(async () => root.render(<GenerationDialog courseId="high-school-chinese" expectedVersionId={null} onClose={() => undefined} onSaved={async () => undefined}/>));
  await vi.waitFor(() => expect(document.body.querySelector('.generation-blocker')?.textContent).toContain('未配置 AI 助手'));
  const generate = [...document.body.querySelectorAll('button')].find(button => button.textContent?.includes('生成待核对内容')) as HTMLButtonElement;
  expect(generate.disabled).toBe(true);
  expect(generate.getAttribute('aria-describedby')).toBe('generation-blocker');
  expect(document.body.querySelector('.generation-blocker button')?.textContent).toBe('查看配置方法');
});
it('shows complete Word questions instead of labeling paragraphs as independent pages', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('action=list') ? { previews: [] } : { configured: true, model: 'test', unavailable: [], pages: ['单选题', '1.下列属于长期信用工具的是？', 'A.普通股 B.支票', 'C.商业汇票 D.银行承兑汇票'].map((text, index) => ({ materialId: 'word', name: '练习.docx', page: index + 1, text, extractionHash: 'a'.repeat(64), method: 'docx-text', warnings: [] })) }))));
  await act(async () => root.render(<GenerationDialog courseId="course" expectedVersionId={null} onClose={() => undefined} onSaved={async () => undefined}/>));
  await vi.waitFor(() => expect(container.ownerDocument.body.textContent).toContain('长期信用工具'));
  expect(document.body.textContent).toContain('普通股');
  expect(document.body.textContent).toContain('银行承兑汇票');
  expect(document.body.textContent).not.toContain('第 3 页');
  expect(document.body.querySelectorAll('.generation-page > .generation-choice')).toHaveLength(1);
});
