import { describe,it,expect,vi,beforeEach } from 'vitest';
import { zipSync,strToU8 } from 'fflate';
import { identifyUpload } from './upload-format';
import { docxFixture,pptxFixture,officeFixture,zipEntryHeaders,alternateFixture,slideFixture } from '../../scripts/document-fixtures.mjs';
import { MIME,documentSegments } from '../../scripts/document-formats.mjs';
import { extractionSchema } from './extraction-types';
import { inflateRawSync } from 'node:zlib';

vi.mock('node:zlib',async importOriginal=>{
  const original=await importOriginal<typeof import('node:zlib')>();
  return {...original,inflateRawSync:vi.fn(original.inflateRawSync)};
});
beforeEach(()=>{vi.mocked(inflateRawSync).mockClear();});

describe('upload content validation',()=>{
  it('accepts real Office contents and refuses renamed archives',()=>{
    expect(identifyUpload(docxFixture('<w:p/>'),'notes.docx').mime).toBe(MIME.docx);
    expect(identifyUpload(pptxFixture(),'notes.pptx').mime).toBe(MIME.pptx);
    expect(()=>identifyUpload(docxFixture('<w:p/>'),'notes.pptx')).toThrow();
    expect(()=>identifyUpload(zipSync({'word/document.xml':strToU8('<fake/>')}),'notes.docx')).toThrow();
    expect(()=>identifyUpload(Buffer.from('hello'),'notes.docx')).toThrow();
  });
  it('rejects corrupt XML, entities and oversized decompressed XML',()=>{
    expect(()=>identifyUpload(docxFixture('<w:p>'),'a.docx')).toThrow();
    expect(()=>identifyUpload(docxFixture('<!DOCTYPE x><w:p/>'),'a.docx')).toThrow();
    expect(()=>identifyUpload(docxFixture(' '.repeat(8*1024*1024)),'a.docx')).toThrow(/大小/);
  });
  it('accepts paste UTF-8 and BOM UTF-16 but rejects binary and invalid encodings',()=>{
    expect(identifyUpload(Buffer.from('中文\n\nline'),'paste.txt').mime).toBe('text/plain');
    expect(documentSegments(Buffer.concat([Buffer.from([255,254]),Buffer.from('中文','utf16le')]),MIME.txt).segments[0].text).toBe('中文');
    expect(()=>identifyUpload(Buffer.from([0,1,2]),'a.txt')).toThrow();
    expect(()=>identifyUpload(Buffer.from([255]),'a.txt')).toThrow();
  });
  it('retains empty paragraphs, tables, runs, tabs and literal entities',()=>{
    const {segments}=documentSegments(docxFixture('<w:p><w:r><w:t>001 &amp; </w:t><w:tab/><w:t>二</w:t></w:r></w:p><w:p/><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'),MIME.docx);
    expect(segments.map((s:{text:string})=>s.text)).toEqual(['001 & \t二','','表格']);
  });
  it('uses presentation order and retains a missing slide as a partial segment',()=>{
    const {segments}=documentSegments(pptxFixture(),MIME.pptx);
    expect(segments.map((s:{text:string})=>s.text)).toEqual(['SECOND FILE','FIRST FILE','']);
    expect(segments[2].error).toBeTruthy();
  });
  it('rejects dishonest stored sizes before any XML inflation',()=>{
    const {bytes,headers}=zipEntryHeaders(officeFixture('docx','<w:document/>',{'word/unused.xml':' '.repeat(8*1024*1024+100)},{level:0}));
    const entry=headers.find(h=>h.name==='word/unused.xml')!;
    bytes.writeUInt32LE(1,entry.central+24);bytes.writeUInt32LE(1,entry.local+22);
    expect(()=>identifyUpload(bytes,'bad.docx')).toThrow();
    expect(inflateRawSync).not.toHaveBeenCalled();
  });
  it('rejects aliased local records before inflating even the first entry',()=>{
    const {bytes,headers}=zipEntryHeaders(officeFixture('docx','<w:document/>',{'word/a.xml':'<x/>','word/b.xml':'<x/>'}));
    const a=headers.find(h=>h.name==='word/a.xml')!,b=headers.find(h=>h.name==='word/b.xml')!;
    bytes.writeUInt32LE(a.local,b.central+42);
    expect(()=>identifyUpload(bytes,'bad.docx')).toThrow();
    expect(inflateRawSync).not.toHaveBeenCalled();
  });
  it('preflights the aggregate XML budget before inflating',()=>{
    const large=' '.repeat(7*1024*1024);
    const bytes=officeFixture('docx','<w:document/>',{'a.xml':large,'b.xml':large,'c.xml':large,'d.xml':large});
    expect(()=>identifyUpload(bytes,'bad.docx')).toThrow(/大小/);
    expect(inflateRawSync).not.toHaveBeenCalled();
  });
  it('bounds actual deflate output even when both headers lie',()=>{
    const {bytes,headers}=zipEntryHeaders(docxFixture('<w:p>'+ ' '.repeat(200000)+'</w:p>'));
    const entry=headers.find(h=>h.name==='word/document.xml')!;
    bytes.writeUInt32LE(64,entry.central+24);bytes.writeUInt32LE(64,entry.local+22);
    expect(()=>identifyUpload(bytes,'bad.docx')).toThrow();
    expect(vi.mocked(inflateRawSync).mock.calls.at(-1)?.[1]).toMatchObject({maxOutputLength:64});
  });
  it('rejects CRC corruption and inconsistent local headers',()=>{
    for(const position of [14,22]){
      const {bytes,headers}=zipEntryHeaders(docxFixture('<w:p/>'));
      bytes.writeUInt32LE(123,headers[0].local+position);
      expect(()=>identifyUpload(bytes,'bad.docx')).toThrow();
      expect(inflateRawSync).not.toHaveBeenCalled();
    }
    const {bytes,headers}=zipEntryHeaders(docxFixture('<w:p/>'));
    bytes.writeUInt32LE(123,headers[0].local+14);bytes.writeUInt32LE(123,headers[0].central+16);
    expect(()=>identifyUpload(bytes,'bad.docx')).toThrow();
  });
  it('selects one compatibility branch and preserves following paragraph positions',()=>{
    const p=(s:string)=>`<w:p><w:r><w:t>${s}</w:t></w:r></w:p>`;
    const body=alternateFixture(p('UNSUPPORTED'),p('VISIBLE'))+p('NEXT');
    expect(documentSegments(docxFixture(body),MIME.docx).segments.map(s=>s.text)).toEqual(['VISIBLE','NEXT']);
    const supported=alternateFixture(p('CHOICE'),p('FALLBACK'),'w');
    expect(documentSegments(docxFixture(supported),MIME.docx).segments.map(s=>s.text)).toEqual(['CHOICE']);
    const inline=`<w:p>${alternateFixture('<w:r><w:t>WRONG</w:t></w:r>','<w:r><w:t>RIGHT</w:t></w:r>')}</w:p>`;
    expect(documentSegments(docxFixture(inline),MIME.docx).segments[0].text).toBe('RIGHT');
  });
  it('uses fallback text once inside a PPTX text box',()=>{
    const p=(s:string)=>`<a:p><a:r><a:t>${s}</a:t></a:r></a:p>`;
    const slide=`<p:sld xmlns:p="p" xmlns:a="a">${alternateFixture(p('DUPLICATE'),p('VISIBLE'))}</p:sld>`;
    expect(documentSegments(slideFixture([slide]),MIME.pptx).segments.map(s=>s.text)).toEqual(['VISIBLE']);
  });
  it('preserves Word nonbreaking hyphens across runs',()=>{
    const body='<w:p><w:r><w:t>non</w:t></w:r><w:r><w:noBreakHyphen/></w:r><w:r><w:t>zero A</w:t><w:noBreakHyphen/><w:t>1</w:t></w:r></w:p>';
    expect(documentSegments(docxFixture(body),MIME.docx).segments[0].text).toBe('non\u2011zero A\u20111');
  });
  it('retains complete TXT and DOCX source locations and detects a trailing empty line',()=>{
    for(const count of [49,50,51]){
      const txt=documentSegments(Buffer.from(Array(count).fill('x').join('\n')),MIME.txt);
      const doc=documentSegments(docxFixture('<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(count)),MIME.docx);
      for(const result of [txt,doc]){expect(result.segments).toHaveLength(count);expect(result.hasMore).toBe(false);}
    }
    expect(documentSegments(Buffer.from('x\n'.repeat(50)),MIME.txt).segments).toHaveLength(51);
    const result=documentSegments(docxFixture('<w:p><w:r><w:t>'+ 'x'.repeat(60001)+'</w:t></w:r></w:p>'),MIME.docx);
    expect(result.segments[0]).toMatchObject({text:'',truncated:true});
  });
  it('does not parse slides beyond the first 50',()=>{
    const slides=Array(50).fill('<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>OK</a:t></a:r></a:p></p:sld>');
    const result=documentSegments(slideFixture([...slides,'<broken']),MIME.pptx);
    expect(result.hasMore).toBe(true);expect(result.segments).toHaveLength(50);
    expect(result.segments.every(s=>s.text==='OK'&&!s.error)).toBe(true);
  });
  it('schema accepts existing and new methods while retaining bounds',()=>{
    for(const method of ['pdf-text','local-ocr','docx-text','pptx-text','text']){
      const result={state:'complete',pageCount:1,durationMs:1,updatedAt:'now',pages:[{page:1,text:'abc',method,state:'extracted',warnings:[]}]};
      expect(extractionSchema.safeParse(result).success).toBe(true);
      expect(extractionSchema.safeParse({...result,pageCount:51}).success).toBe(true);
    }
  });
});
