import { basePath, withBasePath, withoutBasePath } from './base-path';

export function loginReturnPath(value: string | null | undefined): string {
  const fallback = withBasePath('/');
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://baizhice.invalid');
    const path = decodeURIComponent(url.pathname);
    const localPath = withoutBasePath(path);
    if (url.origin !== 'https://baizhice.invalid' || path.startsWith('//') || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path) || localPath.replace(/\/+$/, '') === '/login') return fallback;
    if (basePath && path !== '/' && path !== basePath && !path.startsWith(`${basePath}/`)) return fallback;
    return withBasePath(url.pathname) + url.search + url.hash;
  } catch { return fallback; }
}
