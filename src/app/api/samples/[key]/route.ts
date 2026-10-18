import { requirePrivateAccess } from '@/lib/private-access';
import { sampleInfo, type SampleKey } from '@/lib/content';
import { sampleBytes } from '@/lib/server';

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const denied = await requirePrivateAccess(_request); if (denied) return denied;
  const { key } = await params;
  if (!Object.hasOwn(sampleInfo, key)) return new Response('样例不存在', { status: 404 });
  const bytes = await sampleBytes(key as SampleKey);
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${key}.pdf"; filename*=UTF-8''${encodeURIComponent(sampleInfo[key as SampleKey].name)}`, 'X-Content-Type-Options': 'nosniff' } });
}
