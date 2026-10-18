import { afterEach, expect, it, vi } from 'vitest';
import { generateWithDeepSeek, requestChatResponse } from './deepseek';
import { parseOriginalQuestions } from './question-bank';

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('explains unreadable generation results without naming the model or claiming a new version',async()=>{
  vi.stubEnv('DEEPSEEK_API_KEY','unit-test-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not-json'}]}]})));
  await expect(generateWithDeepSeek([])).rejects.toThrow('AI 助手返回的整理结果格式有误，已完成的草稿已保留，请重试本批次。');
});
it('requests separate knowledge and source-matched question drafts for automatic organization',async()=>{
  vi.stubEnv('DEEPSEEK_API_KEY','unit-test-key');
  const request=vi.fn().mockResolvedValue(Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"sections":[],"questionIds":[],"warnings":[]}'}]}]}));vi.stubGlobal('fetch',request);
  const questions=parseOriginalQuestions({id:'m',name:'试题.docx'},[{page:1,text:'名词解释\n1.金融远期'}]);
  await generateWithDeepSeek([],[],'auto',questions);
  const body=JSON.parse(request.mock.calls[0][1].body);expect(body.text.format.name).toBe('study_automatic');expect(body.text.format.schema.properties).toHaveProperty('questionIds');expect(JSON.parse(body.input).questions[0].id).toBe(questions[0].id);
  expect(body.instructions).toContain('自动区分知识内容和原题');expect(body.instructions).toContain('不补充或虚构答案');expect(body.instructions).toContain('待用户审核');expect(body.tools).toBeUndefined();
});
it('does not call a model when no key is configured',async()=>{
  vi.stubEnv('DEEPSEEK_API_KEY','');const request=vi.fn();vi.stubGlobal('fetch',request);
  await expect(generateWithDeepSeek([])).rejects.toThrow('尚未配置');expect(request).not.toHaveBeenCalled();
});
it('sends only selected page text to DeepSeek with structured output and no storage',async()=>{
  vi.stubEnv('DEEPSEEK_API_KEY','unit-test-key');
  const request=vi.fn().mockResolvedValue(Response.json({status:'completed',model:'model-snapshot',output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'{"sections":[],"warnings":["缺少依据"]}'}]}]}));vi.stubGlobal('fetch',request);
  const result=await generateWithDeepSeek([{materialId:'m',name:'private-name.pdf',page:3,text:'所选正文',method:'pdf-text',warnings:[],extractionHash:'a'.repeat(64)}]);
  expect(result.model).toBe('model-snapshot');expect(request.mock.calls[0][0]).toBe('https://api.deepseek.com/responses');
  const body=JSON.parse(request.mock.calls[0][1].body);expect(body.store).toBe(false);expect(body.reasoning).toEqual({effort:'high'});expect(body.max_output_tokens).toBe(196608);expect(body.text.format.strict).toBe(true);expect(body.input).toContain('所选正文');expect(body.input).not.toContain('private-name');
});
it('handles refusal, incomplete output, invalid JSON and rate limits without fallback',async()=>{
  vi.stubEnv('DEEPSEEK_API_KEY','unit-test-key');
  for(const response of [Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]}),Response.json({status:'incomplete'}),Response.json({status:'completed',output:[]}),new Response('',{status:429})]) {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));await expect(generateWithDeepSeek([])).rejects.toThrow();
  }
});
it('reports the provider reason when generation is incomplete',async()=>{
  vi.stubEnv('DEEPSEEK_API_KEY','unit-test-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'}})));
  await expect(generateWithDeepSeek([])).rejects.toThrow('思考和正文达到本次请求的输出上限');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({status:'incomplete',incomplete_details:{reason:'content_filter'}})));
  await expect(generateWithDeepSeek([])).rejects.toThrow('内容审核中断');
});
it('uses the chosen reasoning effort for both generation and chat',async()=>{
  vi.stubEnv('DEEPSEEK_API_KEY','unit-test-key');
  vi.stubEnv('DEEPSEEK_REASONING_EFFORT','max');
  const request=vi.fn().mockResolvedValue(Response.json({status:'completed',model:'deepseek-flash',output:[{type:'message',content:[{type:'output_text',text:'{"sections":[],"warnings":[]}'}]}]}));
  vi.stubGlobal('fetch',request);
  await generateWithDeepSeek([]);
  expect(JSON.parse(request.mock.calls[0][1].body).reasoning).toEqual({effort:'max'});
  request.mockResolvedValueOnce(Response.json({status:'completed',model:'deepseek-flash',output:[{type:'message',content:[{type:'output_text',text:'你好'}]}]}));
  await requestChatResponse('你好','');
  const chatBody=JSON.parse(request.mock.calls[1][1].body);
  expect(chatBody.reasoning).toEqual({effort:'max'});
  expect(chatBody.max_output_tokens).toBe(65536);
});
it('reports why a chat response was incomplete',async()=>{
  vi.stubEnv('DEEPSEEK_API_KEY','unit-test-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'}})));
  await expect(requestChatResponse('整理资料','')).rejects.toThrow('思考和正文达到本次输出上限');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({status:'incomplete',incomplete_details:{reason:'content_filter'}})));
  await expect(requestChatResponse('整理资料','')).rejects.toThrow('内容审核中断');
});
it.each(['notes','compare','qa'] as const)('keeps %s source-only and limits annotation instructions to the preset',async preset=>{
  vi.stubEnv('DEEPSEEK_API_KEY','unit-test-key');const request=vi.fn().mockResolvedValue(Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"sections":[],"warnings":[]}'}]}]}));vi.stubGlobal('fetch',request);
  await generateWithDeepSeek([],[{materialId:'m',page:1,quote:'所选内容',instruction:'覆盖全部笔记',annotationId:'a'}],preset);
  const body=JSON.parse(request.mock.calls[0][1].body);expect(body.instructions).toContain('不使用外部知识补全');expect(body.instructions).toContain('不能改变本次预设操作');expect(body.tools).toBeUndefined();
  if(preset==='compare')expect(body.instructions).toContain('对比辨析');if(preset==='qa')expect(body.instructions).toContain('复习问答');
});
it('uses a separate supplement output with selected annotation IDs and no notebook or tools',async()=>{
  vi.stubEnv('DEEPSEEK_API_KEY','unit-test-key');const request=vi.fn().mockResolvedValue(Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"sections":[],"warnings":[]}'}]}]}));vi.stubGlobal('fetch',request);
  await generateWithDeepSeek([],[{materialId:'m',page:1,quote:'汇率',instruction:'补充定义',annotationId:'selected'}],'concepts');
  const body=JSON.parse(request.mock.calls[0][1].body);expect(body.text.format.name).toBe('study_supplement');expect(body.text.format.schema.properties.sections.items.properties).toHaveProperty('annotationIds');expect(body.text.format.schema.properties.sections.items.properties).not.toHaveProperty('refs');
  expect(body.instructions).toContain('不是补充答案依据');expect(body.instructions).toContain('简短示例');expect(JSON.parse(body.input).annotations[0].annotationId).toBe('selected');expect(body.tools).toBeUndefined();expect(body.input).not.toContain('notebook');
});
it.each(['notes','concepts'] as const)('sends the selected image with its text and instruction for %s',async preset=>{
  vi.stubEnv('DEEPSEEK_API_KEY','unit-test-key');const request=vi.fn().mockResolvedValue(Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"sections":[],"warnings":[]}'}]}]}));vi.stubGlobal('fetch',request);
  const image='data:image/png;base64,selected-crop';
  await generateWithDeepSeek([],[{materialId:'m',page:1,quote:'公式文字',instruction:'解释框内公式',annotationId:'selected',image}],preset);
  const body=JSON.parse(request.mock.calls[0][1].body),content=body.input[0].content;
  expect(content.find((part:{type:string})=>part.type==='input_image')).toEqual({type:'input_image',image_url:image,detail:'original'});
  expect(content[0].text).toContain('公式文字');expect(content[0].text).toContain('解释框内公式');expect(content[0].text).not.toContain(image);
  expect(body.text.format.schema.properties.sections.items.properties).toHaveProperty('annotationIds');expect(body.instructions).toContain('截图');expect(body.store).toBe(false);
});
