import { expect, it } from 'vitest';
import { collectedPracticeFiles, parsePracticeLocation, practiceLocation, type PracticeHubSummary } from './practice-hub';

const summary = { materials: [{ id: 'a', name: '同名.docx', available: true, status: 'extracted' }, { id: 'b', name: '同名.docx', available: true, status: 'extracted' }, { id: 'c', name: '未收录.docx', available: true, status: 'extracted' }], knowledge: [{ id: 'k', materialIds: ['a', 'a'], needsReview: false }, { id: 'draft', materialIds: ['b'], needsReview: true }], catalog: [{ ref: { engine: 'original', materialId: 'a' }, section: 'knowledge', available: true, collected: true }, { ref: { engine: 'original', materialId: 'b' }, section: 'knowledge', available: true, collected: true }, { ref: { engine: 'original', materialId: 'c' }, section: 'knowledge', available: true, collected: false }] } as unknown as PracticeHubSummary;
it('groups only collected current content by file identity and keeps equal filenames distinct', () => {
  const files = collectedPracticeFiles(summary);
  expect(files.map(file => [file.material.id, file.knowledge.length, file.questions.length])).toEqual([['a', 1, 1], ['b', 0, 1]]);
});
it('omits unavailable files and stale questions rather than exposing a draft as collected content', () => {
  expect(collectedPracticeFiles({ ...summary, materials: summary.materials.map(material => ({ ...material, available: false })) })).toEqual([]);
  expect(collectedPracticeFiles({ ...summary, knowledge: [], catalog: summary.catalog.map(question => ({ ...question, available: false })) })).toEqual([]);
});
it('roundtrips the file page and return path from a practice round', () => {
  for (const location of [{ section: 'knowledge', activity: 'file', materialId: 'a' }, { section: 'knowledge', activity: 'practice', materialId: 'a', scope: 'round', fromFile: true }] as const) {
    expect(parsePracticeLocation(new URLSearchParams(practiceLocation('course', location).split('?')[1]))).toEqual(location);
  }
});
