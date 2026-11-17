import { cache } from 'react';
import { headers } from 'next/headers';
import { privateCloudEnabled } from './auth';
import { privateSession } from './private-access';

export const currentLearningSession = cache(async () => {
  if (!privateCloudEnabled()) return null;
  try { return await privateSession(await headers()); } catch { return null; }
});
