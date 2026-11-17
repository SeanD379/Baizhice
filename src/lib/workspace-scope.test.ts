import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { LearningSession, WorkspaceContext } from './workspace-context';

const state = vi.hoisted(() => ({ session: null as LearningSession | null, enabled: true, directory: '' }));
vi.mock('./auth', () => ({ privateCloudEnabled: () => state.enabled }));
vi.mock('./private-access', () => ({ privateSession: async () => state.session }));
vi.mock('./db', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  state.directory = await mkdtemp(path.join(tmpdir(), 'lms-workspace-scope-'));
  return { dataDir: state.directory, authDb: { $queryRawUnsafe: async () => [] } };
});
import { withWorkspace } from './workspace-scope';
import { workspaceContext } from './workspace-context';

beforeEach(() => { state.enabled = true; state.session = null; vi.stubEnv('PRIVATE_OWNER_EMAIL', 'owner@example.invalid'); });
afterAll(async () => {
  const contexts = (globalThis as { learningWorkspaces?: Map<string, Promise<WorkspaceContext>> }).learningWorkspaces;
  if (contexts) for (const pending of contexts.values()) await (await pending).db.$disconnect();
  contexts?.clear();
  const directory = path.resolve(state.directory);
  if (!directory.startsWith(path.join(tmpdir(), 'lms-workspace-scope-'))) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function session(kind: 'owner' | 'user' | 'guest'): LearningSession {
  return { user: { id: `test-${kind}`, email: `${kind}@example.invalid` }, ...(kind === 'guest' ? { guest: true, expiresAt: Date.now() + 60_000 } : {}) };
}
const identities = { owner: 'owner', user: 'user-f85ac825d102b9f2d546aa1679ea991ae845994c1343730d564f3fcd0a2168c3', guest: 'guest-f694ea3bb9e0f87197093b9fbce5cfd1a3beafef103b29d07cc3d10deb41eb46' };

it.each(['user', 'guest'] as const)('rejects old headerless %s writes before executing the learning handler', async kind => {
  state.session = session(kind);
  for (const header of [undefined, '']) {
    let writes = 0;
    const handler = withWorkspace(async () => { writes++; return new Response('saved'); });
    const response = await handler(new Request('https://example.invalid/api/notebook-assets', { method: 'POST', headers: header === undefined ? {} : { 'X-LMS-Workspace': header } }));
    expect(response.status).toBe(409); expect(response.headers.get('X-LMS-Workspace-Changed')).toBe('1'); expect(writes).toBe(0);
  }
});
it.each(['owner', 'user', 'guest'] as const)('allows a matching %s identity and rejects a mismatched identity', async kind => {
  state.session = session(kind);
  let writes = 0;
  const handler = withWorkspace(async () => { writes++; return Response.json({ kind: workspaceContext.getStore()?.kind }); });
  const matching = await handler(new Request('https://example.invalid/api/workspace', { method: 'POST', headers: { 'X-LMS-Workspace': identities[kind] } }));
  expect(matching.status).toBe(200); expect(await matching.json()).toEqual({ kind }); expect(writes).toBe(1);
  const wrong = await handler(new Request('https://example.invalid/api/workspace', { method: 'POST', headers: { 'X-LMS-Workspace': 'another-account' } }));
  expect(wrong.status).toBe(409); expect(writes).toBe(1);
});
it('preserves headerless legacy owner writes', async () => {
  state.session = session('owner');
  const handler = withWorkspace(async () => Response.json({ kind: workspaceContext.getStore()?.kind }));
  const response = await handler(new Request('https://example.invalid/api/workspace', { method: 'POST' }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ kind: 'owner' });
});
it.each(['GET', 'HEAD'])('preserves headerless %s reads for ordinary browser file requests', async method => {
  state.session = session('user');
  expect((await withWorkspace(async () => new Response(null))(new Request('https://example.invalid/api/files/example', { method }))).status).toBe(200);
});
it('denies unauthenticated learning requests', async () => {
  expect((await withWorkspace(async () => new Response('must not run'))(new Request('https://example.invalid/api/workspace', { method: 'POST' }))).status).toBe(401);
});
it('preserves the local unauthenticated development workspace', async () => {
  state.enabled = false;
  expect((await withWorkspace(async () => new Response('local'))(new Request('https://example.invalid/api/workspace', { method: 'POST' }))).status).toBe(200);
});
