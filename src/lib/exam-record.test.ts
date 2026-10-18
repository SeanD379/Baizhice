import { describe, expect, it } from 'vitest';
import { emptyExamRecord, eraseAnnotationRange, eraseAnnotationStroke, examRecordSchema, wrongQuestionNumbers } from './exam-record';
import { examQuestionPage } from './exam-reading';
import { chineseExamInfo } from './content';

describe('套卷作答记录', () => {
  it('只把最近标为需巩固的题号列入错题本', () => {
    const record = emptyExamRecord();
    record.answers['17'] = '第（1）小题：……';
    record.marks = { '23': 'wrong', '17': 'wrong', '18': 'correct' };
    expect(wrongQuestionNumbers(record)).toEqual([17, 23]);
    record.marks['17'] = 'correct';
    expect(wrongQuestionNumbers(record)).toEqual([23]);
  });

  it('拒绝原卷范围外的题号和无效判定', () => {
    expect(examRecordSchema.safeParse({ answers: { '24': '答题' }, marks: {} }).success).toBe(false);
    expect(examRecordSchema.safeParse({ answers: {}, marks: { '17': 'unknown' } }).success).toBe(false);
    expect(examRecordSchema.safeParse({ answers: { '17': '按小问作答' }, marks: { '17': 'wrong' } }).success).toBe(true);
  });

  it('打开错题时跳到原卷所在页', () => {
    expect(examQuestionPage(chineseExamInfo['2023-new-i'].name, 17)).toBe(10);
    expect(examQuestionPage(chineseExamInfo['2024-new-i'].name, 17)).toBe(7);
    expect(examQuestionPage(chineseExamInfo['2024-new-ii'].name, 17)).toBe(8);
  });

  it('按页保存归一化笔迹，并能擦除命中的笔画', () => {
    const stroke = { tool: 'pen' as const, color: '#2864b4' as const, points: [[0.25, 0.4], [0.26, 0.4]] as [number, number][] };
    const parsed = examRecordSchema.parse({ answers: {}, marks: {}, annotations: { '8': [stroke] } });
    expect(parsed.annotations['8']).toHaveLength(1);
    expect(eraseAnnotationStroke(parsed.annotations['8'], 0.25, 0.4, 600, 800)).toEqual([]);
    expect(eraseAnnotationStroke(parsed.annotations['8'], 0.8, 0.8, 600, 800)).toHaveLength(1);
    expect(eraseAnnotationStroke(parsed.annotations['8'], 0.28, 0.4, 600, 800, 4)).toHaveLength(1);
    expect(eraseAnnotationStroke(parsed.annotations['8'], 0.28, 0.4, 600, 800, 24)).toEqual([]);
    expect(examRecordSchema.safeParse({ answers: {}, marks: {}, annotations: { '8': [{ ...stroke, points: [[1.5, 0.4]] }] } }).success).toBe(false);
    expect(examRecordSchema.safeParse({ answers: {}, marks: {}, annotations: { '8': [{ ...stroke, color: '#bb33aa' }] } }).success).toBe(true);
    expect(examRecordSchema.parse({ answers: {}, marks: {}, annotations: { '8': [{ ...stroke, width: 6 }] } }).annotations['8'][0].width).toBe(6);
    expect(examRecordSchema.safeParse({ answers: {}, marks: {}, annotations: { '8': [{ ...stroke, width: 0 }] } }).success).toBe(false);
  });

  it('范围擦只移除经过的笔迹，保留两侧笔画', () => {
    const stroke = { tool: 'pen' as const, color: '#1a1a1a', points: [[0.1, 0.5], [0.2, 0.5], [0.3, 0.5], [0.4, 0.5], [0.5, 0.5]] as [number, number][] };
    const result = eraseAnnotationRange([stroke], 0.3, 0.5, 500, 500, 10);
    expect(result.map(part => part.points)).toEqual([[[0.1, 0.5], [0.2, 0.5]], [[0.4, 0.5], [0.5, 0.5]]]);
    expect(eraseAnnotationRange([stroke], 0.9, 0.9, 500, 500)).toEqual([stroke]);
  });
});
