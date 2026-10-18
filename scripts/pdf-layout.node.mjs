import test from 'node:test';
import assert from 'node:assert/strict';
test('PDF positioned items reconstruct lines despite reversed storage order',async()=>{
  const {pdfTextLayout}=await import('./pdf-layout.mjs');
  const item=(str,x,y,width=60)=>({str,transform:[12,0,0,12,x,y],width,height:12});
  const result=pdfTextLayout([item('world',100,700),item('SECOND',30,675),item('Hello',30,700)],{width:600,height:800});
  assert.equal(result.text,'Hello world\nSECOND');assert.deepEqual(result.layout.lines[0].bbox,{x:30,y:700,width:130,height:12});
});
test('PDF two-column paragraphs read down the left column before the right',async()=>{
  const {pdfTextLayout}=await import('./pdf-layout.mjs');
  const item=(str,x,y,width=100)=>({str,transform:[12,0,0,12,x,y],width,height:12});
  const result=pdfTextLayout([item('RIGHT ONE',330,700),item('LEFT TWO',30,675),item('RIGHT TWO',330,675),item('LEFT ONE',30,700),item('TITLE',30,750,450)],{width:600,height:800});
  assert.equal(result.text,'TITLE\nLEFT ONE\nLEFT TWO\nRIGHT ONE\nRIGHT TWO');
});
test('PDF staggered column baselines retain column order and spanning headings',async()=>{
  const {pdfTextLayout}=await import('./pdf-layout.mjs');
  const item=(str,x,y,width=100)=>({str,transform:[12,0,0,12,x,y],width,height:12});
  const result=pdfTextLayout([item('RIGHT ONE',330,710),item('LEFT TWO',30,680),item('RIGHT TWO',330,690),item('LEFT ONE',30,700),item('TITLE',30,750,450)],{width:600,height:800});
  assert.equal(result.text,'TITLE\nLEFT ONE\nLEFT TWO\nRIGHT ONE\nRIGHT TWO');
});
test('PDF columns with just one aligned row still use all gutter evidence',async()=>{
  const {pdfTextLayout}=await import('./pdf-layout.mjs');
  const item=(str,x,y)=>({str,transform:[12,0,0,12,x,y],width:100,height:12});
  const result=pdfTextLayout([item('RIGHT ONE',330,700),item('LEFT TWO',30,680),item('RIGHT TWO',330,690),item('LEFT ONE',30,700)],{width:600,height:800});
  assert.equal(result.text,'LEFT ONE\nLEFT TWO\nRIGHT ONE\nRIGHT TWO');
});
