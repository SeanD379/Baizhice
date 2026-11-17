import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { authDb, dataDir } from './db';
import { privateCloudEnabled } from './auth';
import { privateSession } from './private-access';
import { workspaceContext, type LearningSession, type WorkspaceContext } from './workspace-context';

const globalWorkspaces = globalThis as unknown as { learningWorkspaces?: Map<string, Promise<WorkspaceContext>> };
const workspaces = globalWorkspaces.learningWorkspaces ??= new Map<string, Promise<WorkspaceContext>>();
const authTables = new Set(['User', 'Session', 'Account', 'Verification', '_prisma_migrations']);

export function workspaceIdentity(session: LearningSession) {
  if (!session.guest && session.user.email.toLowerCase() === process.env.PRIVATE_OWNER_EMAIL?.toLowerCase()) return { id: 'owner', kind: 'owner' as const };
  if (!session.user.id) throw new Error('账号身份无效，请重新登录。');
  const kind = session.guest ? 'guest' as const : 'user' as const;
  const hash = createHash('sha256').update(session.user.id).digest('hex');
  return { id: `${kind}-${hash}`, kind };
}

export async function learningWorkspace(session: LearningSession): Promise<WorkspaceContext> {
  const identity = workspaceIdentity(session);
  if (identity.kind === 'owner') return { ...identity, db: authDb, dataDir };
  let pending = workspaces.get(identity.id);
  if (!pending) {
    pending = (async () => {
      const directory = path.join(dataDir, 'workspaces', identity.kind === 'guest' ? 'guests' : 'users', identity.id);
      await mkdir(path.join(directory, 'uploads'), { recursive: true });
      const client = new PrismaClient({ datasourceUrl: `file:${path.join(directory, 'learning.db').replaceAll('\\', '/')}` });
      try {
        const schema = await authDb.$queryRawUnsafe<{ type: string; name: string; tbl_name: string; sql: string }[]>("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index') ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END");
        for (const item of schema) {
          if (authTables.has(item.tbl_name) || item.name.startsWith('sqlite_')) continue;
          const sql = item.sql.replace(/^CREATE (UNIQUE )?INDEX /i, 'CREATE $1INDEX IF NOT EXISTS ').replace(/^CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ');
          await client.$executeRawUnsafe(sql);
        }
        const context: WorkspaceContext = { ...identity, db: client, dataDir: directory, expiresAt: session.expiresAt };
        if (session.guest) await writeFile(path.join(directory, 'guest.json'), JSON.stringify({ expiresAt: session.expiresAt }));
        return context;
      } catch (error) { await client.$disconnect(); throw error; }
    })();
    workspaces.set(identity.id, pending);
    pending.catch(() => workspaces.delete(identity.id));
  }
  return pending;
}

export function withWorkspace<Args extends unknown[]>(handler: (request: Request, ...args: Args) => Promise<Response>) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    if (!privateCloudEnabled()) return handler(request, ...args);
    try {
      const session = await privateSession(request.headers);
      if (!session) return NextResponse.json({ error: '请先登录你的学习空间。' }, { status: 401 });
      const context = await learningWorkspace(session);
      const expected = request.headers.get('x-lms-workspace');
      const missingWriteScope = !expected && context.kind !== 'owner' && !['GET', 'HEAD'].includes(request.method);
      if (missingWriteScope || (expected && expected !== context.id)) return NextResponse.json({ error: '账号已切换，请刷新后重试。' }, { status: 409, headers: { 'X-LMS-Workspace-Changed': '1' } });
      return await workspaceContext.run(context, async () => {
        const response = await handler(request, ...args);
        response.headers.set('Cache-Control', 'private, no-store');
        return response;
      });
    } catch {
      return NextResponse.json({ error: '学习空间暂不可用，请稍后重试。' }, { status: 503 });
    }
  };
}

export async function seedGuestWorkspace(session: LearningSession) {
  const context = await learningWorkspace(session);
  await workspaceContext.run(context, async () => {
    if (await context.db.material.count()) return;
    await context.db.course.upsert({ where: { id: 'probability' }, create: { id: 'probability', name: '概率论 · 游客体验' }, update: {} });
    const { storeMaterial } = await import('./material-import');
    const { sampleBytes } = await import('./server');
    const { sampleInfo } = await import('./content');
    for (const key of ['conditional', 'independence', 'note'] as const) await storeMaterial(await sampleBytes(key), sampleInfo[key].name, 'probability');
  });
}

export async function removeExpiredGuests() {
  const root = path.resolve(dataDir, 'workspaces', 'guests');
  let names: string[];
  try { names = await readdir(root); } catch { return; }
  for (const name of names) {
    if (!/^guest-[a-f0-9]{64}$/.test(name)) continue;
    const directory = path.resolve(root, name);
    if (path.dirname(directory) !== root) continue;
    try {
      const meta = JSON.parse(await readFile(path.join(directory, 'guest.json'), 'utf8'));
      // Existing OCR/preview jobs are bounded to a few minutes; allow them to finish
      // after session expiry before removing their temporary files.
      if (!Number.isFinite(meta.expiresAt) || meta.expiresAt + 10 * 60 * 1000 > Date.now()) continue;
      const cached = workspaces.get(name); if (cached) await (await cached).db.$disconnect();
      workspaces.delete(name);
      await rm(directory, { recursive: true, force: true });
    } catch { /* An active or unreadable guest directory can be retried later. */ }
  }
}

export async function discardGuestWorkspace(session: LearningSession) {
  if (!session.guest) return;
  const identity = workspaceIdentity(session);
  const root = path.resolve(dataDir, 'workspaces', 'guests');
  const directory = path.resolve(root, identity.id);
  if (path.dirname(directory) !== root || !/^guest-[a-f0-9]{64}$/.test(identity.id)) return;
  const cached = workspaces.get(identity.id);
  if (cached) await cached.then(context => context.db.$disconnect()).catch(() => {});
  workspaces.delete(identity.id);
  await rm(directory, { recursive: true, force: true });
}
