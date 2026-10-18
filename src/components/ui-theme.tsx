'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { Moon, Sun } from 'lucide-react';
import { themeStorageKey, type ThemeMode } from '@/lib/ui-theme';
import { Button } from './ui/button';

const ThemeContext = createContext<{ theme: ThemeMode; setTheme: (theme: ThemeMode) => void }>({ theme: 'light', setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('light');
  useLayoutEffect(() => {
    let initial: ThemeMode = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    try {
      const saved = window.localStorage.getItem(themeStorageKey);
      if (saved === 'light' || saved === 'dark') initial = saved;
    } catch { /* The pre-paint default also works when browser storage is unavailable. */ }
    document.documentElement.dataset.theme = initial;
    setThemeState(initial);
  }, []);
  const setTheme = useCallback((next: ThemeMode) => {
    document.documentElement.dataset.theme = next;
    setThemeState(next);
    try { window.localStorage.setItem(themeStorageKey, next); } catch { /* Theme switching still works without browser storage. */ }
  }, []);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const activeTransition = useRef<{ target: ThemeMode; view?: ViewTransition; animation?: Animation; cleanup?: () => void } | null>(null);
  useLayoutEffect(() => () => {
    activeTransition.current?.cleanup?.();
    activeTransition.current?.animation?.cancel();
    activeTransition.current?.view?.skipTransition();
    activeTransition.current = null;
    document.documentElement.removeAttribute('data-theme-transition');
  }, []);
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    const active = activeTransition.current;
    const next = (active?.target ?? theme) === 'light' ? 'dark' : 'light';
    if (active) {
      active.target = next;
      flushSync(() => setTheme(next));
      if (active.animation && active.animation.playState !== 'finished') active.animation.reverse();
      else active.view?.skipTransition();
      return;
    }
    if (!document.startViewTransition) {
      setTheme(next);
      return;
    }
    const root = document.documentElement;
    const button = event.currentTarget;
    const { left, top, width, height } = button.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 1;
    const circle = [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const current: NonNullable<typeof activeTransition.current> = { target: next };
    activeTransition.current = current;
    // Snapshot participants cannot receive pointer hits in some browsers.
    const forwardClick = (click: globalThis.MouseEvent) => {
      if (click.target !== root) return;
      const rect = button.getBoundingClientRect();
      if (click.clientX >= rect.left && click.clientX <= rect.right && click.clientY >= rect.top && click.clientY <= rect.bottom) {
        button.focus({ preventScroll: true });
        button.click();
      }
    };
    document.addEventListener('click', forwardClick);
    current.cleanup = () => document.removeEventListener('click', forwardClick);
    root.dataset.themeTransition = next;
    const view = document.startViewTransition(() => flushSync(() => setTheme(current.target)));
    current.view = view;
    void view.ready.then(() => {
      if (activeTransition.current !== current) return;
      // Keep the dark snapshot on top so reversing preserves the same circular edge.
      current.animation = root.animate(
        reducedMotion ? { opacity: next === 'dark' ? [0, 1] : [1, 0] }
          : { clipPath: next === 'dark' ? circle : [...circle].reverse() },
        { duration: reducedMotion ? 150 : 500, easing: 'cubic-bezier(0.77, 0, 0.175, 1)', fill: 'both',
          pseudoElement: next === 'dark' ? '::view-transition-new(root)' : '::view-transition-old(root)' },
      );
    }).catch(() => { /* A skipped transition still applies the selected theme. */ });
    const clear = () => {
      if (activeTransition.current !== current) return;
      current.animation?.cancel();
      current.cleanup?.();
      activeTransition.current = null;
      root.removeAttribute('data-theme-transition');
    };
    void view.finished.then(clear, clear);
  };
  const action = theme === 'light' ? '切换到夜间模式' : '切换到白天模式';
  return <Button className="theme-toggle" variant="ghost" aria-label={action} title={action} onClick={toggle}>
    {theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}<span>{theme === 'light' ? '白天模式' : '夜间模式'}</span>
  </Button>;
}
