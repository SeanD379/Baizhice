import { PrismaClient } from '@prisma/client';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { workspaceContext } from './workspace-context';

export const dataDir = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || path.join(process.cwd(), 'data'));
mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const authDb = globalDb.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalDb.prisma = authDb;
function currentWorkspace() {
  const context = workspaceContext.getStore();
  if (context?.kind === 'guest' && context.expiresAt !== undefined && context.expiresAt <= Date.now()) throw new Error('游客体验已结束，请重新进入或注册账号。');
  return context;
}
export function getDataDir() { return currentWorkspace()?.dataDir ?? dataDir; }
export const db = new Proxy(authDb, {
  get(target, property) {
    const client = currentWorkspace()?.db ?? target;
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
