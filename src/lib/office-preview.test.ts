import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const mock = vi.hoisted(() => ({ platform: vi.fn(() => 'win32'), convert: vi.fn() }));
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), platform: mock.platform }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: mock.convert }) };
});
vi.mock('./db', async () => ({ dataDir: await (await import('node:fs/promises')).mkdtemp((await import('node:path')).join((await import('node:os')).tmpdir(), 'lms-preview-')) }));
import { dataDir } from './db';
import { readOfficePreview } from './office-preview';

const pdf = Buffer.from(`%PDF-1.7\n${'native slide layout '.repeat(20)}`);
let material: { id: string; name: string; filePath: string };
const convert = async (_file: string, args: string[]) => {
  if (!args.includes('-Cleanup')) await writeFile(args[args.indexOf('-OutputPath') + 1], pdf);
  return { stdout: '{"ok":true}', stderr: '' };
};

beforeEach(async () => {
  vi.clearAllMocks(); mock.platform.mockReturnValue('win32'); mock.convert.mockImplementation(convert);
  const source = await mkdtemp(path.join(dataDir, 'source-'));
  material = { id: source, name: 'lecture.pptx', filePath: path.join(source, 'lecture.pptx') };
  await writeFile(material.filePath, 'original presentation');
});
afterAll(async () => { await rm(dataDir, { recursive: true, force: true }); });

it('preserves the original, exports a private copy, and reuses its cached PDF', async () => {
  expect(await readOfficePreview(material)).toEqual(pdf); expect(await readOfficePreview(material)).toEqual(pdf);
  expect(mock.convert).toHaveBeenCalledTimes(1);
  const [executable, args, options] = mock.convert.mock.calls[0];
  expect(executable).toBe('powershell.exe'); expect(args[args.indexOf('-InputPath') + 1]).not.toBe(material.filePath);
  expect(options).toMatchObject({ windowsHide: true, timeout: 60000 });
  expect(await readFile(material.filePath, 'utf8')).toBe('original presentation');
  expect((await readdir(path.join(dataDir, 'previews'))).every(name => name.endsWith('.pdf'))).toBe(true);
});

it('shares a pending conversion for the same file', async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  mock.convert.mockImplementation(async (...args) => { await waiting; return convert(...args as [string, string[]]); });
  const first = readOfficePreview(material), second = readOfficePreview(material);
  await vi.waitFor(() => expect(mock.convert).toHaveBeenCalledTimes(1)); release();
  expect(await first).toEqual(pdf); expect(await second).toEqual(pdf); expect(mock.convert).toHaveBeenCalledTimes(1);
});

it('serializes different files so PowerPoint jobs do not overlap', async () => {
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  const secondMaterial = { ...material, id: 'second' };
  mock.convert.mockImplementationOnce(async (...args) => { await waiting; return convert(...args as [string, string[]]); });
  const first = readOfficePreview(material); await vi.waitFor(() => expect(mock.convert).toHaveBeenCalledTimes(1));
  const second = readOfficePreview(secondMaterial); await new Promise(resolve => setTimeout(resolve, 20));
  expect(mock.convert).toHaveBeenCalledTimes(1); release(); await Promise.all([first, second]);
  expect(mock.convert).toHaveBeenCalledTimes(2);
});

it('invalidates the cached preview when the source changes', async () => {
  await readOfficePreview(material); await writeFile(material.filePath, 'changed presentation with another slide');
  await readOfficePreview(material); expect(mock.convert).toHaveBeenCalledTimes(2);
});

it('rejects unsupported files and an unavailable platform without opening Office', async () => {
  await expect(readOfficePreview({ ...material, name: 'note.docx' })).rejects.toMatchObject({ status: 415 });
  mock.platform.mockReturnValue('linux');
  await expect(readOfficePreview(material)).rejects.toMatchObject({ status: 503 }); expect(mock.convert).not.toHaveBeenCalled();
});

it('reports missing originals without starting a conversion', async () => {
  await expect(readOfficePreview({ ...material, filePath: 'missing.pptx' })).rejects.toMatchObject({ status: 404 });
  expect(mock.convert).not.toHaveBeenCalled();
});

it('cleans up the owned Office job after timeout and allows a later retry', async () => {
  mock.convert.mockImplementationOnce(async () => { throw { killed: true }; });
  await expect(readOfficePreview(material)).rejects.toMatchObject({ status: 504 });
  expect(mock.convert.mock.calls[1][1]).toContain('-Cleanup');
  expect(await readOfficePreview(material)).toEqual(pdf);
});

it('reports unavailable PowerPoint and rejects invalid PDF output', async () => {
  mock.convert.mockImplementationOnce(async () => { throw { stdout: '{"errorCode":"unavailable"}' }; });
  await expect(readOfficePreview(material)).rejects.toMatchObject({ status: 503 });
  mock.convert.mockImplementationOnce(async (_file, args) => { await writeFile(args[args.indexOf('-OutputPath') + 1], 'not a PDF'); return { stdout: '', stderr: '' }; });
  await expect(readOfficePreview(material)).rejects.toMatchObject({ status: 502 });
  expect(await readOfficePreview(material)).toEqual(pdf);
});
