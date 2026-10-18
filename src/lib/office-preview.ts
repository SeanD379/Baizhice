import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import { platform } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { dataDir } from './db';

const exec = promisify(execFile);
const directory = path.join(dataDir, 'previews');
const script = path.join(process.cwd(), 'scripts', 'preview-office.ps1');
const globalPreview = globalThis as unknown as { officePreviewQueue?: { jobs: Map<string, Promise<Buffer>>; tail: Promise<unknown> } };
const queue = globalPreview.officePreviewQueue ??= { jobs: new Map(), tail: Promise.resolve() };

export class OfficePreviewError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function cachedPdf(filePath: string) {
  try {
    const bytes = await readFile(filePath);
    if (bytes.length > 100 && bytes.subarray(0, 5).toString() === '%PDF-') return bytes;
    await unlink(filePath);
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Local Windows PowerPoint export; the browser renders DOCX directly. */
export async function readOfficePreview(material: { id: string; name: string; filePath: string }): Promise<Buffer> {
  if (!/\.pptx$/i.test(material.name)) throw new OfficePreviewError('这份文件不使用幻灯片转换，请查看原文件预览或下载原文件。', 415);
  if (platform() !== 'win32') throw new OfficePreviewError('当前服务器未配置 PowerPoint 原文件预览转换器，请下载原文件查看。', 503);
  let source;
  try { source = await stat(material.filePath); }
  catch { throw new OfficePreviewError('原文件不可访问，请重新上传。', 404); }
  const fingerprint = createHash('sha256').update(JSON.stringify(['powerpoint-pdf-1', material.id, material.filePath, source.size, source.mtimeMs])).digest('hex');
  const existing = queue.jobs.get(fingerprint);
  if (existing) return existing;
  const destination = path.join(directory, `${fingerprint}.pdf`);
  const cached = await cachedPdf(destination);
  if (cached) return cached;
  const pending = queue.jobs.get(fingerprint);
  if (pending) return pending;
  const task = queue.tail.catch(() => {}).then(async () => {
    await mkdir(directory, { recursive: true });
    const temporary = await mkdtemp(path.join(directory, '.job-'));
    const input = path.join(temporary, 'source.pptx'), output = path.join(temporary, 'preview.pdf'), marker = path.join(temporary, 'process.json');
    try {
      await copyFile(material.filePath, input);
      try {
        await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputPath', input, '-OutputPath', output, '-ProcessMarker', marker], { cwd: process.cwd(), timeout: 60000, maxBuffer: 64 * 1024, windowsHide: true });
      } catch (error) {
        const failure = error as { killed?: boolean; code?: string; stdout?: string };
        // The script checks the recorded PID and start time before stopping its own Office process.
        await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProcessMarker', marker, '-Cleanup'], { timeout: 10000, maxBuffer: 64 * 1024, windowsHide: true }).catch(() => {});
        if (failure.killed) throw new OfficePreviewError('幻灯片预览转换超时，请稍后重试或下载原文件查看。', 504);
        if (failure.code === 'ENOENT' || failure.stdout?.includes('"unavailable"')) throw new OfficePreviewError('本机未安装可用的 PowerPoint 原文件预览转换器，请下载原文件查看。', 503);
        throw new OfficePreviewError('PowerPoint 无法预览这份文件，请检查文件完整性或下载原文件查看。', 502);
      }
      const bytes = await cachedPdf(output);
      if (!bytes) throw new OfficePreviewError('幻灯片预览未生成有效页面，请下载原文件查看。', 502);
      await rename(output, destination);
      return bytes;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
  queue.jobs.set(fingerprint, task);
  queue.tail = task.then(() => {}, () => {});
  void task.finally(() => queue.jobs.delete(fingerprint)).catch(() => {});
  return task;
}
