import { afterEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => vi.fn());
vi.mock('./auth', () => ({ privateCloudEnabled: () => process.env.PRIVATE_CLOUD === '1' || process.env.NODE_ENV === 'production', getAuth: () => ({ api: { getSession: session } }) }));
import { requirePrivateAccess } from './private-access';
const request = () => new Request('https://study.example.com/api/files/private');
afterEach(() => { vi.unstubAllEnvs(); session.mockReset(); });
it('denies unauthenticated cloud access before reading data', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); session.mockResolvedValue(null);
  expect((await requirePrivateAccess(request()))?.status).toBe(401);
});
it('permits only the fixed private account', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); vi.stubEnv('PRIVATE_OWNER_EMAIL', 'owner@example.com');
  session.mockResolvedValue({ user: { email: 'other@example.com' } }); expect((await requirePrivateAccess(request()))?.status).toBe(401);
  session.mockResolvedValue({ user: { email: 'OWNER@example.com' } }); expect(await requirePrivateAccess(request())).toBeNull();
});
it('fails closed when the login configuration is unavailable', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); session.mockRejectedValue(new Error('Missing configuration'));
  expect((await requirePrivateAccess(request()))?.status).toBe(503);
});
it('always protects production even when the local-development flag is off', async () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PRIVATE_CLOUD', '0'); session.mockResolvedValue(null);
  expect((await requirePrivateAccess(request()))?.status).toBe(401);
});
