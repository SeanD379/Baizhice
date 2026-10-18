import { expect, it } from 'vitest';
import { defaultLibraryFilters, filterLibraryMaterials, localDay, validateLibraryFilters } from './library-filters';
import type { Material } from './types';

const material = (id: string, name: string, size: number, createdAt: string, mime = 'application/pdf'): Material => ({ id, name, size, createdAt, mime, courseId: 'c', fixture: null, chapter: '', status: 'ready', excluded: false, origin: 'test' });
const materials = [
  material('a', '古诗.pdf', 1024, new Date(2026, 8, 27, 0).toISOString()),
  material('b', '阅读.docx', 2048, new Date(2026, 8, 28, 23, 59, 59).toISOString(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  material('c', '笔记.pdf', 3072, new Date(2026, 8, 29, 0).toISOString()),
];

it('combines type, inclusive size and local calendar date bounds', () => {
  const filters = { ...defaultLibraryFilters, unit: 'KB' as const, minSize: '1', maxSize: '2', fromDate: '2026-09-27', toDate: '2026-09-28', types: ['PDF', 'Word'] };
  expect(filterLibraryMaterials(materials, filters).map(m => m.id)).toEqual(['b', 'a']);
  expect(filterLibraryMaterials(materials, { ...filters, types: ['PDF'] }).map(m => m.id)).toEqual(['a']);
});

it('sorts size, dates and Chinese names in both directions without mutating input', () => {
  for (const sortBy of ['size', 'createdAt', 'name'] as const) {
    const ascending = filterLibraryMaterials(materials, { ...defaultLibraryFilters, sortBy, direction: 'asc' });
    const descending = filterLibraryMaterials(materials, { ...defaultLibraryFilters, sortBy, direction: 'desc' });
    expect(ascending.map(m => m.id)).toEqual(descending.map(m => m.id).reverse());
    if (sortBy === 'name') expect(ascending.map(m => m.name)).toEqual(materials.map(m => m.name).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })));
  }
  expect(materials.map(m => m.id)).toEqual(['a', 'b', 'c']);
});

it('rejects negative, non-finite, reversed and invalid ranges', () => {
  for (const patch of [{ minSize: '-1' }, { maxSize: 'Infinity' }, { minSize: '3', maxSize: '2' }, { fromDate: '2026-09-29', toDate: '2026-09-28' }, { fromDate: '2026-02-30' }]) {
    expect(validateLibraryFilters({ ...defaultLibraryFilters, ...patch })).toBeTruthy();
  }
  expect(validateLibraryFilters(defaultLibraryFilters)).toBe('');
  expect(localDay(new Date(2026, 8, 28, 23, 59))).toBe('2026-09-28');
});
