import { mkdir, writeFile, access, rename } from 'node:fs/promises';
import path from 'node:path';
const directory=path.join(path.resolve(process.env.DATA_DIR || 'data'),'ocr-models');
await mkdir(directory,{recursive:true});
for(const language of ['chi_sim']){
  const target=path.join(directory,`${language}.traineddata.gz`);
  try{await access(target);console.log(`${language}: already installed`);continue;}catch{}
  const url=`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`;
  const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error(`Language download failed: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes[0]!==0x1f||bytes[1]!==0x8b)throw new Error('Invalid language archive');
  await writeFile(`${target}.tmp`,bytes);await rename(`${target}.tmp`,target);
  console.log(`${language}: installed ${bytes.length} bytes`);
}
