import { beforeEach, expect, it, vi } from 'vitest';
import path from 'node:path';

const materialDb = vi.hoisted(() => ({ findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() }));
const folderDb = vi.hoisted(() => ({ findUnique: vi.fn() }));
const files = vi.hoisted(() => ({ readdir: vi.fn(), readFile: vi.fn(), unlink: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { material: materialDb, folder: folderDb }, dataDir: 'C:\\test\\data' }));
vi.mock('node:fs/promises', () => files);
vi.mock('@/lib/extraction', () => ({ isExtracting: vi.fn(() => false) }));

import { DELETE, PATCH } from './route';

const material = {
  id: 'note', courseId: 'probability', name: '冲突笔记.pdf', mime: 'application/pdf', size: 10,
  hash: 'hash', filePath: 'note.pdf', fixture: 'note', chapter: '事件独立性', status: 'review', excluded: false,
  conflictResolution: null, conflictFeedbackReason: null, conflictFeedbackNote: null, conflictResolvedAt: null,
  origin: 'test', createdAt: new Date('2026-09-22T00:00:00.000Z'),
};

const request = (body: unknown) => new Request('http://127.0.0.1/api/materials/note', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  materialDb.findUnique.mockResolvedValue(material);
  materialDb.findFirst.mockResolvedValue({ ...material, id: 'reference', fixture: 'independence', status: 'ready' });
  folderDb.findUnique.mockResolvedValue({ id: 'folder-a', courseId: 'probability' });
  materialDb.update.mockImplementation(async ({ data }) => ({ ...material, ...data }));
  materialDb.delete.mockResolvedValue(material);
  files.readdir.mockResolvedValue([]);
  files.unlink.mockResolvedValue(undefined);
});

it('moves a material to a folder in the same course', async () => {
  const response = await PATCH(request({ folderId: 'folder-a' }), { params: Promise.resolve({ id: 'note' }) });
  expect(response.status).toBe(200);
  expect(materialDb.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'note' }, data: { folderId: 'folder-a' } }));
});

it('rejects moving a material to another course folder', async () => {
  folderDb.findUnique.mockResolvedValue({ id: 'folder-b', courseId: 'other-course' });
  const response = await PATCH(request({ folderId: 'folder-b' }), { params: Promise.resolve({ id: 'note' }) });
  expect(response.status).toBe(400);
  expect(materialDb.update).not.toHaveBeenCalled();
});

it('adopts an available reference for a conflicted material', async () => {
  const response = await PATCH(request({ action: 'accept-reference' }), { params: Promise.resolve({ id: 'note' }) });

  expect(response.status).toBe(200);
  expect(materialDb.findFirst).toHaveBeenCalledWith({ where: { courseId: 'probability', fixture: 'independence', status: 'ready', excluded: false } });
  expect(materialDb.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'note' }, data: expect.objectContaining({ conflictResolution: 'accepted_reference' }),
  }));
});

it('stores a pause reason without changing the original file', async () => {
  const response = await PATCH(request({ action: 'pause-conflict', reason: 'outdated', note: '课程采用新版。' }), { params: Promise.resolve({ id: 'note' }) });

  expect(response.status).toBe(200);
  expect(materialDb.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'note' }, data: expect.objectContaining({
      conflictResolution: 'paused', conflictFeedbackReason: 'outdated', conflictFeedbackNote: '课程采用新版。',
    }),
  }));
});

it('deletes a material, its extraction, and its unshared original file', async () => {
  const filePath = path.join('C:\\test\\data', 'uploads', 'hash.pdf');
  materialDb.findUnique.mockResolvedValue({ ...material, filePath });
  materialDb.findFirst.mockResolvedValue(null);
  const response = await DELETE(new Request('http://127.0.0.1/api/materials/note', { method: 'DELETE' }), { params: Promise.resolve({ id: 'note' }) });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deleted: true, cleanupWarning: false });
  expect(materialDb.delete).toHaveBeenCalledWith({ where: { id: 'note' } });
  expect(files.unlink).toHaveBeenCalledWith(path.join('C:\\test\\data', 'extractions', 'note.json'));
  expect(files.unlink).toHaveBeenCalledWith(filePath);
});

it('keeps an original file used by another course', async () => {
  const filePath = path.join('C:\\test\\data', 'uploads', 'hash.pdf');
  materialDb.findUnique.mockResolvedValue({ ...material, filePath });
  materialDb.findFirst.mockResolvedValue({ ...material, id: 'other', courseId: 'another-course', filePath });
  const response = await DELETE(new Request('http://127.0.0.1/api/materials/note', { method: 'DELETE' }), { params: Promise.resolve({ id: 'note' }) });

  expect(response.status).toBe(200);
  expect(files.unlink).not.toHaveBeenCalledWith(filePath);
});

it('removes saved generation drafts containing the deleted material', async () => {
  const draftName = '00000000-0000-4000-8000-000000000000.json';
  const otherName = '11111111-1111-4111-8111-111111111111.json';
  files.readdir.mockResolvedValue([draftName, otherName]);
  files.readFile.mockImplementation(async (filePath: string) => JSON.stringify({ pages: [{ materialId: filePath.endsWith(draftName) ? 'note' : 'other' }] }));
  const response = await DELETE(new Request('http://127.0.0.1/api/materials/note', { method: 'DELETE' }), { params: Promise.resolve({ id: 'note' }) });

  expect(response.status).toBe(200);
  expect(files.unlink).toHaveBeenCalledWith(path.join('C:\\test\\data', 'generations', draftName));
  expect(files.unlink).not.toHaveBeenCalledWith(path.join('C:\\test\\data', 'generations', otherName));
});
