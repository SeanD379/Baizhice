import { describe, expect, it } from 'vitest';
import { groupDocumentPages, gradeOriginal, parseOriginalQuestions } from './question-bank';
import pdfExams from './fixtures/original-pdf-exams.json';
import type { OriginalQuestion } from './question-bank-types';
const material = { id: 'material-a', name: '练习.docx' };
it('recognizes indefinite selection headings and prompts as multi-answer questions',()=>{
  const heading=parseOriginalQuestions(material,[{page:1,text:'不定项选择题\n1.选择正确的项目。\nA.甲 B.乙 C.丙',method:'docx-text'}]);
  const prompt=parseOriginalQuestions(material,[{page:1,text:'1.下列说法正确的是（不定项选择）。\nA.甲 B.乙 C.丙',method:'docx-text'}]);
  expect(heading[0]?.kind).toBe('multiple');expect(prompt[0]?.kind).toBe('multiple');
});
const parts = (text: string[]) => text.map((text, index) => ({ page: index + 1, text, method: 'docx-text' }));
describe('original question integration', () => {
  it('keeps stems and split options together and does not import headings as questions', () => {
    const questions = parseOriginalQuestions(material, parts(['单选题', '1.下列工具属于长期信用工具的是？', 'A．普通股 B．支票', 'C．商业汇票', 'D．银行承兑汇票', '2.下列工具流动性最高的是？', 'A.现金 B.房屋']));
    expect(questions).toHaveLength(2);
    expect(questions[0].options).toEqual([{ label: 'A', text: '普通股' }, { label: 'B', text: '支票' }, { label: 'C', text: '商业汇票' }, { label: 'D', text: '银行承兑汇票' }]);
    expect(questions[0].sources.map(source => source.page)).toEqual([2, 3, 4, 5]);
    expect(questions[0].kind).toBe('single');
    expect(questions[0].answerSource).toBe('none');
  });
  it('keeps repeated numbers in sections independent and supports multiple choice and judgement', () => {
    const questions = parseOriginalQuestions(material, parts(['单选题', '1.选择最佳选项。', 'A.甲 B.乙', '多选题', '1.选择所有正确选项。', 'A.甲 B.乙 C.丙', '判断题', '1.初级市场是证券发行市场。（ ）']));
    expect(questions.map(question => question.kind)).toEqual(['single', 'multiple', 'judge']);
    expect(new Set(questions.map(question => question.id)).size).toBe(3);
  });
  it('keeps passage context and small subquestions across source pages', () => {
    const questions = parseOriginalQuestions({ id: 'pdf-a', name: '阅读.pdf' }, [{ page: 1, text: '阅读下面材料，回答问题。\n这是需要共用的阅读材料。\n1.下列说法正确的是？\nA.甲\nB.乙', method: 'pdf-text' }, { page: 2, text: 'C.丙\nD.丁\n2.简述材料观点。\n（1）说明原因。\n（2）提出建议。', method: 'pdf-text' }]);
    expect(questions).toHaveLength(2);
    expect(questions[0].options).toHaveLength(4);
    expect(questions[1].context).toContain('这是需要共用的阅读材料');
    expect(questions[1].prompt).toContain('（2）提出建议');
    expect(questions[0].sources.map(source => source.page)).toEqual([1, 2]);
  });
  it('supports term questions with imperfect numbering without turning ordinary notes into questions', () => {
    expect(parseOriginalQuestions(material, parts(['名词解释', '1.金融远期', '2.保本基金', '3汇率'])).map(question => question.kind)).toEqual(['term', 'term', 'term']);
    expect(parseOriginalQuestions(material, parts(['第一章 金融市场', '1.市场概述', '市场由交易者组成。', '2.市场分类', '按期限划分为货币市场和资本市场。']))).toEqual([]);
  });
  it('associates separately placed answers with the correct section and question', () => {
    const questions = parseOriginalQuestions(material, parts(['单选题', '1.请选择。', 'A.甲 B.乙', '2.请选择。', 'A.丙 B.丁', '参考答案', '1.B 2.A']));
    expect(questions.map(question => question.answer)).toEqual(['B', 'A']);
    expect(questions.every(question => question.answerSource === 'original')).toBe(true);
    expect(questions).toHaveLength(2);
  });
  it('groups review content by whole questions or headings while preserving raw source positions', () => {
    const source = parts(['单选题', '1.请选择。', 'A.甲 B.乙', '2.请选择。', 'A.丙 B.丁']);
    const groups = groupDocumentPages(source);
    expect(groups.filter(group => group.kind === 'question')).toHaveLength(2);
    expect(groups.find(group => group.kind === 'question')?.pages.map(page => page.page)).toEqual([2, 3]);
    expect(source.map(page => page.page)).toEqual([1, 2, 3, 4, 5]);
  });
  it('keeps lecture text out of exercises and includes passage provenance and media', () => {
    const source=parts(['第一章 概念讲解','1.市场概述','介绍市场的组成。','阅读下面材料，回答问题。','材料包含图示。','1.分析材料中的关系。','（1）说明依据。','第二章 概念讲解','2.概念分类','这些是讲义正文。','例题1：计算 2+3。','答案：5','解析：相加得5。']);
    const questions=parseOriginalQuestions(material,source);
    expect(questions).toHaveLength(2);
    expect(questions[0].context).not.toContain('市场概述');
    expect(questions[0].prompt).not.toContain('第二章');
    expect(questions[0].sources.map(s=>s.page)).toEqual([4,5,6,7]);
    expect(questions[1].answer).toBe('5');expect(questions[1].explanation).toBe('相加得5。');
  });
  it('does not label a numbered lecture heading as a question',()=>{
    const groups=groupDocumentPages(parts(['第一章 金融市场','1.市场概述','这里是讲义正文。']));
    expect(groups.map(group=>group.title).join(' ')).not.toContain('第 1 题');
  });
  it('recognizes an explicit lecture title without a chapter number while retaining the actual exercises',()=>{
    const source=parts(['金融市场讲义','1.分析市场的组成','市场由交易者和金融工具组成。','2.说明市场的分类','市场可以按期限分类。','例题1：简述长期工具的特征。']);
    expect(parseOriginalQuestions(material,source).map(question=>question.prompt)).toEqual(['简述长期工具的特征。']);
    expect(groupDocumentPages(source).filter(group=>group.kind==='question').map(group=>group.pages[0].page)).toEqual([6]);
  });
  it('keeps standalone example answers local and continues to the next example',()=>{
    const source=parts(['第一章 加法讲义','例题1：计算 2+3。','答案','5','解析：相加得5。','例题2：计算 3+4。','答案','7','第二章 概念讲义','1.市场概述','介绍市场组成。']);
    const questions=parseOriginalQuestions(material,source);
    expect(questions.map(q=>q.number)).toEqual(['1','2']);
    expect(questions.map(q=>q.answer)).toEqual(['5','7']);
    expect(questions.map(q=>q.answerSource)).toEqual(['original','original']);
    expect(questions[0].explanation).toBe('相加得5。');
    expect(questions[1].sources.map(s=>s.page)).toEqual([6,7,8]);
    expect(questions[1].prompt).not.toContain('答案');
  });
  it('preserves an original answer over multiple paragraphs before its explanation',()=>{
    const questions=parseOriginalQuestions(material,parts(['简答题','1.请阐述第一理论。','答案：第一点说明。','第二点说明。','解析：要综合两点。','2.请阐述第二理论。']));
    expect(questions[0].answer).toBe('第一点说明。\n第二点说明。');expect(questions[0].explanation).toBe('要综合两点。');
    expect(questions[0].sources.map(source=>source.page)).toEqual([2,3,4,5]);expect(questions[1].answerSource).toBe('none');
  });
  it('retains numbered subjective answer subpoints until an explicit next question label',()=>{
    const source=parts(['简答题','1.简述第一材料。','2.简述第二材料。','参考答案','1.第一材料的整体观点。','1.第一材料的原因。','2.第一材料的影响。','第2题参考答案：第二材料的整体观点。','1.第二材料的原因。','2.第二材料的影响。']);
    const questions=parseOriginalQuestions(material,source);
    expect(questions).toHaveLength(2);
    expect(questions[0].answer).toBe('第一材料的整体观点。\n1.第一材料的原因。\n2.第一材料的影响。');
    expect(questions[1].answer).toBe('第二材料的整体观点。\n1.第二材料的原因。\n2.第二材料的影响。');
    expect(questions[0].sources.map(s=>s.page)).toEqual([2,5,6,7]);
    expect(questions[1].sources.map(s=>s.page)).toEqual([3,8,9,10]);
  });
  it('leaves ambiguous nested answer numbering pending instead of assigning one answer to two questions',()=>{
    const questions=parseOriginalQuestions(material,parts(['简答题','1.简述第一理论。','2.简述第二理论。','参考答案','1.第一理论的要点：','1.条件甲。','2.条件乙。','2.第二理论的完整回答。']));
    expect(questions.every(q=>q.answerSource==='none')).toBe(true);
    expect(questions.every(q=>q.warnings.some(w=>w.includes('答案编号')))).toBe(true);
  });
  it('keeps declarative lecture headings out while preserving explicit examples, questions and options',()=>{
    const source=parts(['第一章 市场讲义','1.分析市场的组成','市场由交易者组成。','2.说明市场的分类','可按期限分类。','例题1：简述债券的作用。','2.市场为何需要中介？','3.请选择长期工具。','A.股票 B.支票']);
    const questions=parseOriginalQuestions(material,source);
    expect(questions.map(q=>q.prompt)).toEqual(['简述债券的作用。','市场为何需要中介？','请选择长期工具。']);
    const groups=groupDocumentPages(source);
    expect(groups.filter(g=>g.kind==='question').map(g=>g.pages[0].page)).toEqual([6,7,8]);
    expect(groups.flatMap(g=>g.pages.map(p=>p.page))).toEqual(source.map(p=>p.page));
    expect(groups.filter(g=>g.kind==='content').map(g=>g.text).join('\n')).toContain('分析市场的组成');
    expect(groups.filter(g=>g.kind==='content').map(g=>g.text).join('\n')).toContain('说明市场的分类');
  });
});
describe('reference answer grading', () => {
  const question = (kind: OriginalQuestion['kind'], answer: string): OriginalQuestion => ({ id: 'q', materialId: 'm', number: '1', section: '', kind, prompt: '题目', context: '', options: [{ label: 'A', text: '甲' }, { label: 'B', text: '乙' }, { label: 'C', text: '丙' }], sources: [], topics: [], answer, answerSource: 'ai', explanation: '', criteria: [], warnings: [], origin: 'original' });
  it('matches multiple choice by complete sets without order or punctuation dependence', () => {
    expect(gradeOriginal(question('multiple', 'AC'), 'C,A')).toBe(true);
    expect(gradeOriginal(question('multiple', 'AC'), 'A')).toBe(false);
  });
  it('normalizes judgement and numeric fill answers but leaves unconfirmed answers pending', () => {
    expect(gradeOriginal(question('judge', '正确'), '对')).toBe(true);
    expect(gradeOriginal(question('fill', '1/2'), '0.5')).toBe(true);
    expect(gradeOriginal(question('term', '参考概念'), '我的概念')).toBeNull();
    expect(gradeOriginal(question('single', ''), 'A')).toBeNull();
    expect(gradeOriginal(question('fill', '金融远期'), '远期合约')).toBeNull();
  });
  it('does not infer a choice label from arbitrary words in an unconfirmed reference',()=>{
    expect(gradeOriginal(question('single','需要老师核对 BAD'), 'B')).toBeNull();
    expect(gradeOriginal(question('multiple','AD'), 'A')).toBeNull();
  });
});

describe('saved PDF exam regressions', () => {
  for (const exam of pdfExams) it('preserves all questions and shared sources in '+exam.id, () => {
    const questions=parseOriginalQuestions(exam,exam.pages);
    expect(questions.map(question=>question.number)).toEqual(Array.from({length:23},(_,i)=>String(i+1)));
    expect(questions[0].prompt).not.toContain('答题卡');
    expect(questions.find(question=>question.number==='13')?.prompt).toMatch(/[（(]\s*2\s*[）)]/);
    expect(questions.find(question=>question.number==='17')?.kind).toBe('fill');
    const first=questions[0];
    expect(first.sources[0].page).toBe(1);
    expect(first.context).toContain('阅读');
    expect(questions.find(question=>question.number==='5')?.context).toBe(first.context);
    if(exam.id==='cmufs0by70003pcw0nin4rhhq') {
      expect(first.context).toContain('（四五）中国由劣势');
      expect(first.context).toContain('材料二');
      expect(questions.find(question=>question.number==='18')?.context).toContain('电量已经触底');
      expect(questions.find(question=>question.number==='18')?.sources.map(s=>s.page)).toEqual([7,8,10]);
      expect(questions.slice(0,3).map(question=>question.answer)).toEqual(['B','A','D']);
      expect(questions.find(question=>question.number==='10')?.answer).toBe('ADF');
      expect(questions.find(question=>question.number==='13')?.answer).toContain('我愿意亲自率领');
      expect(questions.find(question=>question.number==='17')?.answer).toContain('其称文小而其指极大');
      expect(questions.find(question=>question.number==='19')?.answer).toContain('因人而异');
      expect(questions.find(question=>question.number==='23')?.answer).toContain('无极之外仍是无极');
      expect(questions.every(question=>question.answerSource==='original')).toBe(true);
      expect(first.sources.at(-1)?.page).toBe(9);
      expect(questions.find(question=>question.number==='23')?.sources.map(s=>s.page)).toContain(11);
    } else expect(questions.every(question=>question.answerSource==='none')).toBe(true);
    if(exam.id==='cmufs0cx50005pcw0cmlbdva1')expect(first.context).toContain('材料三');
  });
  it('joins spaced numbering and punctuation across raw sources without splitting subquestions',()=>{
    const questions=parseOriginalQuestions(material,parts(['阅读下面材料，完成9～10题。','材料甲。','9','．','请谈谈你的理解。','（1）理由。','（2）举例。','1 0 .','把句子译成现代汉语。']));
    expect(questions.map(q=>q.number)).toEqual(['9','10']);
    expect(questions[0].sources.map(s=>s.page)).toEqual([1,2,3,4,5,6,7]);
    expect(questions[0].sources.find(s=>s.page===3)?.snippet).toBe('9');
    expect(questions[0].sources.find(s=>s.page===4)?.snippet).toBe('．');
    expect(questions[0].prompt).toBe('请谈谈你的理解。\n（1）理由。\n（2）举例。');
    expect(questions[0].prompt).toContain('（2）举例。');
  });
  it('does not adopt ambiguous repeated-number subjective answer keys',()=>{
    const questions=parseOriginalQuestions(material,parts(['简答题','1.简述第一材料。','简答题','1.简述第二材料。','参考答案','1.这是无法确定归属的回答。']));
    expect(questions).toHaveLength(2);
    expect(questions.every(q=>q.answerSource==='none')).toBe(true);
  });
});
