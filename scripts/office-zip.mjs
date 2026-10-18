import { crc32, inflateRawSync } from 'node:zlib';

const XML_LIMIT=8*1024*1024,TOTAL_LIMIT=24*1024*1024;
const invalid=()=>{throw new Error('Office 压缩包目录、大小或校验值无效。');};

// Validate every directory/local header and allocation budget before inflating anything.
// ZIP64, split archives and encryption are intentionally unsupported.
export function officeFiles(input,requestedMedia=undefined){
  if(requestedMedia!==undefined&&!/^(?:word|ppt)\/media\/[A-Za-z0-9._-]+\.(png|jpe?g|gif|webp|bmp)$/i.test(requestedMedia))throw new Error('Office 图片路径无效。');
  if(!input.length||input.length>100*1024*1024)throw new Error('文件为空或超过 100 MB。');
  const bytes=Buffer.from(input.buffer,input.byteOffset,input.byteLength);
  let end=bytes.length-22;
  for(;end>=Math.max(0,bytes.length-65557);end--){
    if(bytes.readUInt32LE(end)===0x06054b50&&end+22+bytes.readUInt16LE(end+20)===bytes.length)break;
  }
  if(end<0||end<bytes.length-65557)invalid();
  const count=bytes.readUInt16LE(end+10),start=bytes.readUInt32LE(end+16);
  if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||count!==bytes.readUInt16LE(end+8)||count>2000||start+bytes.readUInt32LE(end+12)!==end)invalid();
  const entries=[],names=new Set();let offset=start,total=0;
  for(let i=0;i<count;i++){
    if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50)invalid();
    const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),crc=bytes.readUInt32LE(offset+16);
    const size=bytes.readUInt32LE(offset+20),original=bytes.readUInt32LE(offset+24),local=bytes.readUInt32LE(offset+42);
    const nameLength=bytes.readUInt16LE(offset+28),extraLength=bytes.readUInt16LE(offset+30),commentLength=bytes.readUInt16LE(offset+32);
    const next=offset+46+nameLength+extraLength+commentLength;
    if(next>end||bytes.readUInt16LE(offset+34)||flags&~0x80e||![0,8].includes(method)||local+30>start)invalid();
    const rawName=bytes.subarray(offset+46,offset+46+nameLength),name=new TextDecoder('utf-8',{fatal:true}).decode(rawName);
    if(!name||names.has(name)||name.includes('..')||name.includes('\\')||name.startsWith('/')||name.includes('\0'))invalid();
    names.add(name);
    if(bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+6)!==flags||bytes.readUInt16LE(local+8)!==method||bytes.readUInt16LE(local+26)!==nameLength)invalid();
    const data=local+30+nameLength+bytes.readUInt16LE(local+28);
    if(data+size>start||!rawName.equals(bytes.subarray(local+30,local+30+nameLength)))invalid();
    const localCrc=bytes.readUInt32LE(local+14),localSize=bytes.readUInt32LE(local+18),localOriginal=bytes.readUInt32LE(local+22);
    if(flags&8){
      if((localCrc&&localCrc!==crc)||(localSize&&localSize!==size)||(localOriginal&&localOriginal!==original))invalid();
    }else if(localCrc!==crc||localSize!==size||localOriginal!==original)invalid();
    if(method===0&&size!==original)invalid();
    let finish=data+size;
    if(flags&8){
      if(finish+12>start)invalid();
      const descriptor=bytes.readUInt32LE(finish)===0x08074b50?finish+4:finish;
      if(descriptor+12>start||bytes.readUInt32LE(descriptor)!==crc||bytes.readUInt32LE(descriptor+4)!==size||bytes.readUInt32LE(descriptor+8)!==original)invalid();
      finish=descriptor+12;
    }
    const xml=name.endsWith('.xml')||name.endsWith('.rels'),media=name===requestedMedia;
    const selected=xml||media;
    if(xml){total+=original;if(original>XML_LIMIT||total>TOTAL_LIMIT)throw new Error('Office XML 解压大小超过处理限制。');}
    if(media&&original>XML_LIMIT)throw new Error('Office 图片解压大小超过处理限制。');
    entries.push({name,local,data,finish,size,original,method,crc,selected});offset=next;
  }
  if(offset!==end)invalid();
  const ranges=[...entries].sort((a,b)=>a.local-b.local);
  for(let i=1;i<ranges.length;i++)if(ranges[i].local<ranges[i-1].finish)invalid();
  const files=Object.create(null);
  for(const entry of entries){
    if(!entry.selected)continue;
    const compressed=bytes.subarray(entry.data,entry.data+entry.size);
    // Unlike fflate's fixed output buffer, zlib rejects output beyond this limit.
    const output=entry.method===0?compressed:inflateRawSync(compressed,{maxOutputLength:Math.max(1,entry.original)});
    if(output.length!==entry.original||crc32(output)!==entry.crc)invalid();
    files[entry.name]=output;
  }
  return files;
}
export function officeMediaFile(input,asset){return officeFiles(input,asset)[asset];}
