export const supportedFormats='PDF、PNG、JPG、DOCX、PPTX、TXT';
export function documentLabel(mime:string) {
  if(mime==='application/pdf')return 'PDF';
  if(mime.startsWith('image/'))return '图片';
  if(mime.includes('wordprocessingml'))return 'Word';
  if(mime.includes('presentationml'))return 'PPT';
  return '文字';
}
export function sourceLocation(name:string,page:number) {
  return /\.(docx|txt)$/i.test(name)?`第 ${page} 段`:/\.pptx$/i.test(name)?`第 ${page} 张幻灯片`:`第 ${page} 页`;
}
export function referenceLocation(reference: {name:string;page:number;location?:string}) {
  return reference.location === 'image' ? '原文件选定区域' : sourceLocation(reference.name, reference.page);
}
export function extractionLabel(method:string) {
  return method==='pdf-text'?'PDF 文字层':method==='local-ocr'?'本机 OCR':method==='docx-text'?'Word 段落':method==='pptx-text'?'幻灯片文字':'文档文字';
}
export function originalLinkLabel(name:string,page:number) {
  return /\.(docx|pptx|txt)$/i.test(name)?`打开原文件，对照${sourceLocation(name,page)}`:`打开${sourceLocation(name,page)}原文核对`;
}
