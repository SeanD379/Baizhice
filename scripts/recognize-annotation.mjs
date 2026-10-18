import { readFile } from 'node:fs/promises';
import { recognizeImage } from './document-ocr.mjs';
try {
  const result=await recognizeImage(await readFile(process.argv[2]));
  process.stdout.write(JSON.stringify({text:result.text,confidence:result.confidence}));
} catch(error) { process.stderr.write(error.message); process.exitCode=1; }
