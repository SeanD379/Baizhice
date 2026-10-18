import { describe, expect, it } from 'vitest';
import { applyEdits, generateSections, mergeAdditions, topicsForCourse } from './content';
import type { Material } from './types';
const material = (id: string, fixture: string | null, status='ready', excluded=false): Material => ({ id, fixture, status, excluded, name:id, courseId:'course', chapter:'test', mime:'application/pdf', size:100, origin:'test', createdAt:'2026-09-09' });
const inputs = [material('a','conditional'), material('b','independence'), material('c','note','review'), material('d','exercises')];
describe('generation boundaries', () => {
  it('does not use excluded or unselected sources', () => {
    const result=generateSections([...inputs.slice(0,2),material('c','note','review',true)],['a'],['conditional','independence']);
    expect(result).toHaveLength(1); expect(result[0].refs.map(r=>r.materialId)).toEqual(['a']);
  });
  it('rejects unresolved conflict, arbitrary uploads and empty scope', () => {
    expect(()=>generateSections(inputs,['a','c'],['conditional'])).toThrow('冲突');
    expect(()=>generateSections([material('x',null,'stored')],['x'],['conditional'])).toThrow('真实 AI');
    expect(()=>generateSections(inputs,['a'],['independence'])).toThrow('没有');
  });
  it('rejects IDs from a different course or excluded scope', () => {
    expect(()=>generateSections(inputs,['foreign'],['conditional'])).toThrow('范围');
    expect(()=>generateSections([material('a','conditional','ready',true)],['a'],['conditional'])).toThrow('范围');
  });
});
describe('editing and version updates', () => {
  it('keeps original snapshot unchanged and requires source recheck after editing', () => {
    const original=generateSections(inputs,['a','b'],['conditional','independence']);
    const changed=applyEdits(original,[{id:'conditional',body:'我的理解'}]);
    expect(original[0].body).not.toBe('我的理解'); expect(changed[0].needsReview).toBe(true); expect(changed[0].refs).toEqual(original[0].refs);
  });
  it('adds only the selected section while preserving edits and references', () => {
    const original=applyEdits(generateSections(inputs,['a','b'],['conditional','independence']),[{id:'conditional',body:'我的理解'}]);
    const candidates=generateSections(inputs,['a','b','d'],['conditional','independence']);
    const updated=mergeAdditions(original,candidates,['exercise-conditional']);
    expect(updated).toHaveLength(3); expect(updated.slice(0,2)).toEqual(original); expect(updated[2].id).toBe('exercise-conditional'); expect(original).toHaveLength(2);
  });
  it('rejects empty or repeated updates and no-op edits', () => {
    const original=generateSections(inputs,['a'],['conditional']);
    expect(()=>mergeAdditions(original,original,['conditional'])).toThrow('没有');
    expect(()=>applyEdits(original,[{id:'conditional',body:original[0].body}])).toThrow('没有变化');
  });
});
it('uses real extraction for the high school Chinese course while keeping math demonstration topics', () => {
  expect(topicsForCourse('high-school-chinese')).toEqual([]);
  expect(topicsForCourse('older-math-demo',[material('a','conditional')])).toEqual(['conditional','independence']);
});
