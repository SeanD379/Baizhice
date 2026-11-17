import { expect, it, vi } from 'vitest';

const courses = vi.hoisted(() => vi.fn(async () => [{ id: 'course', name: '测试课程', _count: { conversations: 73 } }]));
vi.mock('@/lib/db', () => ({ getDataDir:()=>'unused',dataDir:'unused', db: {
  course: { upsert: async () => ({}), findMany: courses },
  material: { findMany: async () => [] }, folder: { findMany: async () => [] }, version: { findMany: async () => [] },
} }));
vi.mock('@/lib/private-access', () => ({ requirePrivateAccess: async () => null }));
vi.mock('@/lib/auth', () => ({ privateCloudEnabled: () => false }));
import { GET } from './route';

it('returns the current course conversation total independently of the capped chat history', async () => {
  const response = await GET(new Request('http://127.0.0.1:4175/api/workspace'));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.courses[0]).toMatchObject({ id: 'course', conversationCount: 73 });
  expect(body.courses[0]).not.toHaveProperty('_count');
  expect(courses).toHaveBeenCalledWith(expect.objectContaining({ include: { _count: { select: { conversations: true } } } }));
});
