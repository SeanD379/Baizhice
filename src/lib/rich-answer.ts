export type AnswerFormat = 'paragraph' | 'list' | 'bold' | 'formula';
export function insertAnswerFormat(value: string, start: number, end: number, format: AnswerFormat, limit = 8000) {
  const selected = value.slice(start, end);
  const content = selected || (format === 'bold' ? '重点' : format === 'formula' ? 'P(A)' : format === 'list' ? '要点' : '新段落');
  const prefix = format === 'bold' ? '**' : format === 'formula' ? '$' : start && value[start - 1] !== '\n' ? '\n\n' : '';
  const body = format === 'list' ? content.split('\n').map(line => `- ${line}`).join('\n') : content;
  const suffix = format === 'bold' ? '**' : format === 'formula' ? '$' : end < value.length ? '\n\n' : '';
  const next = value.slice(0, start) + prefix + body + suffix + value.slice(end);
  if (next.length > limit) return null;
  return { value: next, start: start + prefix.length, end: start + prefix.length + body.length };
}
