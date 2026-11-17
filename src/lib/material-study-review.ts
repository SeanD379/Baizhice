import type { MaterialStudyTask } from './material-study';

type StudyReviewWarning = { title: string; description: string };

export function studyQuestionCoverage(task: MaterialStudyTask, materialId: string) {
  if (task.routing !== 'auto' || !task.sourceQuestions?.length || task.withheld) return null;
  const questions = task.sourceQuestions.filter(question => question.materialId === materialId);
  if (!questions.length) return null;
  const included = new Set(task.sections.filter(section => section.refs.some(ref => ref.materialId === materialId)).map(section => section.question?.id));
  const missing = questions.filter(question => !included.has(question.id));
  return { total: questions.length, generated: questions.length - missing.length, missing };
}

export function studyReviewWarnings(task: MaterialStudyTask, materialId: string): StudyReviewWarning[] {
  if (task.withheld || !task.materialIds.includes(materialId)) return [];
  const sections = task.sections.filter(section => section.refs.some(ref => ref.materialId === materialId));
  const questions = sections.flatMap(section => section.question ? [section.question] : []);
  const notices: StudyReviewWarning[] = [];
  const ai = questions.filter(question => question.answerSource === 'ai' && question.answer.trim());
  if (ai.length) notices.push({ title: '草稿中有 AI 补充答案', description: '部分答案与解析由 AI 补充，已在题目中标注。' });
  const coverage = studyQuestionCoverage(task, materialId);
  if (coverage?.missing.length && !['queued', 'running'].includes(task.state)) {
    const reason=task.stale?'原文件或题目已变化，请重新整理。':/格式/.test(task.error)?'整理结果格式有误，后续批次未完成。可继续整理。':/超时|网络|连接/.test(task.error)?'网络请求未完成，可稍后继续整理。':task.error?'整理中断，后续批次未完成。可继续整理。':'部分题目未被本次整理采用，可重新整理。';
    notices.push({ title: `有 ${coverage.missing.length} 道已识别题目尚未进入草稿`, description: reason });
  }
  const incomplete = (task.sourceQuestions ?? questions).filter(question => question.materialId === materialId && question.warnings.some(warning => /题干.*不完整|选项.*(?:缺失|不完整)|提取存在/.test(warning)));
  if (incomplete.length) notices.push({ title: '部分题目的题干或选项需要补全', description: '题干或选项不完整，补全后再整理。' });
  if (task.warnings.some(warning => /提取不完整|未提取出文字|未识别出文字|文字识别失败/.test(warning))) notices.push({ title: '部分文字尚未识别完整', description: '原文件中有文字未识别完整，可重新提取文字。' });
  return notices;
}
