import { beforeEach, expect, it, vi } from 'vitest';

const folder = vi.hoisted(() => ({ create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() }));
const course = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { folder, course } }));

import { POST, PATCH, DELETE } from './route';

const request = (method: string, body: unknown) => new Request('http://127.0.0.1/api/folders', {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  course.findUnique.mockResolvedValue({ id: 'course-a' });
  folder.findUnique.mockResolvedValue({ id: 'folder-a', courseId: 'course-a', name: '讲义', parentId: null });
  folder.findFirst.mockResolvedValue(null);
  folder.create.mockImplementation(async ({ data }) => ({ id: 'folder-a', ...data }));
  folder.update.mockImplementation(async ({ data }) => ({ id: 'folder-a', courseId: 'course-a', ...data }));
  folder.delete.mockResolvedValue({ id: 'folder-a' });
});

it('creates a course folder with a trimmed name', async () => {
  const response = await POST(request('POST', { courseId: 'course-a', name: '  阅读理解  ' }));
  expect(response.status).toBe(200);
  expect(folder.create).toHaveBeenCalledWith({ data: { courseId: 'course-a', name: '阅读理解', parentId: null } });
});

it('creates a child folder under a parent in the same course', async () => {
  const response = await POST(request('POST', { courseId: 'course-a', name: '古诗词', parentId: 'folder-a' }));
  expect(response.status).toBe(200);
  expect(folder.create).toHaveBeenCalledWith({ data: { courseId: 'course-a', name: '古诗词', parentId: 'folder-a' } });
  expect(folder.findFirst).toHaveBeenCalledWith({ where: { courseId: 'course-a', parentId: 'folder-a', name: '古诗词' } });
});

it.each([null, { id: 'folder-a', courseId: 'course-b' }])('rejects a missing or cross-course parent %j', async parent => {
  folder.findUnique.mockResolvedValue(parent);
  const response = await POST(request('POST', { courseId: 'course-a', name: '古诗词', parentId: 'folder-a' }));
  expect(response.status).toBe(400);
  expect(folder.create).not.toHaveBeenCalled();
});

it('rejects duplicate sibling names', async () => {
  folder.findFirst.mockResolvedValue({ id: 'existing' });
  const response = await POST(request('POST', { courseId: 'course-a', name: '古诗词', parentId: 'folder-a' }));
  expect(response.status).toBe(400);
  expect(folder.create).not.toHaveBeenCalled();
});

it('rejects a folder for a missing course', async () => {
  course.findUnique.mockResolvedValue(null);
  const response = await POST(request('POST', { courseId: 'missing', name: '讲义' }));
  expect(response.status).toBe(400);
  expect(folder.create).not.toHaveBeenCalled();
});

it('renames a folder without moving its materials', async () => {
  const response = await PATCH(request('PATCH', { id: 'folder-a', name: '课本笔记' }));
  expect(response.status).toBe(200);
  expect(folder.update).toHaveBeenCalledWith({ where: { id: 'folder-a' }, data: { name: '课本笔记' } });
});

it('checks the same parent when renaming a child folder', async () => {
  folder.findUnique.mockResolvedValue({ id: 'child', courseId: 'course-a', parentId: 'folder-a' });
  folder.findFirst.mockResolvedValue({ id: 'sibling' });
  const response = await PATCH(request('PATCH', { id: 'child', name: '古诗词' }));
  expect(response.status).toBe(400);
  expect(folder.findFirst).toHaveBeenCalledWith({ where: { courseId: 'course-a', parentId: 'folder-a', name: '古诗词', id: { not: 'child' } } });
  expect(folder.update).not.toHaveBeenCalled();
});

it('deletes the folder record so its materials return to uncategorized via the database relation', async () => {
  const response = await DELETE(request('DELETE', { id: 'folder-a' }));
  expect(response.status).toBe(200);
  expect(folder.delete).toHaveBeenCalledWith({ where: { id: 'folder-a' } });
});
