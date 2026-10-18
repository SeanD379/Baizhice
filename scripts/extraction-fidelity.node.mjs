import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { documentSegments, MIME } from './document-formats.mjs';
import { docxFixture, officeFixture, slideFixture } from './document-fixtures.mjs';
const exec=promisify(execFile);
const directory=path.resolve('tmp/extraction-fidelity');
await mkdir(directory,{recursive:true});
const paragraph=text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
test('Word and TXT retain more than 50 source locations, including blanks and continuation offsets',()=>{
  for(const [bytes,mime] of [[docxFixture(paragraph('first')+'<w:p/>'+paragraph('next').repeat(91)),MIME.docx],[Buffer.from('first\n\n'+Array(91).fill('next').join('\n')),MIME.txt]]){
    const result=documentSegments(bytes,mime);
    assert.equal(result.segments.length,93);assert.equal(result.hasMore,false);
    assert.equal(result.segments[1].text,'');assert.equal(result.segments[92].source.index,93);
    const tail=documentSegments(bytes,mime,{startSource:51});
    assert.equal(tail.segments.length,43);assert.equal(tail.segments[0].source.index,51);
  }
});
test('automatic Word lists render decimal and letters without doubling manual numbering',()=>{
  const numbered=text=>`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const bytes=officeFixture('docx',`<w:document xmlns:w="w"><w:body>${numbered('甲')}${numbered('2. 乙')}${numbered('丙')}</w:body></w:document>`,{'word/numbering.xml':'<w:numbering xmlns:w="w"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'});
  assert.deepEqual(documentSegments(bytes,MIME.docx).segments.map(s=>s.text),['1. 甲','2. 乙','3. 丙']);
  const letters=officeFixture('docx',`<w:document xmlns:w="w"><w:body>${numbered('选项')}${numbered('选项')}</w:body></w:document>`,{'word/numbering.xml':'<w:numbering xmlns:w="w"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'});
  assert.deepEqual(documentSegments(letters,MIME.docx).segments.map(s=>s.text),['A) 选项','B) 选项']);
});
test('Word table and media retain logical source ranges and explicit source markers',()=>{
  const body=paragraph('before')+'<w:tbl><w:tr><w:tc>'+paragraph('cell one')+'</w:tc><w:tc>'+paragraph('cell two')+'</w:tc></w:tr></w:tbl><w:p><w:r><w:drawing><a:blip r:embed="img1"/></w:drawing></w:r><m:oMath><m:r><m:t>x+1</m:t></m:r></m:oMath></w:p>'+paragraph('after');
  const bytes=officeFixture('docx',`<w:document xmlns:w="w" xmlns:a="a" xmlns:r="r" xmlns:m="m"><w:body>${body}</w:body></w:document>`,{'word/_rels/document.xml.rels':'<Relationships><Relationship Id="img1" Target="media/image1.png" Type="x/image"/></Relationships>'});
  const {segments}=documentSegments(bytes,MIME.docx);
  assert.equal(segments.length,5);assert.equal(segments[4].text,'after');
  assert.deepEqual(segments[1].blocks.find(b=>b.type==='table'),{type:'table',sourceStart:2,sourceEnd:3,rows:[['cell one','cell two']],part:'word/document.xml'});
  assert.match(segments[3].text,/图片/);assert.match(segments[3].text,/公式/);
  assert.equal(segments[3].blocks.find(b=>b.type==='image').assetPath,'word/media/image1.png');
  assert.equal(segments[3].blocks.find(b=>b.type==='math').text,'x+1');
});
test('oversized source paragraphs are explicitly omitted, never returned as a cut question',async()=>{
  const file=path.join(directory,'oversized.txt');await writeFile(file,'Q '+ 'x'.repeat(60001)+'\nNEXT');
  const {stdout}=await exec(process.execPath,['scripts/extract-document.mjs',file,MIME.txt],{windowsHide:true});
  const result=JSON.parse(stdout);assert.equal(result.state,'partial');assert.equal(result.pages[0].text,'');
  assert.equal(result.pages[0].state,'needs-ocr');assert.match(result.pages[0].warnings.join(' '),/完整|上限/);
  assert.equal(result.pages[1].text,'NEXT');assert.equal(result.continuation.blockedSource,1);
});
test('PPT table, picture and formula are marked at their slide location',()=>{
  const slide='<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r" xmlns:m="m"><p:spTree><p:graphicFrame><a:tbl><a:tr><a:tc><a:p><a:r><a:t>cell</a:t></a:r></a:p></a:tc></a:tr></a:tbl></p:graphicFrame><p:pic><a:blip r:embed="img"/></p:pic><p:sp><m:oMath><m:r><m:t>a+b</m:t></m:r></m:oMath></p:sp></p:spTree></p:sld>';
  const result=documentSegments(slideFixture([slide]),MIME.pptx);
  assert.equal(result.segments[0].blocks.find(b=>b.type==='table').rows[0][0],'cell');
  assert(result.segments[0].blocks.some(b=>b.type==='image'));assert(result.segments[0].blocks.some(b=>b.type==='math'));
});
test('OCR exposes line boxes and preprocessing without modifying source bytes',async()=>{
  const {readFile}=await import('node:fs/promises');const {recognizeImage}=await import('./document-ocr.mjs');
  const bytes=await readFile('docs/sample-conditional.png'),original=Buffer.from(bytes);
  const result=await recognizeImage(bytes);
  assert.deepEqual(bytes,original);assert(result.ocr.preprocessing.includes('grayscale'));assert(result.layout.lines.length>0);
  assert(result.layout.lines.every(line=>line.bbox.width>0&&line.bbox.height>0));
});
test('local OCR corrects a sideways scanned document',async()=>{
  const {default:sharp}=await import('sharp');const {recognizeImage}=await import('./document-ocr.mjs');
  const bytes=await sharp('docs/sample-conditional.png').rotate(90).toBuffer();const result=await recognizeImage(bytes);
  assert.match(result.text.replace(/\s/g,''),/条件概率/);assert(result.ocr.rotation!==0);
});
test('total text limit stops before a paragraph and resumes from its source cursor',async()=>{
  const file=path.join(directory,'continuation.txt');await writeFile(file,Array(22).fill('x'.repeat(50000)).join('\n'));
  const {stdout}=await exec(process.execPath,['scripts/extract-document.mjs',file,MIME.txt],{windowsHide:true,maxBuffer:2*1024*1024});const first=JSON.parse(stdout);
  assert.equal(first.pages.length,19);assert.equal(first.pages[18].text.length,50000);assert.equal(first.continuation.nextSource,20);assert.equal(first.continuation.reason,'text-limit');
  const next=await exec(process.execPath,['scripts/extract-document.mjs',file,MIME.txt,'20'],{windowsHide:true,maxBuffer:2*1024*1024});const tail=JSON.parse(next.stdout);
  assert.deepEqual(tail.pages.map(p=>p.page),[20,21,22]);assert.equal(tail.continuation.hasMore,false);
});
test('many blank TXT lines stay bounded before CLI serialization and resume at raw lines',async()=>{
  const probe="import {documentSegments,MIME} from './scripts/document-formats.mjs'; const result=documentSegments(Buffer.alloc(500000,10),MIME.txt); console.log(JSON.stringify({count:result.sourceCount,returned:result.segments.length,more:result.hasMore,next:result.nextSource,reason:result.reason}));";
  const {stdout}=await exec(process.execPath,['--max-old-space-size=32','--input-type=module','-e',probe],{windowsHide:true,timeout:20000,maxBuffer:4096});const result=JSON.parse(stdout);
  assert.equal(result.count,500001);assert(result.returned<10000);assert.equal(result.more,true);assert.equal(result.next,result.returned+1);assert.equal(result.reason,'result-limit');
  const file=path.join(directory,'many-blank-lines.txt');await writeFile(file,Buffer.alloc(500000,10));
  const first=JSON.parse((await exec(process.execPath,['scripts/extract-document.mjs',file,MIME.txt],{windowsHide:true,timeout:20000,maxBuffer:2*1024*1024})).stdout);
  assert.equal(first.sourceCount,500001);assert.equal(first.continuation.reason,'result-limit');assert.equal(first.continuation.nextSource,first.pageCount+1);
  const tail=JSON.parse((await exec(process.execPath,['scripts/extract-document.mjs',file,MIME.txt,'500000'],{windowsHide:true,timeout:20000,maxBuffer:4096})).stdout);
  assert.deepEqual(tail.pages.map(p=>p.page),[500000,500001]);assert.equal(tail.continuation.hasMore,false);
});
test('Word basedOn list styles inherit numId and merge a direct level across continuation',()=>{
  const p=text=>`<w:p><w:pPr><w:pStyle w:val="Child"/><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const bytes=officeFixture('docx',`<w:document xmlns:w="w"><w:body>${p('Question one')}${p('Question two')}</w:body></w:document>`,{
    'word/styles.xml':'<w:styles xmlns:w="w"><w:style w:styleId="Child"><w:basedOn w:val="Base"/></w:style><w:style w:styleId="Base"><w:pPr><w:numPr><w:numId w:val="1"/><w:ilvl w:val="0"/></w:numPr></w:pPr></w:style></w:styles>',
    'word/numbering.xml':'<w:numbering xmlns:w="w"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
  });
  assert.deepEqual(documentSegments(bytes,MIME.docx).segments.map(s=>s.text),['1. Question one','2. Question two']);
  assert.equal(documentSegments(bytes,MIME.docx,{startSource:2}).segments[0].text,'2. Question two');
  const inheritedOnly=officeFixture('docx',`<w:document xmlns:w="w"><w:body><w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:t>Inherited question</w:t></w:r></w:p></w:body></w:document>`,{
    'word/styles.xml':'<w:styles xmlns:w="w"><w:style w:styleId="Child"><w:basedOn w:val="Base"/></w:style><w:style w:styleId="Base"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>',
    'word/numbering.xml':'<w:numbering xmlns:w="w"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
  });
  assert.equal(documentSegments(inheritedOnly,MIME.docx).segments[0].text,'1. Inherited question');
});
test('Word VML and DrawingML textbox questions survive drawing markers at existing paragraph indices',()=>{
  for(const container of ['<w:pict><v:shape><v:textbox>BOX</v:textbox></v:shape></w:pict>','<w:drawing><wps:txbx>BOX</wps:txbx></w:drawing>']){
    const box='<w:txbxContent>'+paragraph('BOX QUESTION')+'</w:txbxContent>';
    const body='<w:p><w:r><w:t>Outer</w:t>'+container.replace('BOX',box)+'</w:r></w:p>'+paragraph('after');
    const bytes=officeFixture('docx',`<w:document xmlns:w="w" xmlns:v="v" xmlns:wps="wps"><w:body>${body}</w:body></w:document>`);
    const result=documentSegments(bytes,MIME.docx);
    assert.equal(result.segments.length,2);assert.equal(result.segments[0].source.index,1);assert.match(result.segments[0].text,/Outer.*BOX QUESTION/);assert.equal(result.segments[1].text,'after');
    assert.equal(result.segments[0].blocks.filter(b=>b.type==='graphic').length,1);
  }
});
test('Word grouped drawings preserve all image relationships and math exactly once',()=>{
  const body='<w:p><w:r><w:drawing><a:grpSp><a:blip r:embed="one"/><a:blip r:embed="two"/><m:oMath><m:r><m:t>x+1</m:t></m:r></m:oMath></a:grpSp></w:drawing></w:r></w:p>';
  const bytes=officeFixture('docx',`<w:document xmlns:w="w" xmlns:a="a" xmlns:r="r" xmlns:m="m"><w:body>${body}</w:body></w:document>`,{'word/_rels/document.xml.rels':'<Relationships><Relationship Id="one" Target="media/one.png" Type="x/image"/><Relationship Id="two" Target="media/two.png" Type="x/image"/></Relationships>'});
  const segment=documentSegments(bytes,MIME.docx).segments[0];
  assert.deepEqual(segment.blocks.filter(b=>b.type==='image').map(b=>b.assetPath),['word/media/one.png','word/media/two.png']);
  assert.equal(segment.text,'[图片：word/media/one.png][图片：word/media/two.png][公式：x+1]');assert.equal(segment.blocks.filter(b=>b.type==='math').length,1);
});
