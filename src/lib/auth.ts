import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from './db';

export function privateCloudEnabled() { return process.env.PRIVATE_CLOUD === '1' || process.env.NODE_ENV === 'production'; }
let instance: ReturnType<typeof betterAuth> | undefined;
export function getAuth() {
  if (!instance) {
    if (!process.env.APP_URL || !process.env.BETTER_AUTH_SECRET || !process.env.PRIVATE_OWNER_EMAIL) throw new Error('私人云端登录尚未配置。');
    const options: BetterAuthOptions = {
      appName: '百知册', baseURL: process.env.APP_URL, secret: process.env.BETTER_AUTH_SECRET,
      database: prismaAdapter(db, { provider: 'sqlite' }),
      trustedOrigins: [new URL(process.env.APP_URL).origin],
      emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
      session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
      advanced: { useSecureCookies: new URL(process.env.APP_URL).protocol === 'https:' },
    };
    instance = betterAuth(options);
  }
  return instance;
}
