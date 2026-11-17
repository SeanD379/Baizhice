import { afterAll, expect, it, vi } from 'vitest';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({ context: undefined as AsyncLocalStorage<string> | undefined, ownerDir: '', wait: undefined as Promise<void> | undefined }));
vi.mock('./db', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const { mkdtemp } = await import('node:fs/promises');
  const path = await import('node:path');
  const { tmpdir } = await import('node:os');
  state.context = new AsyncLocalStorage<string>();
  const dataDir = state.ownerDir = await mkdtemp(path.join(tmpdir(), 'lms-workspace-queue-owner-'));
  const material = { id: 'same', courseId: 'c', hash: 'source', status: 'extracted', excluded: false, conflictResolution: null };
  return { dataDir, getDataDir: () => state.context!.getStore() ?? dataDir, db: { material: { findUnique: async () => material, findMany: async () => [material] } } };
});
vi.mock('./extraction', () => ({ readExtraction: async () => ({ pages: [] }), extractMaterial: vi.fn() }));
vi.mock('./question-bank-store', () => ({ prepareQuestionBanks: async () => {
  const owner = state.context!.getStore() === state.ownerDir;
  if (owner) await state.wait;
  return [{ questions: Array.from({ length: owner ? 1 : 2 }, () => ({ kind: 'single', answerSource: 'original', warnings: [] })), error: '' }];
} }));
import { dataDir } from './db';
import { questionImportReports, queueMaterialImport } from './material-auto-import';

const userDir = await mkdtemp(path.join(tmpdir(), 'lms-workspace-queue-user-'));
const inDirectory = <T>(directory: string, action: () => T) => state.context!.run(directory, action);
afterAll(async () => { await Promise.all([dataDir, userDir].map(directory => rm(directory, { recursive: true, force: true }))); });

it('runs a queued material import in its original workspace after another workspace releases the worker', async () => {
  let release!: () => void;
  state.wait = new Promise<void>(resolve => { release = resolve; });
  inDirectory(dataDir, () => queueMaterialImport('same'));
  await vi.waitFor(async () => expect((await inDirectory(dataDir, () => questionImportReports('c')))[0]?.state).toBe('running'), { timeout: 5000 });
  inDirectory(userDir, () => queueMaterialImport('same'));
  release();
  await vi.waitFor(async () => {
    const owner = await inDirectory(dataDir, () => questionImportReports('c'));
    const user = await inDirectory(userDir, () => questionImportReports('c'));
    expect(owner[0]).toMatchObject({ state: 'ready', total: 1 });
    expect(user[0]?.error).toBe('');
    expect(user[0]).toMatchObject({ state: 'ready', total: 2 });
  }, { timeout: 5000 });
});
