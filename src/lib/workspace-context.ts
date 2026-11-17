import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrismaClient } from '@prisma/client';

export type LearningSession = {
  user: { id?: string; email: string; name?: string };
  guest?: boolean;
  expiresAt?: number;
};
export type WorkspaceContext = {
  id: string;
  kind: 'owner' | 'user' | 'guest';
  db: PrismaClient;
  dataDir: string;
  expiresAt?: number;
};
const shared = globalThis as unknown as { learningWorkspaceContext?: AsyncLocalStorage<WorkspaceContext> };
export const workspaceContext = shared.learningWorkspaceContext ??= new AsyncLocalStorage<WorkspaceContext>();
