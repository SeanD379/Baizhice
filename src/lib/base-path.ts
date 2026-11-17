export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function withBasePath(path: string): string {
  if (!basePath || !path.startsWith('/') || path.startsWith('//') || path === basePath || path.startsWith(`${basePath}/`) || path.startsWith(`${basePath}?`) || path.startsWith(`${basePath}#`)) return path;
  return basePath + path;
}

export function withoutBasePath(path: string): string {
  return basePath && (path === basePath || path.startsWith(`${basePath}/`) || path.startsWith(`${basePath}?`) || path.startsWith(`${basePath}#`)) ? path.slice(basePath.length) || '/' : path;
}
