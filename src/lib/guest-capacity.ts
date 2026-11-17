import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { dataDir } from './db';

const shared = globalThis as unknown as { learningGuestAdmissions?: { pending: number } };
const admissions = shared.learningGuestAdmissions ??= { pending: 0 };
const busy = () => NextResponse.json({ message: '当前体验人数较多，请稍后重试或注册账号。' }, { status: 429 });

export async function withGuestCapacity(create: () => Promise<Response>): Promise<Response> {
  if (admissions.pending >= 2) return busy();
  admissions.pending++;
  try {
    let count = 0;
    try { count = (await readdir(path.join(dataDir, 'workspaces', 'guests'), { withFileTypes: true })).filter(item => item.isDirectory() && /^guest-[a-f0-9]{64}$/.test(item.name)).length; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (count + admissions.pending > 32) return busy();
    return await create();
  } finally { admissions.pending--; }
}
