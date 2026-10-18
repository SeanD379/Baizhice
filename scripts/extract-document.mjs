import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { documentSegments, MIME } from './document-formats.mjs';
import { recognizeImage } from './document-ocr.mjs';
import { pdfTextLayout } from './pdf-layout.mjs';
const require=createRequire(import.meta.url);
// stdout is reserved for the structured result; library messages go to stderr.
console.log=(...args)=>console.error(...args);
const [file,mime,cursor='1']=process.argv.slice(2);
const startSource=Number(cursor);
const started=Date.now(),pages=[];
let partial=false,remaining=1000000,resultBytes=0,sourceCount=1;
const continuation={startSource,hasMore:false};
const ocrWarnings=['本机 OCR 结果未经人工校对；手写、公式、旋转或模糊照片可能识别错误。'];
function addPage(page){
  if(page.text.length>60000){page.text='';delete page.layout;delete page.blocks;page.state='needs-ocr';page.warnings.push('完整来源文字超过单段上限，未截取题目片段；请对照或拆分原文。');continuation.blockedSource??=page.page;partial=true;}
  const size=Buffer.byteLength(JSON.stringify(page.text)),serialized=Buffer.byteLength(JSON.stringify(page));
  if(size>remaining||resultBytes+serialized>1750000){
    partial=true;continuation.hasMore=true;continuation.nextSource=page.page;continuation.reason=size>remaining?'text-limit':'result-limit';
    if(!pages.length){page.text='';delete page.blocks;delete page.layout;page.state='needs-ocr';page.warnings.push('完整来源超过结果上限，请拆分原文；原文件保留。');continuation.blockedSource=page.page;continuation.nextSource=page.page+1;pages.push(page);}
    return false;
  }
  remaining-=size;resultBytes+=serialized;pages.push(page);return true;
}
function timeAvailable(number){if(Date.now()-started<180000)return true;partial=true;Object.assign(continuation,{hasMore:true,nextSource:number,reason:'time-limit'});return false;}
try{
  if(!Number.isInteger(startSource)||startSource<1)throw new Error('起始来源位置必须是正整数。');
  const bytes=await readFile(file);
  if(bytes.length>100*1024*1024)throw new Error('文件超过 100 MB，请拆分后上传。');
  if([MIME.docx,MIME.pptx,MIME.txt].includes(mime)){
    const parsed=documentSegments(bytes,mime,{startSource,deadline:started+180000}),{segments,hasMore}=parsed,method=mime===MIME.docx?'docx-text':mime===MIME.pptx?'pptx-text':'text';
    sourceCount=parsed.sourceCount;
    if(startSource>Math.max(1,sourceCount))throw new Error('起始来源位置超过原文范围。');
    if(!segments.length)segments.push({text:''});
    for(const [index,segment] of segments.entries()){
      const number=segment.source?.index??startSource+index;
      if(!timeAvailable(number))break;
      const warnings=method==='text'?[]:['按原文段落或幻灯片顺序提取；批注、页眉页脚及版式仍需对照原文。'];
      if(segment.error){warnings.push(segment.error);partial=true;}
      if(segment.truncated){warnings.push('完整来源文字超过单段上限，未截取题目片段；请对照或拆分原文。');continuation.blockedSource??=number;partial=true;}
      if(segment.numbering?.unsupported){warnings.push('此段自动编号格式未完整支持，请对照原文编号。');partial=true;}
      if(segment.blocks?.some(b=>['image','graphic'].includes(b.type))){warnings.push('图片或图形保留来源标记，图内文字尚未识别，请对照原文。');partial=true;}
      if(!addPage({page:number,text:segment.text,method,state:segment.truncated||segment.error?'needs-ocr':segment.text.trim()?'extracted':'empty',warnings,...(segment.source?{source:segment.source}:{}),...(segment.blocks?{blocks:segment.blocks}:{}),...(segment.numbering?{numbering:segment.numbering}:{})}))break;
    }
    if(hasMore&&!continuation.hasMore){partial=true;Object.assign(continuation,{hasMore:true,nextSource:parsed.nextSource??startSource+segments.length,reason:parsed.reason??'page-limit'});}
  }else if(mime===MIME.pdf){
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const root=path.dirname(require.resolve('pdfjs-dist/package.json')).replaceAll('\\','/');
    const task=pdfjs.getDocument({data:new Uint8Array(bytes),cMapUrl:root+'/cmaps/',cMapPacked:true,standardFontDataUrl:root+'/standard_fonts/',verbosity:0});
    try{
      const doc=await task.promise;
      sourceCount=doc.numPages;
      if(startSource>sourceCount)throw new Error('起始来源位置超过 PDF 页数。');
      const end=Math.min(doc.numPages,startSource+49);
      for(let number=startSource;number<=end;number++){
        if(!timeAvailable(number))break;
        let page;
        const result={page:number,text:'',method:'pdf-text',state:'needs-ocr',warnings:[],source:{kind:'page',index:number}};
        try{
          page=await doc.getPage(number);
          const content=await page.getTextContent();
          Object.assign(result,pdfTextLayout(content.items,page.getViewport({scale:1})));
          if(result.text){
            result.state='extracted';result.warnings.push('已按文字位置重建阅读顺序；复杂排版与公式仍需对照原文。');
            const operators=await page.getOperatorList();
            const graphics=new Set(['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','paintImageXObjectRepeat','paintImageMaskXObjectRepeat','paintSolidColorImageMask','constructPath','stroke','fill','eoFill','fillStroke'].map(key=>pdfjs.OPS[key]).filter(value=>value!==undefined));
            if(operators.fnArray.some(op=>graphics.has(op))){partial=true;result.blocks=[{type:'graphic',sourceStart:number,sourceEnd:number,marker:'[图形：请对照原文]'}];result.warnings.push('此页含图片或图形，文字层提取未识别图内内容。');}
          }
          else{
            const budget=180000-(Date.now()-started);
            if(budget<1000)throw new Error('扫描页 OCR 总时间预算已用尽，此页未识别；请拆分 PDF 后重试。');
            result.method='local-ocr';
            let canvas;
            try{
              const base=page.getViewport({scale:1});
              const scale=Math.min(2,Math.sqrt(4000000/(base.width*base.height)),4096/Math.max(base.width,base.height));
              const viewport=page.getViewport({scale});
              canvas=doc.canvasFactory.create(Math.ceil(viewport.width),Math.ceil(viewport.height));
              await page.render({canvasContext:canvas.context,viewport}).promise;
              const recognized=await recognizeImage(canvas.canvas.toBuffer('image/png'),Math.min(35000,budget));
              Object.assign(result,recognized);result.state=result.text?'extracted':'empty';if(!result.text)partial=true;
              result.warnings.push(...ocrWarnings);
              if(recognized.confidence<80)result.warnings.push('识别器信心偏低，请优先核对原文。');
            }finally{if(canvas)doc.canvasFactory.destroy(canvas);}
          }
        }catch(error){partial=true;result.warnings.push(`此页未完成提取：${error.message}`);}
        finally{page?.cleanup();}
        if(!addPage(result))break;
      }
      if(end<doc.numPages&&!continuation.hasMore){partial=true;Object.assign(continuation,{hasMore:true,nextSource:end+1,reason:'page-limit'});}
    }finally{await task.destroy();}
  }else if([MIME.png,MIME.jpg].includes(mime)){
    const data=await recognizeImage(bytes);
    if(startSource!==1)throw new Error('图片只有一个来源位置。');
    addPage({page:1,...data,source:{kind:'image',index:1},method:'local-ocr',state:data.text?'extracted':'empty',warnings:[...ocrWarnings,...(data.confidence<80?['识别器信心偏低，建议优先核对或上传更清晰的图片。']:[])]});
  }else throw new Error('暂不支持此文件格式。');
  if(!pages.length)pages.push({page:startSource,text:'',method:'text',state:'needs-ocr',warnings:['本轮时间预算已用尽，请从来源游标继续提取。']});
  const output={pages,pageCount:pages.length,sourceCount,continuation,state:!partial&&pages.every(page=>page.state==='extracted'||page.state==='empty')?'complete':'partial',durationMs:Date.now()-started,updatedAt:new Date().toISOString()};
  const json=JSON.stringify(output);
  if(Buffer.byteLength(json)>1800000)throw new Error('提取结果过长，请拆分文件。');
  process.stdout.write(json);
}catch(error){const message=error.name==='PasswordException'?'PDF 受密码保护，请解锁后重新上传。':error.name==='InvalidPDFException'?'PDF 结构损坏，无法提取文字。请重新导出文件后上传。':error.message;process.stdout.write(JSON.stringify({error:message}));process.exitCode=1;}
