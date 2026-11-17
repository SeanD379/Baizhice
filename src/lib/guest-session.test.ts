import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./auth-secret', () => ({ getAuthSecret: () => 'test-only-guest-signing-key-with-enough-entropy' }));
import { createGuestSession, guestCookieName, readGuestSession } from './guest-session';
afterEach(() => vi.useRealTimers());
const headers = (token: string) => new Headers({ cookie: `${guestCookieName}=${token}` });
it('accepts a signed guest and retains the same isolated identity', () => {
  const guest = createGuestSession();
  const session = readGuestSession(headers(guest.token));
  expect(session?.guest).toBe(true);
  expect(session?.user.id).toBe(guest.id);
  expect(session?.expiresAt).toBe(guest.expiresAt);
});
it('rejects forged and expired guest cookies', () => {
  const guest = createGuestSession();
  const [payload, signature] = guest.token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ id:'another-account', expiresAt:guest.expiresAt })).toString('base64url');
  expect(readGuestSession(headers(`${forgedPayload}.${signature}`))).toBeNull();
  expect(readGuestSession(headers(`${payload}.invalid`))).toBeNull();
  vi.useFakeTimers(); vi.setSystemTime(guest.expiresAt + 1);
  expect(readGuestSession(headers(guest.token))).toBeNull();
});
