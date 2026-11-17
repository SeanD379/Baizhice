// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LoginForm } from './login-form';

// WebGL cannot run in jsdom; exercise the real login and fallback around a failed renderer.
vi.mock('./react-bits/ModelViewer', () => ({ default: () => { throw new Error('WebGL context unavailable'); } }));

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('min-width'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('location', { search: '', replace: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('keeps a static poster and working login when the decorative renderer fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { root.render(<LoginForm available/>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  const artwork = container.querySelector('[data-login-artwork]');
  expect(artwork?.getAttribute('data-state')).toBe('static');
  expect(artwork?.querySelector('img')?.getAttribute('src')).toBe('/brand/login-book-poster.png');
  expect(container.querySelector<HTMLInputElement>('input[type=email]')?.disabled).toBe(false);
  await act(async () => {
    for (const [name, value] of [['email', 'learner@example.com'], ['password', 'legacy-password']]) {
      const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(location.replace).toHaveBeenCalledWith('/');
});

it('uses the static poster when reduced motion is requested', async () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('min-width') || query.includes('prefers-reduced-motion'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await act(async () => root.render(<LoginForm available/>));
  expect(container.querySelector('[data-login-artwork]')?.getAttribute('data-state')).toBe('static');
  expect(container.querySelector('[data-login-artwork] img')).not.toBeNull();
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
});
