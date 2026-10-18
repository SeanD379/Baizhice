import type { NotebookDocument, RichNode } from '@/lib/notebook';

export function openNotebookDrafts(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lms-notebook-drafts', 2);
    request.onupgradeneeded = () => {
      for (const name of ['drafts', 'assets']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('浏览器无法保留离线图片，请允许网站存储。'));
  });
}
type LocalAsset = { blob: Blob; name: string; uploaded?: string };
async function asset(id: string, value?: LocalAsset): Promise<LocalAsset | undefined> {
  const database = await openNotebookDrafts();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('assets', value ? 'readwrite' : 'readonly'), request = value ? transaction.objectStore('assets').put(value, id) : transaction.objectStore('assets').get(id);
    let result: LocalAsset | undefined;
    request.onsuccess = () => { result = value ?? request.result; };
    transaction.oncomplete = () => { database.close(); resolve(result); }; transaction.onerror = () => { database.close(); reject(new Error('离线图片未能保留，请重试。')); };
  });
}
export async function retainNotebookImage(file: File) {
  if (file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 10 MB 以内的 PNG、JPG 或 WebP 图片。');
  const id = crypto.randomUUID(); await asset(id, { blob: file, name: file.name || '笔记图片' }); return `notebook-local:${id}`;
}
export async function localImageBlob(src: string) { return (await asset(src.replace('notebook-local:', '')))?.blob; }
export async function uploadLocalImages(document: NotebookDocument): Promise<NotebookDocument> {
  const result = structuredClone(document), replacements = new Map<string, string>();
  const visit = async (node: RichNode) => {
    const src = node.type === 'image' ? String(node.attrs?.src ?? '') : '';
    if (src.startsWith('notebook-local:')) {
      if (!replacements.has(src)) {
        const id = src.replace('notebook-local:', ''), saved = await asset(id);
        if (!saved) throw new Error('离线图片无法读取，草稿已保留，请重新添加原图片。');
        let url = saved.uploaded;
        if (!url) {
          const body = new FormData(); body.set('file', saved.blob, saved.name);
          const response = await fetch('/api/notebook-assets', { method: 'POST', body }), data = await response.json();
          if (!response.ok) throw new Error(data.error ?? '图片等待同步');
          url = data.url; await asset(id, { ...saved, uploaded: url });
        }
        replacements.set(src, url!);
      }
      node.attrs = { ...node.attrs, src: replacements.get(src) };
    }
    for (const child of node.content ?? []) await visit(child);
  };
  for (const item of [...result.pages, ...result.inbox, ...result.trash]) await visit(item.doc);
  return result;
}
