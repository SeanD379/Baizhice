import { expect, it } from 'vitest';
import { studyQuestionCoverage, studyReviewWarnings } from './material-study-review';
import type { MaterialStudyTask } from './material-study';
import type { OriginalQuestion } from './question-bank-types';

const question = (number: string, page: number, patch: Partial<OriginalQuestion> = {}): OriginalQuestion => ({ id: `q${number}`, materialId: 'm', number, section: '单选题', kind: 'single', prompt: `题目${number}的完整题干`, context: '', options: [], sources: [{ name: '练习题.docx', page, location: 'paragraph', snippet: `题目${number}的完整题干` }], topics: [], answer: '', answerSource: 'none', explanation: '', criteria: [], warnings: [], origin: 'original', ...patch });
const first = question('1', 2, { prompt: '居民将一定的现金存入活期存款', answer: 'B', answerSource: 'ai' });
const second = question('2', 4, { prompt: '通常情况下，当市场利率低于息票率时，发债企业多采用' });
const eighth = question('8', 19, { prompt: '按照投资风格进行划分，投资基金可以分为', sources: [19, 20, 21].map(page => ({ name: '练习题.docx', page, location: 'paragraph', snippet: page === 21 ? 'C.股票基金和债券基金 D.成长型基金和收入型基金' : '按照投资风格进行划分，投资基金可以分为' })) });
const sourceQuestions = [first, second, eighth, question('18', 40)];
const warnings = ['题1（p2 题干、p3 选项）候选条目带有的 answer「B」标注 answerSource 为 ai，属机器生成答案，并非所选页原文内容。', '所选页均为练习题题干和选项，未包含知识讲解、答案或解析，sections 返回空。', 'page 21 仅有选项片段，没有对应题干，需核对前后页。', '练习题.docx 第 21 段未被本次候选引用，请单独核对是否遗漏。'];
const task = (patch: Partial<MaterialStudyTask> = {}): MaterialStudyTask => ({ id: 't', courseId: 'c', revision: 1, mode: 'material', routing: 'auto', materialIds: ['m'], annotationIds: [], state: 'partial', done: 2, total: 5, sections: [first, second, eighth].map(q => ({ id: `section-${q.id}`, title: `单选题 ${q.number}`, body: q.prompt, question: q, refs: q.sources.map(source => ({ ...source, materialId: 'm' })), review: 'pending' })), sourceQuestions, warnings, error: '本批次整理中断', createdAt: '', updatedAt: '', ...patch });

it('uses the actual saved answer source and never turns p2 into question 2', () => {
  const notice = studyReviewWarnings(task(), 'm').find(item => item.title === '草稿中有 AI 补充答案')!;
  expect(notice).not.toHaveProperty('items');
  expect(notice.description).toBe('部分答案与解析由 AI 补充，已在题目中标注。');
});

it('counts only identified questions absent from the current draft, not unused source blocks', () => {
  expect(studyQuestionCoverage(task(), 'm')).toMatchObject({ total: 4, generated: 3, missing: [{ id: 'q18' }] });
  const notices = studyReviewWarnings(task(), 'm');
  const missing = notices.find(item => item.title === '有 1 道已识别题目尚未进入草稿')!;
  expect(missing).not.toHaveProperty('items');
  expect(missing.description).toContain('整理中断');
  expect(JSON.stringify(notices)).not.toMatch(/原文位置|第\s*21\s*段|第\s*8\s*题|未被草稿引用|未生成知识点/);
});

it('does not request a knowledge note, an answer, or an unspecified check for a question-only file', () => {
  const complete = task({ state: 'ready', sections: task().sections.slice(1), sourceQuestions: [second, eighth], error: '', done: 5 });
  expect(studyReviewWarnings(complete, 'm')).toEqual([]);
  expect(studyQuestionCoverage(complete, 'm')).toMatchObject({ total: 2, generated: 2, missing: [] });
});

it('does not trust AI warning prose as proof of an AI answer in a saved draft', () => {
  const plain = task({ sections: task().sections.slice(1), sourceQuestions: [second, eighth], warnings: ['第2题 answerSource 为 ai；section 为空。'], state: 'ready', error: '' });
  expect(studyReviewWarnings(plain, 'm')).toEqual([]);
});

it('does not repeat question lists for AI answers in PDFs either', () => {
  const pdfQuestion = question('2', 3, { answer: 'B', answerSource: 'ai', sources: [{ name: '试卷.pdf', page: 3, location: 'page', snippet: '通常情况下，当市场利率低于息票率时' }] });
  const pdfTask = task({ sections: [{ ...task().sections[0], question: pdfQuestion }], sourceQuestions: [pdfQuestion] });
  expect(studyReviewWarnings(pdfTask, 'm')[0]).not.toHaveProperty('items');
});

it('keeps material scope and does not invent total coverage for old records without snapshots', () => {
  expect(studyQuestionCoverage(task({ sourceQuestions: undefined }), 'm')).toBeNull();
  expect(studyReviewWarnings(task(), 'another-file')).toEqual([]);
  expect(studyReviewWarnings(task({ withheld: true, sections: [], sourceQuestions: [] }), 'm')).toEqual([]);
});

it('retains actionable extraction problems without internal paragraph numbers', () => {
  const notice = studyReviewWarnings(task({ sections: [], sourceQuestions: [], warnings: ['练习题.docx：提取不完整，请检查未识别位置。'] }), 'm')[0];
  expect(notice.title).toBe('部分文字尚未识别完整');
  expect(notice.description).toContain('重新提取文字');
  expect(notice).not.toHaveProperty('items');
});
