import { afterAll, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({ context: undefined as AsyncLocalStorage<string> | undefined, release: undefined as Promise<void> | undefined }));
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), platform: () => 'win32' }));
vi.mock('./db', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const { mkdtemp } = await import('node:fs/promises');
  const path = await import('node:path');
  const { tmpdir } = await import('node:os');
  state.context = new AsyncLocalStorage<string>();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'lms-workspace-files-owner-'));
  return { dataDir, getDataDir: () => state.context!.getStore() ?? dataDir, db: {
    material: { findMany: async () => [{ id: 'm', hash: 'source' }], findUnique: async () => null, update: async () => ({}) },
    materialAnnotation: { findFirst: async () => ({}) },
  } };
});
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: async (_file: string, args: string[]) => {
    await state.release;
    if (args.includes('-OutputPath')) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(args[args.indexOf('-OutputPath') + 1], `%PDF-1.7\n${'slide '.repeat(40)}`);
      return { stdout: '{"ok":true}', stderr: '' };
    }
    return { stdout: JSON.stringify({ state: 'complete', pageCount: 1, sourceCount: 1, durationMs: 1, updatedAt: 'new', pages: [{ page: 1, text: args[1], method: 'text', state: 'extracted', warnings: [] }] }), stderr: '' };
  } }) };
});
import { dataDir } from './db';
import { extractMaterial, readExtraction } from './extraction';
import { readGeneration, saveGeneration, type StoredGeneration } from './generation-store';
import { questionImportReports } from './material-auto-import';
import { readAnnotationImage } from './material-annotation-store';
import { readOfficePreview } from './office-preview';

const otherDir = await mkdtemp(path.join(tmpdir(), 'lms-workspace-files-user-'));
const inDirectory = <T>(directory: string, action: () => T) => state.context!.run(directory, action);
afterAll(async () => { await Promise.all([dataDir, otherDir].map(directory => rm(directory, { recursive: true, force: true }))); });

it('reads extraction records with matching material IDs from the current workspace', async () => {
  for (const [directory, text] of [[dataDir, 'owner text'], [otherDir, 'user text']]) {
    await mkdir(path.join(directory, 'extractions'), { recursive: true });
    await writeFile(path.join(directory, 'extractions', 'm.json'), JSON.stringify({ state: 'complete', pageCount: 1, sourceCount: 1, durationMs: 1, updatedAt: 'old', pages: [{ page: 1, text, method: 'text', state: 'extracted', warnings: [] }] }));
  }
  expect((await inDirectory(otherDir, () => readExtraction('m')))?.pages[0].text).toBe('user text');
  expect((await inDirectory(dataDir, () => readExtraction('m')))?.pages[0].text).toBe('owner text');
});

it('keeps saved generation previews with the same ID in separate workspaces', async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  await inDirectory(dataDir, () => saveGeneration({ id, model: 'owner model' } as StoredGeneration));
  await inDirectory(otherDir, () => saveGeneration({ id, model: 'user model' } as StoredGeneration));
  expect((await inDirectory(dataDir, () => readGeneration(id))).model).toBe('owner model');
  expect((await inDirectory(otherDir, () => readGeneration(id))).model).toBe('user model');
});

it('reads import reports and annotation images from the requesting workspace', async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  for (const [directory, total, text] of [[dataDir, 3, 'owner image'], [otherDir, 7, 'user image']] as const) {
    await mkdir(path.join(directory, 'question-imports'), { recursive: true });
    await mkdir(path.join(directory, 'annotation-images'), { recursive: true });
    await writeFile(path.join(directory, 'question-imports', 'm.json'), JSON.stringify({ materialId: 'm', sourceHash: 'source', state: 'ready', total }));
    await writeFile(path.join(directory, 'annotation-images', `${id}.png`), text);
  }
  expect((await inDirectory(otherDir, () => questionImportReports('c')))[0].total).toBe(7);
  expect((await inDirectory(dataDir, () => questionImportReports('c')))[0].total).toBe(3);
  expect((await inDirectory(otherDir, () => readAnnotationImage('m', id))).toString()).toBe('user image');
  expect((await inDirectory(dataDir, () => readAnnotationImage('m', id))).toString()).toBe('owner image');
});

it('does not join another workspace extraction job with the same material ID', async () => {
  let release!: () => void;
  state.release = new Promise<void>(resolve => { release = resolve; });
  const material = { id: 'parallel', mime: 'text/plain', fixture: null };
  const owner = inDirectory(dataDir, () => extractMaterial({ ...material, filePath: 'owner.txt' }));
  const user = inDirectory(otherDir, () => extractMaterial({ ...material, filePath: 'user.txt' }));
  release();
  const [ownerResult, userResult] = await Promise.all([owner, user]);
  expect(ownerResult.pages[0].text).toBe('owner.txt');
  expect(userResult.pages[0].text).toBe('user.txt');
  expect(JSON.parse(await readFile(path.join(otherDir, 'extractions', 'parallel.json'), 'utf8')).pages[0].text).toBe('user.txt');
});

it('caches office previews separately when workspaces reference the same source file', async () => {
  const filePath = path.join(dataDir, 'shared.pptx');
  await writeFile(filePath, 'presentation');
  const material = { id: 'same', name: 'shared.pptx', filePath };
  const results = await Promise.all([
    inDirectory(dataDir, () => readOfficePreview(material)),
    inDirectory(otherDir, () => readOfficePreview(material)),
  ]);
  expect(results.every(bytes => bytes.subarray(0, 5).toString() === '%PDF-')).toBe(true);
  const { readdir } = await import('node:fs/promises');
  expect((await readdir(path.join(dataDir, 'previews'))).filter(name => name.endsWith('.pdf'))).toHaveLength(1);
  expect((await readdir(path.join(otherDir, 'previews'))).filter(name => name.endsWith('.pdf'))).toHaveLength(1);
});
