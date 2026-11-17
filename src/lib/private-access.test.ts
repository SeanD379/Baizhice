import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => vi.fn());
const remoteSession = vi.hoisted(() => vi.fn());
vi.mock('./auth', () => ({ privateCloudEnabled: () => process.env.PRIVATE_CLOUD === '1' || process.env.NODE_ENV === 'production', getAuth: () => ({ api: { getSession: session } }) }));
vi.mock('./remote-auth', () => ({ remoteAuthOrigin: () => process.env.REMOTE_AUTH_URL || null, readRemoteSession: remoteSession }));
import { privateSession, requirePrivateAccess } from './private-access';
import { workspaceContext } from './workspace-context';
const request = () => new Request('https://study.example.com/api/files/private');
beforeEach(() => vi.stubEnv('REMOTE_AUTH_URL', ''));
afterEach(() => { vi.unstubAllEnvs(); session.mockReset(); remoteSession.mockReset(); });
it('denies unauthenticated cloud access before reading data', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); session.mockResolvedValue(null);
  expect((await requirePrivateAccess(request()))?.status).toBe(401);
});
it('accepts verified registered sessions but fails closed without a selected workspace', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); vi.stubEnv('PRIVATE_OWNER_EMAIL', 'owner@example.com');
  session.mockResolvedValue({ user: { id: 'registered-id', email: 'other@example.com' } });
  expect((await privateSession(request().headers))?.user.id).toBe('registered-id');
  expect((await requirePrivateAccess(request()))?.status).toBe(503);
  session.mockResolvedValue({ user: { email: 'OWNER@example.com' } }); expect((await requirePrivateAccess(request()))?.status).toBe(503);
});
it('fails closed when the login configuration is unavailable', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); session.mockRejectedValue(new Error('Missing configuration'));
  expect((await requirePrivateAccess(request()))?.status).toBe(503);
});
it('always protects production even when the local-development flag is off', async () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PRIVATE_CLOUD', '0'); session.mockResolvedValue(null);
  expect((await requirePrivateAccess(request()))?.status).toBe(401);
});
it('uses the server identity and still permits only the configured private owner', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); vi.stubEnv('REMOTE_AUTH_URL', 'https://study.example.com'); vi.stubEnv('PRIVATE_OWNER_EMAIL', 'owner@example.com');
  remoteSession.mockResolvedValueOnce({ user: { email: 'OWNER@example.com' } });
  expect((await privateSession(request().headers))?.user.email).toBe('OWNER@example.com');
  expect(session).not.toHaveBeenCalled();
  remoteSession.mockResolvedValueOnce({ user: { email: 'someone-else@example.com' } });
  expect((await requirePrivateAccess(request()))?.status).toBe(401);
});
it('permits learning handlers only inside the authenticated workspace scope', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1');
  const result = await workspaceContext.run({ id:'user-a', kind:'user', dataDir:'/isolated/user-a', db:{} as never }, () => requirePrivateAccess(request()));
  expect(result).toBeNull();
  expect(session).not.toHaveBeenCalled();
});
it('does not grant local data access when the server session is gone or unavailable', async () => {
  vi.stubEnv('PRIVATE_CLOUD', '1'); vi.stubEnv('REMOTE_AUTH_URL', 'https://study.example.com'); vi.stubEnv('PRIVATE_OWNER_EMAIL', 'owner@example.com');
  remoteSession.mockResolvedValueOnce(null);
  expect((await requirePrivateAccess(request()))?.status).toBe(401);
  remoteSession.mockRejectedValueOnce(new Error('server unavailable'));
  expect((await requirePrivateAccess(request()))?.status).toBe(503);
});
