import Workbench from '@/components/workbench';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { privateCloudEnabled } from '@/lib/auth';
import { privateSession } from '@/lib/private-access';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (privateCloudEnabled()) {
    let session = null;
    try { session = await privateSession(await headers()); } catch { /* Login shows configuration errors without exposing learning data. */ }
    if (!session) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(await searchParams)) if (typeof value === 'string') query.set(key, value);
      redirect(`/login?next=${encodeURIComponent(`/?${query.toString()}`)}`);
    }
  }
  return <Workbench />;
}
