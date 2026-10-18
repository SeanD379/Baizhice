import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerFeedback } from './answer-feedback';

const props={courseId:'c',versionId:'v',setId:'set',questionId:'q',answer:'已保存的答案'};
afterEach(()=>vi.unstubAllGlobals());
it('renders explicit disclosure and consent without automatically sending an answer',()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const html=renderToStaticMarkup(<AnswerFeedback {...props}/>);
  expect(html).toContain('同意发送并获取 AI 反馈');
  expect(html).toContain('参考答案、自评要点和引用摘录发送给 AI 助手');expect(html).not.toContain('DeepSeek');
  expect(html).toContain('不会修改自评或练习记录');
  expect(html).toContain('不会保存');
  expect(fetch).not.toHaveBeenCalled();
});
it('explains unconfigured state and offers no send button',()=>{
  const html=renderToStaticMarkup(<AnswerFeedback {...props} configured={false}/>);
  expect(html).toContain('AI 答案反馈尚未启用');expect(html).not.toContain('<button');
});
it('disables consent for an empty answer',()=>{
  const html=renderToStaticMarkup(<AnswerFeedback {...props} answer="  "/>);
  expect(html).toMatch(/<button[^>]*disabled/);
});
