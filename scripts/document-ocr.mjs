import { access } from 'node:fs/promises';
import path from 'node:path';

export async function recognizeImage(bytes,timeoutMs=35000){
  const modelPath=path.join(path.resolve(process.env.DATA_DIR || 'data'),'ocr-models');
  try{await access(path.join(modelPath,'chi_sim.traineddata.gz'));}catch{throw new Error('本机 OCR 语言文件未安装，请先运行 npm run ocr:setup。');}
  const {createWorker,PSM}=await import('tesseract.js');
  let worker,timer,expired=false;
  try{
    return await Promise.race([
      (async()=>{
        const {default:sharp}=await import('sharp');
        const image=sharp(bytes,{limitInputPixels:40000000}),metadata=await image.metadata();
        const scale=Math.min(1,Math.sqrt(4000000/((metadata.width||1)*(metadata.height||1))),4096/Math.max(metadata.width||1,metadata.height||1));
        let prepared=await image.rotate().flatten({background:'#ffffff'}).resize({width:Math.max(1,Math.round((metadata.width||1)*scale)),height:Math.max(1,Math.round((metadata.height||1)*scale)),fit:'inside',withoutEnlargement:true}).grayscale().normalize().png().toBuffer();
        const {data:pixels,info}=await sharp(prepared).resize({width:400,height:400,fit:'inside'}).raw().toBuffer({resolveWithObject:true});
        const rows=Array(info.height).fill(0),columns=Array(info.width).fill(0);
        for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(pixels[(y*info.width+x)*info.channels]<160){rows[y]+=1/info.width;columns[x]+=1/info.height;}
        const variance=values=>{const mean=values.reduce((a,b)=>a+b,0)/values.length;return values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length;};
        let rotation=variance(columns)>variance(rows)*1.5?90:0,orientation=rotation?'projection':'none';
        if(rotation)prepared=await sharp(prepared).rotate(rotation).toBuffer();
        const created=await createWorker('chi_sim',1,{langPath:modelPath,cacheMethod:'none',gzip:true,errorHandler:()=>{}});
        if(expired){await created.terminate();throw new Error('OCR 初始化超时。');}
        worker=created;
        await worker.setParameters({tessedit_pageseg_mode:PSM.AUTO,user_defined_dpi:'150'});
        let {data}=await worker.recognize(prepared,{rotateAuto:true},{text:true,blocks:true});
        if(data.text.trim()&&data.confidence<75&&!expired){
          const flipped=await sharp(prepared).rotate(180).toBuffer(),alternative=await worker.recognize(flipped,{rotateAuto:true},{text:true,blocks:true});
          if(alternative.data.confidence>data.confidence){data=alternative.data;prepared=flipped;rotation=(rotation+180)%360;orientation='confidence';}
        }
        const size=await sharp(prepared).metadata();
        const lines=(data.blocks??[]).flatMap(block=>(block.paragraphs??[]).flatMap(paragraph=>(paragraph.lines??[]).map(line=>({text:line.text.trim(),confidence:line.confidence,bbox:{x:line.bbox.x0,y:line.bbox.y0,width:line.bbox.x1-line.bbox.x0,height:line.bbox.y1-line.bbox.y0}}))));
        rotation+=Number(data.rotateRadians??0)*180/Math.PI;
        return {text:data.text.trim(),confidence:data.confidence,ocr:{rotation,orientation,preprocessing:['exif-orientation','white-background','bounded-resize','grayscale','normalize','deskew']},layout:{width:size.width,height:size.height,coordinateSystem:'image-top-left',rotation,lines}};
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new Error('此页 OCR 超过时间限制，请拆分或缩小后重试。'));},timeoutMs);}),
    ]);
  }finally{clearTimeout(timer);if(worker)await worker.terminate();}
}
