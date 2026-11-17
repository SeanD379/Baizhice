'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { defaultUserPreferences, parseUserPreferences, userPreferencesKey, type UserPreferences } from '@/lib/user-preferences';
import { workspaceLocalStorage } from '@/lib/workspace-storage';

type PreferencesContext = {
  preferences: UserPreferences;
  reducedMotion: boolean;
  savePreferences: (patch: Partial<UserPreferences>) => boolean;
  resetPreferences: () => boolean;
  storageError: string;
  reportStorageError: () => void;
  clearStorageError: () => void;
};
const Context = createContext<PreferencesContext>({ preferences: defaultUserPreferences, reducedMotion: false, savePreferences: () => false, resetPreferences: () => false, storageError: '', reportStorageError: () => {}, clearStorageError: () => {} });

export function UserPreferencesProvider({ children, initialNickname }: { children: React.ReactNode; initialNickname?: string }) {
  const [preferences, setPreferences] = useState(() => parseUserPreferences(null, initialNickname));
  const latestPreferences = useRef(preferences);
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [storageError, setStorageError] = useState('');
  const reportStorageError = useCallback(() => setStorageError('当前浏览器无法保存设置，请检查存储空间或浏览器权限后重试。'), []);
  const clearStorageError = useCallback(() => setStorageError(''), []);
  useLayoutEffect(() => {
    try { const saved = parseUserPreferences(workspaceLocalStorage.getItem(userPreferencesKey), initialNickname); latestPreferences.current = saved; setPreferences(saved); } catch { reportStorageError(); }
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setSystemReducedMotion(media?.matches ?? false);
    updateMotion(); media?.addEventListener?.('change', updateMotion);
    return () => media?.removeEventListener?.('change', updateMotion);
  }, [reportStorageError, initialNickname]);
  const reducedMotion = systemReducedMotion || preferences.reduceMotion;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--reading-scale', String({ standard: 1, comfortable: 1.12, large: 1.25 }[preferences.readingSize]));
    root.dataset.reducedMotion = String(reducedMotion);
  }, [preferences.readingSize, reducedMotion]);
  const savePreferences = useCallback((patch: Partial<UserPreferences>) => {
    const next = { ...latestPreferences.current, ...patch };
    try { workspaceLocalStorage.setItem(userPreferencesKey, JSON.stringify(next)); }
    catch { reportStorageError(); return false; }
    latestPreferences.current = next; setPreferences(next); setStorageError(''); return true;
  }, [reportStorageError]);
  const resetPreferences = useCallback(() => savePreferences({ readingSize: 'standard', reduceMotion: false, sendShortcut: 'enter' }), [savePreferences]);
  return <Context.Provider value={{ preferences, reducedMotion, savePreferences, resetPreferences, storageError, reportStorageError, clearStorageError }}>{children}</Context.Provider>;
}
export const useUserPreferences = () => useContext(Context);
export function useAppReducedMotion() {
  const system = useReducedMotion();
  return useUserPreferences().reducedMotion || !!system;
}
