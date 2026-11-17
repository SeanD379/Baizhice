import { withBasePath } from './base-path';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { authDb } from './db';
import { getAuthSecret } from './auth-secret';
import { maximumPasswordLength, minimumRegistrationPasswordLength } from './login-validation';

export function privateCloudEnabled() { return process.env.PRIVATE_CLOUD === '1' || process.env.NODE_ENV === 'production'; }
let instance: ReturnType<typeof betterAuth> | undefined;
export function getAuth() {
  if (!instance) {
    if (!process.env.APP_URL) throw new Error('登录地址尚未配置。');
    const options: BetterAuthOptions = {
      appName: '百知册', baseURL: process.env.APP_URL, basePath: withBasePath('/api/auth'), secret: getAuthSecret(),
      database: prismaAdapter(authDb, { provider: 'sqlite' }),
      trustedOrigins: [new URL(process.env.APP_URL).origin],
      // Better Auth counts UTF-16 units; the registration route limits Unicode characters.
      emailAndPassword: { enabled: true, minPasswordLength: minimumRegistrationPasswordLength, maxPasswordLength: maximumPasswordLength * 2 },
      session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
      advanced: { useSecureCookies: new URL(process.env.APP_URL).protocol === 'https:' },
    };
    instance = betterAuth(options);
  }
  return instance;
}
