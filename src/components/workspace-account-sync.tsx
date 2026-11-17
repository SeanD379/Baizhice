'use client';

import { useEffect, useRef } from 'react';
import { subscribeToAuthChanges } from '@/lib/workspace-storage';

export function WorkspaceAccountSync() {
  const reloading = useRef(false);
  useEffect(() => subscribeToAuthChanges(() => {
    if (reloading.current) return;
    reloading.current = true;
    location.reload();
  }), []);
  return null;
}
