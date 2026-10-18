import { expect, it } from 'vitest';
import { conceptReferences, validateSupplementOutput } from './material-study';
import type { Reference } from './types';

const quote = '1.金融远期\n2.保本基金\n3.汇率\n8货币市场';
const refs: Reference[] = quote.split('\n').map((snippet, index) => ({ materialId: 'm', name: '练习题.docx', page: index + 2, location: 'paragraph', snippet, sourceHash: 'source', anchor: { quote, displayPage: 1, rects: [{ x: .1, y: .1, width: .2, height: .2 }] } }));

it('associates each concept with its own numbered question and narrows the text anchor', () => {
  for (const [index, title] of ['金融远期（AI 补充草稿）', '保本基金', '汇率', '货币市场'].entries()) {
    const sources = conceptReferences(title, refs);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ page: index + 2, snippet: refs[index].snippet, sourceHash: 'source', anchor: { quote: refs[index].snippet, displayPage: 1, rects: [] } });
  }
  expect(refs[0].anchor?.quote).toBe(quote);
  expect(refs[0].anchor?.rects).toHaveLength(1);
});

it('keeps both concepts for comparisons and all relevant sources across files', () => {
  expect(conceptReferences('金融远期与保本基金的区别', refs).map(ref => ref.snippet)).toEqual(['1.金融远期', '2.保本基金']);
  expect(conceptReferences('汇率', [...refs, { ...refs[2], materialId: 'second' }])).toHaveLength(2);
});

it('does not guess attribution for generic titles, explanatory text or image references', () => {
  expect(conceptReferences('概念解释', refs)).toEqual(refs);
  const explanation: Reference = { ...refs[0], snippet: '金融远期与保本基金是不同的金融工具，需结合使用条件辨析。' };
  const image: Reference = { ...refs[0], location: 'image', snippet: '图片选区' };
  expect(conceptReferences('金融远期', [explanation, image])).toEqual([explanation, image]);
});

it('resolves concept sources before generated sections are persisted without inventing citations', () => {
  const output = { sections: [{ title: '金融远期', body: '补充解释', annotationIds: ['a'] }], warnings: [] };
  expect(validateSupplementOutput(output, [{ id: 'a', refs }], 'test', 'draft', true).sections[0].refs).toHaveLength(1);
  expect(validateSupplementOutput(output, [{ id: 'a', refs }], 'test', 'draft').sections[0].refs).toEqual(refs);
});
