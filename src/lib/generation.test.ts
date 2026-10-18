import { describe, expect, it } from 'vitest';
import { validatePages, validateOutput, type SourcePage } from './generation';
import { applyEdits, mergeAdditions } from './content';

const source: SourcePage = { materialId:'m', name:'课程.pdf', page:2, text:'条件概率的定义为 P(B|A)=P(A∩B)/P(A)，要求 P(A)>0。', extractionHash:'a'.repeat(64), method:'pdf-text', warnings:[] };
const output = { sections:[{title:'条件概率',body:'使用公式时必须满足 $P(A)>0$。',refs:[{materialId:'m',page:2,snippet:'要求 P(A)>0。'}]}], warnings:[] };

describe('real material boundaries', () => {
  it('accepts reviewed text and preserves page identity', () => {
    const pages=validatePages([{...source,text:'用户已修正的正文'}],[source]);
    expect(pages[0].text).toBe('用户已修正的正文'); expect(pages[0].page).toBe(2);
    expect(source.text).toContain('条件概率');
  });
  it('rejects unavailable, foreign, duplicate and stale pages', () => {
    expect(()=>validatePages([source],[])).toThrow('范围');
    expect(()=>validatePages([{...source,page:1}],[source])).toThrow('范围');
    expect(()=>validatePages([source,source],[source])).toThrow('重复');
    expect(()=>validatePages([{...source,extractionHash:'b'.repeat(64)}],[source])).toThrow('重新识别');
  });
  it('refuses empty and oversized input instead of silently truncating', () => {
    expect(()=>validatePages([{...source,text:' '}],[source])).toThrow();
    expect(()=>validatePages([{...source,text:'文'.repeat(40001)}],[source])).toThrow();
  });
  it('checks quotes against the selected original page and marks output for review', () => {
    const result=validateOutput(output,[source],'gpt-5-mini','draft');
    expect(result.sections[0].refs[0]).toMatchObject({name:'课程.pdf',page:2,snippet:'要求 P(A)>0。'});
    expect(result.sections[0].needsReview).toBe(true);
    expect(result.sections[0].generation?.draftId).toBe('draft');
  });
  it('rejects invented page, quote, foreign source or missing references', () => {
    for(const ref of [{materialId:'m',page:1,snippet:'要求 P(A)>0。'},{materialId:'foreign',page:2,snippet:'要求 P(A)>0。'},{materialId:'m',page:2,snippet:'P(A)=0'}]) {
      expect(()=>validateOutput({...output,sections:[{...output.sections[0],refs:[ref]}]},[source],'model','draft')).toThrow('引用');
    }
    expect(()=>validateOutput({...output,sections:[{...output.sections[0],refs:[]}]},[source],'model','draft')).toThrow();
  });
  it('appends chosen generated sections while preserving edited content and snapshots', () => {
    const original=validateOutput(output,[source],'model','first').sections;
    const edited=applyEdits(original,[{id:original[0].id,body:'我的理解'}]);
    const candidates=validateOutput({...output,sections:[{...output.sections[0],title:'新的补充'}]},[source],'model','second').sections;
    const merged=mergeAdditions(edited,candidates,[candidates[0].id]);
    expect(merged[0]).toEqual(edited[0]); expect(original[0].body).not.toBe('我的理解'); expect(merged).toHaveLength(2);
  });
});
