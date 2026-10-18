import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '@/lib/db';
import { requirePrivateAccess } from '@/lib/private-access';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ name: string }> }) {
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  const { name } = await context.params;
  if (!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(name)) return new NextResponse(null, { status: 404 });
  try {
    const bytes = await readFile(path.join(dataDir, 'notebook-assets', name));
    return new NextResponse(bytes, { headers: { 'Content-Type': name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new NextResponse(null, { status: 404 }); }
}
