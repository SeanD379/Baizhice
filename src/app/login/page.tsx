import { withoutBasePath } from '@/lib/base-path';
import { LoginForm } from '@/components/login-form';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { privateCloudEnabled } from '@/lib/auth';
import { privateSession } from '@/lib/private-access';
import { loginReturnPath } from '@/lib/login-navigation';

export const dynamic = 'force-dynamic';
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = loginReturnPath(typeof params.next === 'string' ? params.next : null);
  let available = privateCloudEnabled() && !!(process.env.APP_URL && (process.env.REMOTE_AUTH_URL || process.env.BETTER_AUTH_SECRET) && process.env.PRIVATE_OWNER_EMAIL);
  let disabledMessage = '当前环境未启用登录';
  let session = null;
  if (available) {
    try { session = await privateSession(await headers()); }
    catch { available = false; disabledMessage = '登录服务暂不可用，请稍后重试。'; }
  }
  if (session && !session.guest) redirect(withoutBasePath(next));
  return <LoginForm available={available} disabledMessage={disabledMessage}/>;
}
