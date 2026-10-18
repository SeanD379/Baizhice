import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { docxFixture,pptxFixture } from './document-fixtures.mjs';
import { MIME } from './document-formats.mjs';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { recognizeImage } from './document-ocr.mjs';
const exec=promisify(execFile);
const directory=path.resolve('tmp/extraction-tests');
await mkdir(directory,{recursive:true});
function pdf(pages,graphics=''){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  pages.forEach((text,i)=>{const content=(text?`BT /F1 16 Tf 30 700 Td (${text}) Tj ET`:'')+graphics;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);});
  let output='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return output;
}
async function extract(file,mime){const {stdout}=await exec(process.execPath,['scripts/extract-document.mjs',file,mime],{timeout:220000,maxBuffer:2*1024*1024,windowsHide:true});return JSON.parse(stdout);}
test('Chinese PDF text is extracted from actual bytes',async()=>{const result=await extract('assets/samples/conditional.pdf','application/pdf');assert(result.pages[0].text.includes('条件概率'));assert(result.pages[0].text.includes('8/12 = 2/3'));assert.equal(result.pages[0].method,'pdf-text');});
test('page numbers and blank OCR pages remain visible',async()=>{const file=path.join(directory,'three-pages.pdf');await writeFile(file,pdf(['PAGE_ONE','PAGE_TWO','']));const result=await extract(file,'application/pdf');assert.equal(result.pageCount,3);assert.equal(result.state,'partial');assert(result.pages[1].text.includes('PAGE_TWO'));assert.equal(result.pages[1].page,2);assert.equal(result.pages[2].method,'local-ocr');assert.equal(result.pages[2].state,'empty');assert.equal(result.pages[2].text,'');});
test('PDF page safety limit exposes continuation and malformed PDF still fails',async()=>{const big=path.join(directory,'too-many-pages.pdf'),bad=path.join(directory,'invalid.pdf');await writeFile(big,pdf(Array(51).fill('TEXT')));await writeFile(bad,'%PDF-invalid');const result=await extract(big,MIME.pdf);assert.equal(result.pages.length,50);assert.equal(result.continuation.nextSource,51);assert.equal(result.sourceCount,51);await assert.rejects(extract(bad,MIME.pdf));});
test('local OCR recognizes Chinese without a cloud key',async()=>{const result=await extract('docs/sample-conditional.png','image/png');assert(result.pages[0].text.replace(/\s/g,'').includes('条件概率'));assert.equal(result.pages[0].method,'local-ocr');assert(result.pages[0].warnings.length>0);});
test('DOCX and PPTX child extraction retains reference numbers and partial errors',async()=>{
  const doc=path.join(directory,'paragraphs.docx'),slides=path.join(directory,'slides.pptx');
  await writeFile(doc,docxFixture('<w:p><w:r><w:t>中文</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>末段</w:t></w:r></w:p>'));
  await writeFile(slides,pptxFixture());
  const result=await extract(doc,MIME.docx),ppt=await extract(slides,MIME.pptx);
  assert.deepEqual(result.pages.map(p=>[p.page,p.text]),[[1,'中文'],[2,''],[3,'末段']]);
  assert.equal(result.pages[0].method,'docx-text');
  assert.equal(ppt.pages[0].text,'SECOND FILE');assert.equal(ppt.pages[2].page,3);assert.equal(ppt.state,'partial');assert(ppt.pages[2].warnings.length>1);
});
test('TXT segment and character limits return bounded partial results',async()=>{
  const file=path.join(directory,'bounded.txt');
  await writeFile(file,'x'.repeat(60001)+'\n\n'+Array(50).fill('中文').join('\n'));
  const result=await extract(file,MIME.txt);
  assert.equal(result.state,'partial');assert.equal(result.pageCount,52);assert.equal(result.pages[0].text,'');assert.equal(result.pages[1].page,2);assert.equal(result.pages[1].text,'');assert.equal(result.continuation.blockedSource,1);
});
test('a raster-only PDF is rendered with PDF.js and recognized locally',async()=>{
  const require=createRequire(import.meta.url),{createCanvas,loadImage}=require('@napi-rs/canvas');
  const source=await loadImage('docs/sample-conditional.png'),width=source.width,height=source.height;
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.drawImage(source,0,0);
  const rgba=ctx.getImageData(0,0,width,height).data,rgb=Buffer.alloc(width*height*3);
  for(let i=0,j=0;i<rgba.length;i+=4){rgb[j++]=rgba[i];rgb[j++]=rgba[i+1];rgb[j++]=rgba[i+2];}
  const compressed=deflateSync(rgb),content=`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
  const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`),Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`),compressed,Buffer.from('\nendstream')])];
  let output=Buffer.from('%PDF-1.4\n');const offsets=[];
  objects.forEach((object,i)=>{offsets.push(output.length);output=Buffer.concat([output,Buffer.from(`${i+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);});
  const xref=output.length;output=Buffer.concat([output,Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)]);
  const file=path.join(directory,'scanned.pdf');await writeFile(file,output);
  const result=await extract(file,MIME.pdf);
  assert.equal(result.pages[0].method,'local-ocr');assert.equal(result.pages[0].state,'extracted');assert.match(result.pages[0].text.replace(/\s/g,''),/条件概率/);
});
test('missing OCR models preserve PDF text and failed scan page without touching installed models',async()=>{
  const file=path.join(directory,'missing-model.pdf');await writeFile(file,pdf(['KEEP_THIS','']));
  const {stdout}=await exec(process.execPath,[path.resolve('scripts/extract-document.mjs'),file,MIME.pdf],{cwd:directory,timeout:30000,windowsHide:true});
  const result=JSON.parse(stdout);assert.equal(result.state,'partial');assert.match(result.pages[0].text,/KEEP_THIS/);assert.equal(result.pages[1].state,'needs-ocr');assert(result.pages[1].warnings.some(w=>w.includes('ocr:setup')));
});
test('OCR initialization has a bounded timeout',async()=>{
  await assert.rejects(recognizeImage(Buffer.from('invalid'),1),/超时|时间限制/);
});
test('mixed PDF text and graphics is explicitly partial',async()=>{
  const file=path.join(directory,'mixed-graphics.pdf');await writeFile(file,pdf(['READABLE'],' 30 500 150 100 re S'));
  const result=await extract(file,MIME.pdf);assert.equal(result.state,'partial');assert.match(result.pages[0].text,/READABLE/);assert.equal(result.pages[0].blocks[0].type,'graphic');
});
