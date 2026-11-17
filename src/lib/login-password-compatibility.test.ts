import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';

const records = vi.hoisted(() => ({ user: [], account: [], session: [], verification: [] }));
vi.mock('./db', () => ({ authDb: {} }));
vi.mock('better-auth/adapters/prisma', async () => {
  const { memoryAdapter } = await import('better-auth/adapters/memory');
  return { prismaAdapter: () => memoryAdapter(records) };
});
import { getAuth } from './auth';
import { registrationPasswordError } from './login-validation';

const origin = 'https://password-validation.example';
const secret = 'test-only-password-compatibility-secret-at-least-32';
beforeAll(async () => {
  vi.stubEnv('APP_URL', origin); vi.stubEnv('BETTER_AUTH_SECRET', secret);
  const previous = betterAuth({ baseURL: origin, secret, database: memoryAdapter(records), emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 } });
  await previous.api.signUpEmail({ body: { name: '旧账号', email: 'legacy@example.com', password: 'legacy-password' }, headers: new Headers({ Origin: origin }) });
});
afterAll(() => vi.unstubAllEnvs());

it('still authenticates an existing password without three character classes', async () => {
  const result = await getAuth().api.signInEmail({ body: { email: 'legacy@example.com', password: 'legacy-password' }, headers: new Headers({ Origin: origin }) });
  expect(result.user.email).toBe('legacy@example.com');
});
it('accepts eight-character registration passwords in the actual authentication provider', async () => {
  const result = await getAuth().api.signUpEmail({ body: { name: '同学', email: 'eight@example.com', password: 'Abcdef12' }, headers: new Headers({ Origin: origin }) });
  expect(result.user.email).toBe('eight@example.com');
});
it('supports 128 Unicode characters without an earlier UTF-16 provider limit', async () => {
  const password = 'Aa1!' + '🙂'.repeat(124);
  expect(registrationPasswordError(password)).toBeUndefined();
  const result = await getAuth().api.signUpEmail({ body: { name: 'Unicode账号', email: 'unicode@example.com', password }, headers: new Headers({ Origin: origin }) });
  expect(result.user.email).toBe('unicode@example.com');
});
