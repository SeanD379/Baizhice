import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/components/workbench', () => ({ default: () => null }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`); }) }));
vi.mock('@/lib/auth', () => ({ privateCloudEnabled: vi.fn() }));
vi.mock('@/lib/private-access', () => ({ privateSession: vi.fn() }));

import Page from './page';
import { privateCloudEnabled } from '@/lib/auth';
import { privateSession } from '@/lib/private-access';
import { redirect } from 'next/navigation';

beforeEach(() => vi.resetAllMocks());

it('does not present a local learner as signed in', async () => {
  vi.mocked(privateCloudEnabled).mockReturnValue(false);
  const page = await Page({ searchParams: Promise.resolve({}) });
  expect(page.props.accountEmail).toBeNull();
  expect(privateSession).not.toHaveBeenCalled();
});

it('passes only the verified account email to the workbench', async () => {
  vi.mocked(privateCloudEnabled).mockReturnValue(true);
  vi.mocked(privateSession).mockResolvedValue({ user: { email: 'learner@example.com' }, session: { token: 'private-session-token' } } as Awaited<ReturnType<typeof privateSession>>);
  const page = await Page({ searchParams: Promise.resolve({}) });
  expect(page.props).toEqual({ accountEmail: 'learner@example.com' });
});

it('keeps the existing login redirect when the session has expired', async () => {
  vi.mocked(privateCloudEnabled).mockReturnValue(true);
  vi.mocked(privateSession).mockResolvedValue(null);
  const next = '/?course=probability&view=library';
  await expect(Page({ searchParams: Promise.resolve({ course: 'probability', view: 'library' }) })).rejects.toThrow('REDIRECT');
  expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(next)}`);
});
