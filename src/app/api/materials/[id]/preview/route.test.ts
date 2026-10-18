import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ material: vi.fn(), preview: vi.fn(), access: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { material: { findUnique: mock.material } }, dataDir: 'private-test-data' }));
vi.mock('@/lib/private-access', () => ({ requirePrivateAccess: mock.access }));
vi.mock('@/lib/office-preview', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/office-preview')>(), readOfficePreview: mock.preview }));
import { GET } from './route';
import { OfficePreviewError } from '@/lib/office-preview';

const material = { id: 'slide', name: '课堂讲义.pptx', filePath: 'private.pptx' };
const request = () => new Request('http://127.0.0.1/api/materials/slide/preview');
const context = { params: Promise.resolve({ id: 'slide' }) };

beforeEach(() => {
  vi.clearAllMocks(); mock.access.mockResolvedValue(null); mock.material.mockResolvedValue(material);
  mock.preview.mockResolvedValue(Buffer.from('%PDF-1.7\noriginal layout'));
});

it('returns the locally rendered PDF while keeping the source name private and encoded', async () => {
  const response = await GET(request(), context);
  expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/pdf');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('课堂讲义.pdf'));
  expect(response.headers.get('content-disposition')).not.toContain('private.pptx');
  expect(await response.text()).toContain('original layout'); expect(mock.preview).toHaveBeenCalledWith(material);
});

it('denies private access before loading material data', async () => {
  mock.access.mockResolvedValue(new Response('login', { status: 401 }));
  expect((await GET(request(), context)).status).toBe(401); expect(mock.material).not.toHaveBeenCalled();
});

it('rejects foreign origins before starting an Office job', async () => {
  const foreign = new Request('http://127.0.0.1/api/materials/slide/preview', { headers: { origin: 'https://other.example' } });
  expect((await GET(foreign, context)).status).toBe(400); expect(mock.preview).not.toHaveBeenCalled();
});

it('returns 404 for a missing material', async () => {
  mock.material.mockResolvedValue(null);
  expect((await GET(request(), context)).status).toBe(404); expect(mock.preview).not.toHaveBeenCalled();
});

it('returns a readable conversion failure without hiding its status', async () => {
  mock.preview.mockRejectedValue(new OfficePreviewError('本机预览转换不可用，请下载原文件查看。', 503));
  const response = await GET(request(), context);
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: '本机预览转换不可用，请下载原文件查看。' });
});
