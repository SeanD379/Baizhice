import { afterAll, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
vi.mock('./db', async () => ({ dataDir: await (await import('node:fs/promises')).mkdtemp(path.join(tmpdir(), 'lms-guest-capacity-')) }));
import { dataDir } from './db';
import { withGuestCapacity } from './guest-capacity';
afterAll(() => rm(dataDir, { recursive:true, force:true }));
it('bounds concurrent guest creation before allocating another workspace', async () => {
  let finish!: (response:Response)=>void;
  const held = new Promise<Response>(resolve => { finish=resolve; });
  const first=withGuestCapacity(()=>held), second=withGuestCapacity(()=>held);
  expect((await withGuestCapacity(async()=>new Response('should not allocate'))).status).toBe(429);
  finish(new Response('{}')); expect((await first).status).toBe(200); expect((await second).status).toBe(200);
});
it('refuses more guest workspaces after reaching the disk quota', async () => {
  for(let index=0;index<32;index++)await mkdir(path.join(dataDir,'workspaces','guests',`guest-${index.toString(16).padStart(64,'0')}`),{recursive:true});
  expect((await withGuestCapacity(async()=>new Response('should not allocate'))).status).toBe(429);
});
