import { describe, expect, it } from 'vitest';
import { buildNotebookPages } from './outline-notebook';
import type { Section } from '@/lib/types';

const section = (id: string, title: string, body: string): Section => ({ id, title, body, refs: [{ materialId: 'material-1', name: '讲义.pdf', page: 1, snippet: '依据' }] });

describe('buildNotebookPages', () => {
  it('starts every knowledge section on a new page and appends the coverage page', () => {
    const pages = buildNotebookPages([section('one', '知识点一', '短内容'), section('two', '知识点二', '另一段内容')], {}, 100);
    expect(pages.map(page => page.kind === 'section' ? page.sectionId : page.id)).toEqual(['one', 'two', 'coverage']);
  });

  it('creates continuation pages for long knowledge sections', () => {
    const pages = buildNotebookPages([section('long', '较长知识点', `第一段。\n\n${'内容'.repeat(80)}`)], {}, 60);
    const contentPages = pages.filter(page => page.kind === 'section');
    expect(contentPages.length).toBeGreaterThan(1);
    expect(contentPages[0]).toMatchObject({ continuation: 0, isLast: false });
    expect(contentPages.at(-1)).toMatchObject({ isLast: true });
  });

  it('uses the current draft when deriving pages', () => {
    const pages = buildNotebookPages([section('drafted', '草稿知识点', '原内容')], { drafted: '更新后的内容' }, 100);
    expect(pages[0]).toMatchObject({ kind: 'section', body: '更新后的内容' });
  });
});
