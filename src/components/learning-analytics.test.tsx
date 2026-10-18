// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LearningAnalytics } from './learning-analytics';
import { analyzeLearning, type LearningJudgment } from '@/lib/learning-analysis';
import type { PracticeLocation } from '@/lib/practice-hub';

const now = new Date('2026-10-15T04:00:00Z');
const record = (id: string): LearningJudgment => ({ id, questionKey: id, recordId: id, sourceRecordId: id, ref: { engine: 'original', materialId: 'm', questionId: id }, title: `已保存题目${id}`, sourceName: '阅读资料', topics: [`知识点${id}`], origin: 'original', at: '2026-10-14T02:00:00Z', correct: false, timeSource: 'judged', available: true, location: { section: 'knowledge', activity: 'history' } });
const data = (items: LearningJudgment[] = [], courseId = 'chinese', period: 7 | 30 = 7) => analyzeLearning({ courseId, courseName: courseId === 'other' ? '其他课程' : '语文', judgments: items, records: items.map(item => ({ id: item.recordId, sourceRecordId: item.sourceRecordId, title: item.sourceName, at: item.at, finished: true, engine: item.ref.engine, location: item.location })), states: [], materialCount: 3, versionCount: 1, withheld: false }, period, now);
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let roots: Root[] = [];
afterEach(async () => { await act(async () => roots.forEach(root => root.unmount())); roots = []; vi.unstubAllGlobals(); document.body.replaceChildren(); window.history.replaceState(null, '', '/'); });
async function mount(onOpenPractice: (location: PracticeLocation) => void = () => {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const props = { courseId: 'chinese', onOpenPractice, onLibrary: () => {}, onOutline: () => {}, onVersions: () => {} };
  await act(async () => root.render(<LearningAnalytics {...props} />));
  return { root, container, props };
}
const button = (container: HTMLElement, label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label))!;

it('shows real zero counts and an undefined accuracy when no answers have been saved', async () => {
  vi.stubGlobal('fetch', async (url: string) => response(data([], 'chinese', new URL(url, 'http://localhost').searchParams.get('period') === '30' ? 30 : 7)));
  const { container } = await mount();
  expect(container.querySelectorAll('.analytics-metric')).toHaveLength(4);
  expect(container.querySelector('[data-metric="accuracy"] strong')?.textContent).toBe('—');
  expect(container.querySelector('[data-metric="total"] strong')?.textContent).toContain('0');
  expect(container.querySelectorAll('.analytics-bar-button')).toHaveLength(7);
  await act(async () => button(container, '近 30 天').click());
  expect(container.querySelectorAll('.analytics-bar-button')).toHaveLength(5);
  expect(container.textContent).toContain('暂无练习记录');
});

it('refreshes from the unified source and opens the matching history and review destinations', async () => {
  let items = [record('1')]; let opened: PracticeLocation | undefined;
  vi.stubGlobal('fetch', async (url: string) => url.startsWith('/api/learning-analysis?') ? response(data(items)) : response({ error: '错误数据源' }, 400));
  const { container } = await mount(location => { opened = location; });
  expect(container.querySelector('[data-metric="total"] strong')?.textContent).toContain('1');
  items = [record('1'), record('2')];
  await act(async () => button(container, '刷新').click());
  expect(container.querySelector('[data-metric="total"] strong')?.textContent).toContain('2');
  await act(async () => button(container, '去错题复盘').click());
  expect(opened).toEqual({ section: 'mistakes', activity: 'mistakes' });
  await act(async () => (container.querySelector('.analytics-record button') as HTMLButtonElement).click());
  expect(opened).toEqual({ section: 'knowledge', activity: 'history' });
});

it('previews five topics and four sessions and opens all topics with their source records', async () => {
  vi.stubGlobal('fetch', async (url: string) => response(data(Array.from({ length: 9 }, (_, i) => record(String(i + 1))), 'chinese', new URL(url, 'http://localhost').searchParams.get('period') === '30' ? 30 : 7)));
  const { container } = await mount();
  expect(container.querySelectorAll('.analytics-topic')).toHaveLength(5);
  expect(container.querySelectorAll('.analytics-record')).toHaveLength(4);
  const dayButton = container.querySelector('[aria-label^="2026-10-14："]') as HTMLButtonElement;
  await act(async () => dayButton.click());
  expect(container.querySelector('.analytics-day-records')?.textContent).toContain('阅读资料');
  await act(async () => button(container, '近 30 天').click());
  await act(async () => (container.querySelector('[aria-label="查看更多知识点"]') as HTMLButtonElement).click());
  expect(container.querySelector('h1')?.textContent).toBe('知识点表现');
  expect(container.querySelectorAll('.analytics-metric')).toHaveLength(0);
  expect(container.querySelectorAll('.analytics-topic')).toHaveLength(9);
  expect(new URLSearchParams(window.location.search).get('analysis')).toBe('topics');
  await act(async () => (container.querySelectorAll('.analytics-topic')[8] as HTMLButtonElement).click());
  expect(container.querySelector('.analytics-topic-detail')?.textContent).toContain('已保存题目');
  await act(async () => button(container, '返回学习分析').click());
  expect(container.querySelectorAll('.analytics-topic')).toHaveLength(5);
  expect(container.querySelectorAll('.analytics-bar-button')).toHaveLength(5);
});

it('shows every recent session on its own page and opens the selected session in its original section', async () => {
  const items = Array.from({ length: 7 }, (_, i) => record(String(i + 1)));
  items[6].location = { section: 'papers', activity: 'history', materialId: 'paper-material' };
  vi.stubGlobal('fetch', async () => response(data(items)));
  let opened: PracticeLocation | undefined;
  const { container } = await mount(location => { opened = location; });
  expect(container.querySelectorAll('.analytics-record')).toHaveLength(4);
  await act(async () => (container.querySelector('[aria-label="查看更多练习记录"]') as HTMLButtonElement).click());
  expect(container.querySelector('h1')?.textContent).toBe('最近练习');
  expect(container.querySelectorAll('.analytics-record')).toHaveLength(7);
  await act(async () => (container.querySelectorAll('.analytics-record button')[6] as HTMLButtonElement).click());
  expect(opened).toEqual({ section: 'papers', activity: 'history', materialId: 'paper-material' });
  await act(async () => button(container, '返回学习分析').click());
  expect(container.querySelectorAll('.analytics-record')).toHaveLength(4);
});

it('restores detail pages and their period from the URL and responds to browser history', async () => {
  window.history.replaceState(null, '', '/?course=chinese&view=analytics&analysis=records&analysisPeriod=30');
  vi.stubGlobal('fetch', async (url: string) => response(data(Array.from({ length: 6 }, (_, i) => record(String(i + 1))), 'chinese', new URL(url, 'http://localhost').searchParams.get('period') === '30' ? 30 : 7)));
  const { container } = await mount();
  expect(container.querySelectorAll('.analytics-record')).toHaveLength(6);
  expect(button(container, '近 30 天').getAttribute('aria-pressed')).toBe('true');
  await act(async () => { window.history.replaceState(null, '', '/?course=chinese&view=analytics&analysisPeriod=30'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(container.querySelector('h1')?.textContent).toBe('学习分析');
  expect(container.querySelectorAll('.analytics-record')).toHaveLength(4);
  expect(button(container, '近 30 天').getAttribute('aria-pressed')).toBe('true');
});

it('does not turn request failure into zero counts and recovers through retry', async () => {
  let failed = true;
  vi.stubGlobal('fetch', async () => failed ? response({ error: '记录读取失败' }, 500) : response(data([record('1')])));
  const { container } = await mount();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('记录读取失败');
  expect(container.querySelector('[data-metric="total"] strong')?.textContent).toBe('—');
  failed = false; await act(async () => button(container, '重试').click());
  expect(container.querySelector('[data-metric="total"] strong')?.textContent).toContain('1');
});

it('clears the previous course and ignores an old response arriving after the course changes', async () => {
  let finishOld: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', (url: string) => url.includes('courseId=other') ? Promise.resolve(response(data([], 'other'))) : new Promise<Response>(resolve => { finishOld = resolve; }));
  const { root, container, props } = await mount();
  expect(container.querySelector('[data-metric="total"] strong')?.textContent).toBe('—');
  await act(async () => root.render(<LearningAnalytics {...props} courseId="other" />));
  expect(container.querySelector('[data-metric="total"] strong')?.textContent).toContain('0');
  await act(async () => finishOld?.(response(data([record('1')]))));
  expect(container.querySelector('[data-metric="total"] strong')?.textContent).toContain('0');
});
