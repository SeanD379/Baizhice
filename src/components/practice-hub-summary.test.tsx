// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PracticeHubProvider, useHubSummary } from './practice-hub';
import type { PracticeArea } from '@/lib/practice-hub';

let root: Root, container: HTMLDivElement, pending: ((value: Response) => void) | undefined, wait: boolean;
const response = (courseId: string, section: string, count = 2) => new Response(JSON.stringify({ courseId, section, materials: Array.from({ length: count }, (_, i) => ({ id: String(i) })) }), { status: 200 });
function Probe({ courseId = 'c', section = 'knowledge', reuse = true }: { courseId?: string; section?: PracticeArea; reuse?: boolean }) {
  const { data } = useHubSummary(courseId, section, reuse);
  return <p>{data ? `${data.courseId}:${data.materials.length}` : 'loading'}</p>;
}
function render(child: React.ReactNode, courseId = 'c', preload = false) {
  return act(async () => root.render(<PracticeHubProvider courseId={courseId} preload={preload}>{child}</PracticeHubProvider>));
}
beforeEach(() => {
  wait = false; pending = undefined;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const params = new URLSearchParams(url.split('?')[1]);
    if (wait && params.get('section') === 'knowledge') return new Promise<Response>(resolve => { pending = resolve; });
    return response(params.get('courseId')!, params.get('section')!);
  }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('keeps the cached homepage visible immediately while refreshing it after returning', async () => {
  await render(<Probe/>); await vi.waitFor(() => expect(container.textContent).toBe('c:2'));
  await render(null); wait = true;
  await render(<Probe/>);
  expect(container.textContent).toBe('c:2');
  await act(async () => pending!(response('c', 'knowledge', 3)));
  expect(container.textContent).toBe('c:3');
});
it('never reuses a homepage snapshot for pages requiring fresh exam protection', async () => {
  await render(<Probe/>); await vi.waitFor(() => expect(container.textContent).toBe('c:2'));
  await render(null); wait = true;
  await render(<Probe reuse={false}/>);
  expect(container.textContent).toBe('loading');
  await act(async () => pending!(response('c', 'knowledge', 4)));
  expect(container.textContent).toBe('c:4');
});
it('preloads all three homepages and isolates their data by course', async () => {
  await render(null, 'c', true);
  await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls).toHaveLength(3));
  expect(vi.mocked(fetch).mock.calls.map(([url]) => new URLSearchParams(String(url).split('?')[1]).get('section')).sort()).toEqual(['knowledge', 'mistakes', 'papers']);
  await render(<Probe courseId="other"/>, 'other');
  await vi.waitFor(() => expect(container.textContent).toBe('other:2'));
});

it('keeps the homepage visible after a failed background read and updates it on retry', async () => {
  function RetryProbe() { const { data, error, refresh } = useHubSummary('c', 'knowledge', true); return <><p>{data?.materials.length} {error}</p><button onClick={refresh}>同步</button></>; }
  await render(<Probe/>); await vi.waitFor(() => expect(container.textContent).toBe('c:2'));
  await render(null); vi.mocked(fetch).mockRejectedValueOnce(Error('离线'));
  await render(<RetryProbe/>);
  await vi.waitFor(() => expect(container.querySelector('p')?.textContent).toBe('2 离线'));
  vi.mocked(fetch).mockResolvedValueOnce(response('c', 'knowledge', 5));
  await act(async () => container.querySelector('button')!.click());
  expect(container.querySelector('p')?.textContent).toBe('5 ');
});

it('does not let an older in-flight read overwrite the fresh homepage after returning', async () => {
  await render(<Probe/>); await vi.waitFor(() => expect(container.textContent).toBe('c:2'));
  wait = true; await render(null); await render(<Probe/>); const older = pending!;
  await render(null); await render(<Probe/>); const newer = pending!;
  expect(newer).not.toBe(older);
  await act(async () => newer(response('c', 'knowledge', 5)));
  await act(async () => older(response('c', 'knowledge', 3)));
  expect(container.textContent).toBe('c:5');
  await render(null); await render(<Probe/>);
  expect(container.textContent).toBe('c:5');
  await act(async () => pending!(response('c', 'knowledge', 5)));
});
