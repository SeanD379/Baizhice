import { zipSync, strToU8 } from 'fflate';
export function officeFixture(kind,body,extra={},zipOptions={}){
  const main=kind==='docx'?'word/document.xml':'ppt/presentation.xml';
  const type=kind==='docx'?'wordprocessingml.document':'presentationml.presentation';
  const files={
    '[Content_Types].xml':`<Types><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${type}.main+xml"/></Types>`,
    '_rels/.rels':`<Relationships><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`,
    [main]:body,...extra,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([key,value])=>[key,strToU8(value)])),zipOptions);
}

// Offsets for deliberately malformed ZIP regression fixtures; no decompression.
export function zipEntryHeaders(input){
  const bytes=Buffer.from(input),headers=[];
  let central=bytes.readUInt32LE(bytes.length-6);
  while(bytes.readUInt32LE(central)===0x02014b50){
    const length=bytes.readUInt16LE(central+28);
    headers.push({name:bytes.subarray(central+46,central+46+length).toString(),central,local:bytes.readUInt32LE(central+42)});
    central+=46+length+bytes.readUInt16LE(central+30)+bytes.readUInt16LE(central+32);
  }
  return {bytes,headers};
}

export function alternateFixture(choice,fallback,requires='ext'){
  return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:ext="urn:unsupported"><mc:Choice Requires="${requires}">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
}

export function slideFixture(slides){
  return officeFixture('pptx',`<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="r"><p:sldIdLst>${slides.map((_,i)=>`<p:sldId id="${i+1}" r:id="s${i}"/>`).join('')}</p:sldIdLst></p:presentation>`,{
    'ppt/_rels/presentation.xml.rels':`<Relationships>${slides.map((_,i)=>`<Relationship Id="s${i}" Target="slides/slide${i}.xml" Type="x/slide"/>`).join('')}</Relationships>`,
    ...Object.fromEntries(slides.map((body,i)=>[`ppt/slides/slide${i}.xml`,body])),
  });
}
export const docxFixture=(paragraphs)=>officeFixture('docx',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`);
export function pptxFixture(){
  return officeFixture('pptx','<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="second"/><p:sldId id="2" r:id="first"/><p:sldId id="3" r:id="missing"/></p:sldIdLst></p:presentation>',{
    'ppt/_rels/presentation.xml.rels':'<Relationships><Relationship Id="first" Target="slides/slide1.xml" Type="x/slide"/><Relationship Id="second" Target="slides/slide2.xml" Type="x/slide"/></Relationships>',
    'ppt/slides/slide1.xml':'<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>FIRST FILE</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide2.xml':'<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>SECOND FILE</a:t></a:r></a:p></p:sld>',
  });
}
