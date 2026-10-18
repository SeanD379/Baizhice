import { beforeEach, expect, it, vi } from 'vitest';

const transaction = vi.hoisted(() => ({ material: { findMany: vi.fn(), updateMany: vi.fn() }, folder: { findUnique: vi.fn() } }));
const db = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/material-import', () => ({ storeMaterial: vi.fn() }));
import { PATCH } from './route';

const records = ['a', 'b'].map(id => ({ id, courseId: 'course', folderId: null, name: `${id}.pdf`, mime: 'application/pdf', size: 10, hash: id, filePath: 'private', fixture: null, chapter: '原章节', status: 'ready', excluded: false, origin: 'test', createdAt: new Date('2026-09-28') }));
const request = (patch: Record<string, unknown> = {}) => new Request('http://127.0.0.1:4173/api/materials', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ courseId: 'course', materialIds: ['a', 'b'], folderId: 'folder', ...patch }) });

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async callback => callback(transaction));
  transaction.folder.findUnique.mockResolvedValue({ id: 'folder', courseId: 'course' });
  transaction.material.findMany.mockResolvedValueOnce(records).mockResolvedValue(records.map(m => ({ ...m, folderId: 'folder' })));
  transaction.material.updateMany.mockResolvedValue({ count: 2 });
});

it('updates the entire batch in one transaction, changing only folderId', async () => {
  const response = await PATCH(request());
  expect(response.status).toBe(200);
  expect(db.$transaction).toHaveBeenCalledOnce();
  expect(transaction.material.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] }, courseId: 'course' }, data: { folderId: 'folder' } });
  const body = await response.json();
  expect(body.materials).toHaveLength(2);
  expect(body.materials[0]).toMatchObject({ folderId: 'folder', chapter: '原章节' });
  expect(body.materials[0]).not.toHaveProperty('filePath');
});

it.each(['missing', 'other-course', 'other-folder-course'])('rejects %s before writing anything', async scenario => {
  if (scenario === 'missing') transaction.material.findMany.mockReset().mockResolvedValue([records[0]]);
  if (scenario === 'other-course') transaction.material.findMany.mockReset().mockResolvedValue([records[0], { ...records[1], courseId: 'other' }]);
  if (scenario === 'other-folder-course') transaction.folder.findUnique.mockResolvedValue({ courseId: 'other' });
  expect((await PATCH(request())).status).toBe(400);
  expect(transaction.material.updateMany).not.toHaveBeenCalled();
});

it('allows uncategorizing and deduplicates ids', async () => {
  expect((await PATCH(request({ materialIds: ['a', 'b', 'a'], folderId: null }))).status).toBe(200);
  expect(transaction.folder.findUnique).not.toHaveBeenCalled();
  expect(transaction.material.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['a', 'b'] }, courseId: 'course' }, data: { folderId: null } }));
});

it('does not report a write failure as success', async () => {
  transaction.material.updateMany.mockRejectedValue(new Error('整批保存失败'));
  const response = await PATCH(request());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: '整批保存失败' });
});

it('rejects empty selections and foreign origins', async () => {
  expect((await PATCH(request({ materialIds: [] }))).status).toBe(400);
  const foreign = request(); foreign.headers.set('origin', 'https://example.com');
  expect((await PATCH(foreign)).status).toBe(400);
  expect(db.$transaction).not.toHaveBeenCalled();
});
