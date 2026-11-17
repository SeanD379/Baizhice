import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/components/login-form', () => ({ LoginForm: () => null }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`); }) }));
vi.mock('@/lib/auth', () => ({ privateCloudEnabled: vi.fn() }));
vi.mock('@/lib/private-access', () => ({ privateSession: vi.fn() }));

import LoginPage from './page';
import { privateCloudEnabled } from '@/lib/auth';
import { privateSession } from '@/lib/private-access';
import { redirect } from 'next/navigation';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_URL', 'https://study.example.com');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret');
  vi.stubEnv('PRIVATE_OWNER_EMAIL', 'learner@example.com');
  vi.stubEnv('REMOTE_AUTH_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

it('shows an unavailable login form without querying sessions in local mode', async () => {
  vi.mocked(privateCloudEnabled).mockReturnValue(false);
  const page = await LoginPage({ searchParams: Promise.resolve({}) });
  expect(page.props.available).toBe(false);
  expect(privateSession).not.toHaveBeenCalled();
});

it('redirects an already verified account to the requested settings page', async () => {
  vi.mocked(privateCloudEnabled).mockReturnValue(true);
  vi.mocked(privateSession).mockResolvedValue({ user: { email: 'learner@example.com' } } as Awaited<ReturnType<typeof privateSession>>);
  const next = '/?course=probability&settings=profile';
  await expect(LoginPage({ searchParams: Promise.resolve({ next }) })).rejects.toThrow('REDIRECT');
  expect(redirect).toHaveBeenCalledWith(next);
});

it('does not redirect a signed-in account to an external site', async () => {
  vi.mocked(privateCloudEnabled).mockReturnValue(true);
  vi.mocked(privateSession).mockResolvedValue({ user: { email: 'learner@example.com' } } as Awaited<ReturnType<typeof privateSession>>);
  await expect(LoginPage({ searchParams: Promise.resolve({ next: '//elsewhere.example' }) })).rejects.toThrow('REDIRECT');
  expect(redirect).toHaveBeenCalledWith('/');
});

it('permits sign-in only when cloud login is configured and has no current session', async () => {
  vi.mocked(privateCloudEnabled).mockReturnValue(true);
  vi.mocked(privateSession).mockResolvedValue(null);
  const page = await LoginPage({ searchParams: Promise.resolve({}) });
  expect(page.props.available).toBe(true);
});
it('enables the existing form for server-backed login without a local signing secret', async () => {
  vi.mocked(privateCloudEnabled).mockReturnValue(true);
  vi.stubEnv('REMOTE_AUTH_URL', 'https://study.example.com');
  vi.stubEnv('BETTER_AUTH_SECRET', '');
  vi.mocked(privateSession).mockResolvedValue(null);
  const page = await LoginPage({ searchParams: Promise.resolve({}) });
  expect(page.props.available).toBe(true);
});

it('shows unavailable state when the login service cannot initialize', async () => {
  vi.mocked(privateCloudEnabled).mockReturnValue(true);
  vi.mocked(privateSession).mockRejectedValue(new Error('missing configuration'));
  const page = await LoginPage({ searchParams: Promise.resolve({}) });
  expect(page.props.available).toBe(false);
  expect(page.props.disabledMessage).toBe('登录服务暂不可用，请稍后重试。');
});
