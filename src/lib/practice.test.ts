import { describe, expect, it } from 'vitest';
import { gradeObjective, practiceQuestions, type Question } from './practice';
import type { Material, Version } from './types';
const material={id:'m',fixture:'conditional',status:'ready',excluded:false,name:'讲义'} as Material;
const version={sections:[{id:'conditional',needsReview:false}]} as Version;
describe('practice source and answer rules',()=>{
  it('requires review materials and eligible original sources',()=>{
    expect(practiceQuestions([material])).toEqual([]);
    expect(practiceQuestions([{...material,excluded:true}],version)).toEqual([]);
    expect(practiceQuestions([{...material,fixture:null}],version)).toEqual([]);
    expect(practiceQuestions([material],{...version,sections:[{...version.sections[0],needsReview:true}]})).toEqual([]);
    expect(practiceQuestions([material],version)).toHaveLength(2);
  });
  it('accepts equivalent fractions and stated decimal precision without evaluating code',()=>{
    const q=practiceQuestions([material],version)[1];
    for(const a of ['2/3','8 / 12','0.667','0.6667'])expect(gradeObjective(q,a)).toBe(true);
    for(const a of ['2/0','0.67','','2/3;alert(1)','1/2'])expect(gradeObjective(q,a)).toBe(false);
  });
  it('does not pretend to grade subjective answers',()=>expect(gradeObjective({kind:'short'} as Question,'任意回答')).toBeNull());
});
