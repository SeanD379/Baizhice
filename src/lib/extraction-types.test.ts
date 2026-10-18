import { it, expect } from 'vitest';
import { extractionSchema } from './extraction-types';
it('accepts and retains complete paragraph ranges and additive extraction metadata',()=>{
  const result={state:'complete',pageCount:93,sourceCount:93,durationMs:1,updatedAt:'now',continuation:{startSource:1,hasMore:false},pages:Array.from({length:93},(_,i)=>({page:i+1,text:'paragraph',method:'docx-text',state:'extracted',warnings:[],source:{kind:'paragraph',index:i+1,part:'word/document.xml'},blocks:[{type:'paragraph',sourceStart:i+1,sourceEnd:i+1,text:'paragraph'}]}))};
  const parsed=extractionSchema.safeParse(result);expect(parsed.success).toBe(true);
  if(parsed.success){expect(parsed.data.pages[92].source?.index).toBe(93);expect(parsed.data.continuation?.hasMore).toBe(false);}
});
