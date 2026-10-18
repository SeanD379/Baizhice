export const unreadableStudyResult='AI 助手返回的整理结果格式有误，已完成的草稿已保留，请重试本批次。';

export function aiAssistantText(text:string):string {
  return text.replace(/DeepSeek 返回了无法读取的内容，没有创建新版本，请重试。/gi,unreadableStudyResult).replace(/\b(?:deepseek(?:[-_.][a-z0-9]+)*|openai|gpt-[a-z0-9.-]+|claude(?:-[a-z0-9.-]+)?|gemini(?:-[a-z0-9.-]+)?)\b/gi,'AI 助手');
}
