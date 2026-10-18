import { officeFiles } from './office-zip.mjs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import path from 'node:path';

export const MIME={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',pdf:'application/pdf',png:'image/png',jpg:'image/jpeg'};
export const MAX_UPLOAD_BYTES=100*1024*1024;
export function decodeText(bytes){
  const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  let text;
  try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{throw new Error('文本编码无效，请另存为 UTF-8 或带 BOM 的 UTF-16。');}
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw new Error('文件包含二进制内容，不是有效的 TXT 文本。');
  return text.replace(/\r\n?/g,'\n');
}
export function parseXml(bytes){
  if(!bytes)throw new Error('Office 文件缺少必要的 XML 部件。');
  const text=decodeText(bytes);
  if(/<!DOCTYPE|<!ENTITY/i.test(text)||XMLValidator.validate(text)!==true)throw new Error('Office XML 无效或包含不支持的实体声明。');
  let depth=0,count=0;
  for(const [tag] of text.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_](?:[^>"']|"[^"]*"|'[^']*')*>/g)){
    if(tag.startsWith('<!'))continue;
    if(tag.startsWith('</'))depth--;else {count++;if(!tag.endsWith('/>'))depth++;}
    if(depth>100||count>100000)throw new Error('Office XML 嵌套或节点数量超过处理限制。');
  }
  return new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(text);
}
const supportedNamespaces=new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://schemas.openxmlformats.org/presentationml/2006/main','http://schemas.openxmlformats.org/drawingml/2006/main']);
function namespaceScope(node,parent){
  const scope={...parent};
  for(const [key,value] of Object.entries(node[':@']??{}))if(key.startsWith('@_xmlns:'))scope[key.slice(8)]=value;
  return scope;
}
function* entries(tree,parent={}){
  for(const node of tree){
    const scope=namespaceScope(node,parent);
    for(const [key,value] of Object.entries(node)){
      if(key===':@')continue;
      const name=key.split(':').at(-1);
      if(name==='AlternateContent'){
        const choice=value.find(branch=>Object.keys(branch).some(k=>k.split(':').at(-1)==='Choice')&&String(branch[':@']?.['@_Requires']??'').trim().split(/\s+/).every(prefix=>supportedNamespaces.has(namespaceScope(branch,scope)[prefix])));
        const branch=choice??value.find(branch=>Object.keys(branch).some(k=>k.split(':').at(-1)==='Fallback'));
        if(!branch)throw new Error('Office 兼容内容没有可读取的分支，请导出为 PDF 后重试。');
        const children=Object.entries(branch).find(([key])=>['Choice','Fallback'].includes(key.split(':').at(-1)))[1];
        yield* entries(children,namespaceScope(branch,scope));
      }else yield {name,value,scope,attributes:node[':@']};
    }
  }
}
function* findNodes(tree,name,scope={}){
  for(const entry of entries(tree,scope)){
    if(entry.name===name)yield {[name]:entry.value,':@':entry.attributes,scope:entry.scope};
    else if(Array.isArray(entry.value))yield* findNodes(entry.value,name,entry.scope);
  }
}
export function nodes(tree,name){
  return Array.from(findNodes(tree,name));
}
export function officeArchive(bytes){
  const files=officeFiles(bytes);
  const types=nodes(parseXml(files['[Content_Types].xml']),'Override');
  const roots=nodes(parseXml(files['_rels/.rels']),'Relationship');
  const main=roots.find(n=>n[':@']?.['@_Type']?.endsWith('/officeDocument'))?.[':@'];
  if(!main||main['@_TargetMode']==='External')throw new Error('Office 文件缺少有效的正文关系。');
  const target=main['@_Target'].replace(/^\//,'');
  const kind=target==='word/document.xml'?'docx':target==='ppt/presentation.xml'?'pptx':null;
  const expected=kind==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml':'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
  if(!kind||!types.some(n=>n[':@']?.['@_PartName']==='/'+target&&n[':@']?.['@_ContentType']===expected))throw new Error('压缩包不是有效的 DOCX 或 PPTX 文档。');
  const tree=parseXml(files[target]);
  if(!nodes(tree,kind==='docx'?'document':'presentation').length)throw new Error('Office 正文结构无效。');
  return {kind,files,tree};
}
export function identifyUpload(bytes,name){
  const ext=path.extname(name).toLowerCase().slice(1);
  if(!bytes.length||bytes.length>MAX_UPLOAD_BYTES)throw new Error('文件为空或超过 100 MB，请重新选择。');
  if(ext==='docx'||ext==='pptx'){
    try{const office=officeArchive(bytes);if(office.kind!==ext)throw new Error('文件扩展名与 Office 内容不一致。');return {mime:MIME[ext],extension:'.'+ext};}catch(error){throw new Error('Office 文件校验失败：'+error.message);}
  }
  if(ext==='txt'){decodeText(bytes);return {mime:MIME.txt,extension:'.txt'};}
  if(ext==='pdf'&&Buffer.from(bytes.subarray(0,5)).toString()==='%PDF-')return {mime:MIME.pdf,extension:'.pdf'};
  if(ext==='png'&&Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:MIME.png,extension:'.png'};
  if(['jpg','jpeg'].includes(ext)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {mime:MIME.jpg,extension:'.jpg'};
  throw new Error('请上传有效的 PDF、DOCX、PPTX、TXT、PNG 或 JPG 文件。');
}

function* paragraphText(tree,scope,context){
  for(const {name:key,value,scope:childScope,attributes} of entries(tree,scope)){
    if(context&&['drawing','pict','pic','oMath','oMathPara','graphicData','blip','imagedata'].includes(key)){
      const block=mediaBlock(key,value,context,attributes);
      if(block){context.blocks.push(block);yield block.marker;}
      if(!block||!['image','math'].includes(block.type))yield* paragraphText(value,childScope,context);
    }else if(key==='t'){for(const node of value)yield String(node['#text']??'');}
    else if(key==='tab')yield '\t';else if(key==='br'||key==='cr')yield '\n';
    else if(key==='noBreakHyphen')yield '\u2011';
    else if(key!=='del'&&Array.isArray(value))yield* paragraphText(value,childScope,context);
  }
}
function boundedText(chunks){
  let text='';
  for(const chunk of chunks){
    const remaining=60000-text.length;
    if(chunk.length>remaining)return {text:'',truncated:true};
    text+=chunk;
  }
  return {text};
}
function takeSegments(iterator,extract,{startSource=1,maxSources=Infinity,kind='paragraph',part,totalSources,deadline=Date.now()+180000}={}){
  const segments=[];let sourceCount=0,textBytes=0,resultBytes=0,reason,nextSource;
  for(const item of iterator){
    sourceCount++;
    if(reason){if(totalSources!==undefined)break;continue;}
    if(Date.now()>=deadline){reason='time-limit';nextSource=Math.max(startSource,sourceCount);if(totalSources!==undefined)break;continue;}
    // Numbering state still advances over paragraphs before the continuation cursor.
    if(sourceCount<startSource){extract(item,sourceCount);continue;}
    if(segments.length>=maxSources){reason='page-limit';nextSource=sourceCount;if(totalSources!==undefined)break;continue;}
    const segment={...extract(item,sourceCount),source:{kind,index:sourceCount,...(part?{part}:{})}};
    const textSize=Buffer.byteLength(JSON.stringify(segment.text)),resultSize=Buffer.byteLength(JSON.stringify(segment))+256;
    if(textBytes+textSize>1000000||resultBytes+resultSize>1300000){
      reason=textBytes+textSize>1000000?'text-limit':'result-limit';nextSource=sourceCount;
      // Keep one oversized location so the caller can explicitly mark it omitted.
      if(!segments.length)segments.push(segment);
      if(totalSources!==undefined)break;continue;
    }
    textBytes+=textSize;resultBytes+=resultSize;segments.push(segment);
  }
  sourceCount=totalSources??sourceCount;
  return {segments,sourceCount,hasMore:!!reason,...(reason?{reason,nextSource}:{})};
}
const attr=(node,key='val')=>Object.entries(node?.[':@']??{}).find(([name])=>name.replace(/^@_/,'').split(':').at(-1)===key)?.[1];
const first=(tree,name)=>nodes(tree,name)[0];
function relationshipsFor(files,part){
  const location=path.posix.join(path.posix.dirname(part),'_rels',path.posix.basename(part)+'.rels');
  return files[location]?nodes(parseXml(files[location]),'Relationship'):[];
}
function mediaBlock(name,tree,{part,index,relationships},attributes){
  const base={sourceStart:index,sourceEnd:index,part};
  if(name==='oMath'||name==='oMathPara'){
    const text=Array.from(paragraphText(tree)).join('');
    return {type:'math',...base,text,marker:`[公式：${text||'请对照原文'}]`};
  }
  if(name==='blip'||name==='imagedata'){
    const image={':@':attributes};
    const relationshipId=attr(image,'embed')??attr(image,'id')??attr(image,'link');
    const relation=relationships.find(r=>attr(r,'Id')===relationshipId);
    const target=attr(relation,'Target');
    const candidate=target?(target.startsWith('/')?target.slice(1):path.posix.normalize(path.posix.join(path.posix.dirname(part),target))):undefined;
    const assetPath=attr(relation,'TargetMode')!=='External'&&candidate&&!candidate.startsWith('../')&&!candidate.includes('\\')&&!candidate.includes(':')?candidate:undefined;
    return {type:'image',...base,...(relationshipId?{relationshipId}:{}),...(assetPath?{assetPath}:{}),marker:`[图片：${assetPath||relationshipId||'请对照原文'}]`};
  }
  if(name==='graphicData'&&!first(tree,'tbl'))return {type:'graphic',...base,marker:'[图形：请对照原文]'};
  if(['drawing','pict','pic'].includes(name)&&!['blip','imagedata','oMath','oMathPara','graphicData'].some(key=>first(tree,key)))return {type:'graphic',...base,marker:'[图形：请对照原文]'};
}
function wordNumberer(files){
  const tree=files['word/numbering.xml']?parseXml(files['word/numbering.xml']):[];
  const nums=nodes(tree,'num'),abstracts=nodes(tree,'abstractNum'),counters=new Map();
  const styles=files['word/styles.xml']?nodes(parseXml(files['word/styles.xml']),'style'):[];
  const styleMap=new Map(styles.map(style=>[attr(style,'styleId'),style]));
  const letter=(value,upper)=>{let label='';for(let n=value;n>0;n=Math.floor((n-1)/26))label=String.fromCharCode((upper?65:97)+(n-1)%26)+label;return label;};
  return paragraph=>{
    const properties=first(paragraph,'pPr')?.pPr??[];
    const styleId=attr(first(properties,'pStyle'));
    let numIdValue,levelValue,hasNumPr=false;
    const inherit=branch=>{const numPr=first(branch,'numPr');if(!numPr)return;hasNumPr=true;numIdValue??=attr(first(numPr.numPr,'numId'));levelValue??=attr(first(numPr.numPr,'ilvl'));};
    inherit(properties);
    const visited=new Set();let inheritedStyle=styleId;
    while(inheritedStyle&&!visited.has(inheritedStyle)){
      visited.add(inheritedStyle);const style=styleMap.get(inheritedStyle);if(!style)break;
      inherit(first(style.style,'pPr')?.pPr??[]);inheritedStyle=attr(first(style.style,'basedOn'));
    }
    if(!hasNumPr)return;
    const level=Number(levelValue??0);
    if(numIdValue===undefined)return {numId:'',level,label:'',unsupported:true};
    const numId=String(numIdValue);
    if(numId==='0')return;
    const num=nums.find(n=>String(attr(n,'numId'))===numId);
    const abstractId=attr(num&&first(num.num,'abstractNumId'));
    const abstract=abstracts.find(n=>attr(n,'abstractNumId')===abstractId);
    const overrides=num?nodes(num.num,'lvlOverride'):[];
    const override=overrides.find(n=>Number(attr(n,'ilvl'))===level);
    const definitions=abstract?nodes(abstract.abstractNum,'lvl'):[];
    const definition=override&&first(override.lvlOverride,'lvl')||definitions.find(n=>Number(attr(n,'ilvl'))===level);
    if(!definition)return {numId,level,label:'',unsupported:true};
    const start=Number(attr(override&&first(override.lvlOverride,'startOverride'))??attr(first(definition.lvl,'start'))??1);
    const values=counters.get(numId)??[];values[level]=(values[level]??(start-1))+1;values.length=level+1;counters.set(numId,values);
    const format=attr(first(definition.lvl,'numFmt'))??'decimal';
    const pattern=attr(first(definition.lvl,'lvlText'))??`%${level+1}.`;
    let unsupported=false;
    const label=pattern.replace(/%([1-9])/g,(_,digit)=>{
      const at=Number(digit)-1,lvl=at===level?definition:definitions.find(n=>Number(attr(n,'ilvl'))===at);
      const fmt=attr(lvl&&first(lvl.lvl,'numFmt'))??format,value=values[at]??Number(attr(lvl&&first(lvl.lvl,'start'))??1);
      if(fmt==='upperLetter'||fmt==='lowerLetter')return letter(value,fmt==='upperLetter');
      if(fmt==='decimalZero')return String(value).padStart(2,'0');
      if(fmt==='decimal')return String(value);
      unsupported=true;return String(value);
    });
    return {numId,level,label,...(unsupported?{unsupported:true}:{})};
  };
}
export function documentSegments(bytes,mime,options={}){
  if(!Number.isInteger(options.startSource??1)||(options.startSource??1)<1)throw new Error('起始来源位置必须是正整数。');
  if(mime===MIME.txt){
    const text=decodeText(bytes);
    let totalSources=1;for(let offset=text.indexOf('\n');offset!==-1;offset=text.indexOf('\n',offset+1))totalSources++;
    function* lines(){
      let start=0;
      while(true){const end=text.indexOf('\n',start);yield [start,end===-1?text.length:end];if(end===-1)return;start=end+1;}
    }
    return takeSegments(lines(),([start,end])=>({text:end-start>60000?'':text.slice(start,end),truncated:end-start>60000}),{...options,kind:'line',totalSources});
  }
  const {kind,files,tree}=officeArchive(bytes);
  if(MIME[kind]!==mime)throw new Error('文件内容与存储的 MIME 不一致。');
  if(kind==='docx'){
    const body=findNodes(tree,'body').next().value;
    const paragraphNodes=Array.from(findNodes(body?.body??[],'p',body?.scope));
    const indices=new Map(paragraphNodes.map((n,i)=>[n.p,i+1]));
    const tables=new Map();
    for(const table of findNodes(body?.body??[],'tbl',body?.scope)){
      const paragraphs=nodes(table.tbl,'p');
      const start=indices.get(paragraphs[0]?.p),end=indices.get(paragraphs.at(-1)?.p);
      if(start)tables.set(start,{type:'table',sourceStart:start,sourceEnd:end,rows:nodes(table.tbl,'tr').map(row=>nodes(row.tr,'tc').map(cell=>nodes(cell.tc,'p').map(p=>Array.from(paragraphText(p.p,p.scope)).join('')).join('\n'))),part:'word/document.xml'});
    }
    const number=wordNumberer(files),relationships=relationshipsFor(files,'word/document.xml');
    return takeSegments(paragraphNodes,(n,index)=>{
      const blocks=[],context={part:'word/document.xml',index,relationships,blocks};
      const result=boundedText(paragraphText(n.p,n.scope,context));
      const numbering=number(n.p);
      if(numbering?.label&&result.text.trim()&&!/^(?:\d+(?:\.\d+)*|[A-Za-z])[.、．)）]\s*/.test(result.text.trimStart()))result.text=numbering.label+' '+result.text;
      if(result.text.length>60000){result.text='';result.truncated=true;}
      if(tables.has(index))blocks.unshift(tables.get(index));
      return {...result,...(numbering?{numbering}:{}),...(blocks.length?{blocks}:{})};
    },{...options,kind:'paragraph',part:'word/document.xml'});
  }
  const relationships=nodes(parseXml(files['ppt/_rels/presentation.xml.rels']),'Relationship');
  return takeSegments(findNodes(tree,'sldId'),(slide,index)=>{
    try{
      const relationId=Object.entries(slide[':@']??{}).find(([key])=>key.endsWith(':id'))?.[1];
      const relation=relationships.find(n=>n[':@']?.['@_Id']===relationId)?.[':@'];
      if(!relation||relation['@_TargetMode']==='External'||!relation['@_Type']?.endsWith('/slide'))throw new Error('幻灯片关系缺失或无效。');
      const target=relation['@_Target'].startsWith('/')?relation['@_Target'].slice(1):path.posix.normalize('ppt/'+relation['@_Target']);
      if(!target.startsWith('ppt/slides/'))throw new Error('幻灯片路径无效。');
      const slideTree=parseXml(files[target]);
      if(!nodes(slideTree,'sld').length)throw new Error('幻灯片 XML 无效。');
      const blocks=[],context={part:target,index,relationships:relationshipsFor(files,target),blocks};
      function* slideText(branch,scope){
        for(const {name,value,scope:childScope} of entries(branch,scope)){
          if(name==='p'){yield* paragraphText(value,childScope,context);yield '\n';}
          else if(name==='tbl'){
            const rows=nodes(value,'tr').map(row=>nodes(row.tr,'tc').map(cell=>nodes(cell.tc,'p').map(p=>Array.from(paragraphText(p.p,p.scope)).join('')).join('\n')));
            blocks.push({type:'table',sourceStart:index,sourceEnd:index,rows,part:target});yield rows.map(r=>r.join(' | ')).join('\n')+'\n';
          }else if(['pic','oMath','oMathPara','graphicData'].includes(name)){
            if(name==='graphicData'&&first(value,'tbl'))yield* slideText(value,childScope);
            else {yield* paragraphText([{[name]:value}],childScope,context);yield '\n';}
          }else if(Array.isArray(value))yield* slideText(value,childScope);
        }
      }
      const result=boundedText(slideText(slideTree));result.text=result.text.trimEnd();
      return {...result,...(blocks.length?{blocks}:{})};
    }catch(error){return {text:'',error:error.message};}
  },{maxSources:50,...options,kind:'slide'});
}
