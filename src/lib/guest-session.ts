import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAuthSecret } from './auth-secret';
import type { LearningSession } from './workspace-context';

export const guestCookieName = 'lms.guest';
export const guestLifetimeSeconds = 2 * 60 * 60;
export function createGuestSession() {
  const id = randomUUID(), expiresAt = Date.now() + guestLifetimeSeconds * 1000;
  const payload = Buffer.from(JSON.stringify({ id, expiresAt })).toString('base64url');
  const signature = createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
  return { id, expiresAt, token: `${payload}.${signature}` };
}
export function readGuestSession(headers: Headers): LearningSession | null {
  const token = (headers.get('cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${guestCookieName}=`))?.slice(guestCookieName.length + 1);
  if (!token || token.length > 512) return null;
  try {
    const parts = token.split('.'); if (parts.length !== 2) return null;
    const expected = createHmac('sha256', getAuthSecret()).update(parts[0]).digest();
    const actual = Buffer.from(parts[1], 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null;
    return { user: { id: value.id, email: `${value.id}@guest.invalid`, name: '游客' }, guest: true, expiresAt: value.expiresAt };
  } catch { return null; }
}
