import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './db';

export function getAuthSecret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  // A local preview may use the existing remote owner login and local new accounts.
  // Production always requires the explicit deployment secret.
  if (process.env.NODE_ENV === 'production' || !process.env.REMOTE_AUTH_URL) throw new Error('登录密钥尚未配置。');
  const file = path.join(dataDir, '.local-auth-secret');
  mkdirSync(dataDir, { recursive: true });
  try { writeFileSync(file, randomBytes(48).toString('base64url'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return readFileSync(file, 'utf8').trim();
}
