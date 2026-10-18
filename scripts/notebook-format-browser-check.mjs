import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = process.env.LMS_TEST_URL || 'http://127.0.0.1:4175';
const database = new PrismaClient({ datasources: { db: { url: `file:${path.resolve('data/workbench.db').replaceAll('\\', '/')}` } } });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const errors = []; let course;
const read = async (url, body) => { const response = await fetch(base + url, body === undefined ? {} : { method: url === '/api/workspace' ? 'POST' : 'PATCH', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); assert.equal(response.ok, true, result.error); return result; };
const paragraph = (text, marks) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const list = (type, listStyleType, start = 1) => ({ type, attrs: { listStyleType, ...(type === 'orderedList' ? { start } : {}) }, content: ['第一条知识点，换行内容保持与正文对齐。'.repeat(3), '第二条知识点'].map(text => ({ type: 'listItem', content: [paragraph(text)] })) });
const table = columns => ({ type: 'table', content: Array.from({ length: 2 }, (_, row) => ({ type: 'tableRow', content: Array.from({ length: columns }, (_, column) => ({ type: row ? 'tableCell' : 'tableHeader', attrs: { colspan: 1, rowspan: 1, align: 'center' }, content: [paragraph(`${row + 1}-${column + 1}`)] })) })) });
const until = async predicate => { const start = Date.now(); while (Date.now() - start < 15000) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 150)); } throw new Error('笔记未保存'); };
try {
  await mkdir('test-results', { recursive: true });
  course = (await read('/api/workspace', { action: 'create-course', name: '临时标题列表表格验收（自动清理）' })).id;
  const endpoint = `/api/notebooks/${course}`, notebook = () => read(endpoint);
  const source = { type: 'sourceBlock', attrs: { id: 'format-source', origin: { kind: 'manual', label: '格式验收来源', refs: [] } }, content: [paragraph('第一段选中文字', [{ type: 'bold' }]), paragraph('第二段选中文字'), list('orderedList', 'lower-alpha', 7)] };
  source.content[2].content[0].content.push(list('bulletList', 'square'));
  const seed = { chapters: [], pages: [{ id: 'format', title: '标题与列表', chapterId: null, doc: { type: 'doc', content: [source, ...[1, 2, 3].map(level => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: `${level} 级标题示例` }] })), ...['disc', 'circle', 'square'].map(style => list('bulletList', style)), ...['decimal', 'lower-alpha', 'lower-roman'].map(style => list('orderedList', style, 7)), table(5)] } }, { id: 'legacy', title: '已有宽表格', chapterId: null, doc: { type: 'doc', content: [table(6)] } }], inbox: [], trash: [] };
  const initial = await notebook(); await read(endpoint, { revision: initial.revision, requestId: crypto.randomUUID(), document: seed });
  const context = await browser.newContext({ viewport: { width: 1413, height: 871 } }), page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?course=${course}&view=outline`); await page.getByRole('button', { name: '编辑正文：标题与列表' }).first().waitFor();
  assert.equal(await page.locator('svg.lucide-sparkles').count(), 0);
  await page.screenshot({ path: 'test-results/notebook-format-reading-desktop.png', fullPage: true });
  const readerStyles = new Set(), starts = [], headingLevels = new Set();
  do {
    for (const style of await page.locator('.loose-paper :is(ul,ol)').evaluateAll(elements => elements.map(element => getComputedStyle(element).listStyleType))) readerStyles.add(style);
    starts.push(...await page.locator('.loose-paper ol').evaluateAll(elements => elements.map(element => element.start)));
    for (const [level, ratio] of [[1, 26 / 15], [2, 22 / 15], [3, 20 / 15]]) { const rendered = page.locator(`.loose-paper [data-heading-level="${level}"]`).first(); if (await rendered.count()) { const actual = await rendered.evaluate(element => parseFloat(getComputedStyle(element).fontSize) / parseFloat(getComputedStyle(element.closest('.notebook-rich')).fontSize)); assert.ok(Math.abs(actual - ratio) < .01); headingLevels.add(level); } }
    if (await page.getByRole('button', { name: '下一页', exact: true }).isDisabled()) break;
    await page.getByRole('button', { name: '下一页', exact: true }).click();
  } while (true);
  for (const style of ['disc', 'circle', 'square', 'decimal', 'lower-alpha', 'lower-roman']) assert.ok(readerStyles.has(style), style); assert.equal(headingLevels.size, 3); assert.ok(starts.includes(8));
  const firstSpread = async () => { while (!await page.getByRole('button', { name: '上一页', exact: true }).isDisabled()) await page.getByRole('button', { name: '上一页', exact: true }).click(); };
  await firstSpread();
  await page.getByRole('button', { name: '编辑正文：标题与列表' }).first().click(); const editor = page.getByRole('textbox', { name: '知识点正文' }); await editor.waitFor();
  await editor.evaluate(element => { const paragraphs = element.querySelectorAll('.loose-source-block > p'), range = document.createRange(); range.setStart(paragraphs[0].firstChild.firstChild, 0); range.setEnd(paragraphs[1].firstChild, paragraphs[1].textContent.length); element.focus(); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  await page.getByRole('button', { name: '正文或标题' }).click(); await page.getByRole('menuitem', { name: '一级标题', exact: true }).click(); assert.equal(await editor.locator('.loose-source-block > h1').count(), 2); assert.equal(await editor.locator('.loose-source-block > h1 strong').innerText(), '第一段选中文字');
  await editor.locator('.loose-source-block > ol > li > p').first().click(); await page.getByRole('button', { name: '插入或调整内容' }).click(); await page.getByRole('menuitem', { name: '编号', exact: true }).click(); await page.getByRole('menuitem', { name: '罗马数字', exact: true }).click();
  assert.equal(await editor.locator('.loose-source-block > ol').getAttribute('start'), '7'); assert.equal(await editor.locator('.loose-source-block ul').evaluate(element => element.style.listStyleType), 'square');
  await page.getByRole('button', { name: '完成编辑' }).click(); await until(async () => (await notebook()).document.pages[0].doc.content[0].content[2].attrs.listStyleType === 'lower-roman');
  await page.reload(); await page.getByRole('button', { name: '编辑正文：标题与列表' }).first().click(); await editor.waitFor(); assert.equal(await editor.locator('.loose-source-block > h1').count(), 2); assert.equal(await editor.locator('.loose-source-block > ol').evaluate(element => element.style.listStyleType), 'lower-roman');
  await page.getByRole('button', { name: '完成编辑' }).click();
  while (!await page.getByRole('button', { name: '编辑正文：已有宽表格' }).count()) await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('button', { name: '编辑正文：已有宽表格' }).first().click(); await editor.locator('th').first().click(); await editor.press('Home'); await editor.press('Shift+End'); await page.getByRole('button', { name: '行列操作' }).click(); assert.equal(await page.getByRole('menuitem', { name: '在右侧插入列' }).getAttribute('aria-disabled'), 'true'); await page.getByRole('menuitem', { name: '删除当前列', exact: true }).click(); assert.equal(await editor.locator('th').count(), 5);
  const selectTableText = async () => { if (!await editor.count()) await page.getByRole('button', { name: '编辑正文：已有宽表格' }).first().click(); await editor.locator('tr').first().locator('th,td').first().click(); await editor.press('Home'); await editor.press('Shift+End'); };
  await selectTableText(); await page.getByRole('button', { name: '表头设置', exact: true }).click(); const headerChoice = page.getByRole('menuitemcheckbox', { name: '首行作为表头', exact: true }); assert.equal(await headerChoice.getAttribute('aria-checked'), 'true'); assert.ok((await page.locator('.notebook-header-menu').innerText()).includes('将第一行加粗并加底色'));
  await headerChoice.click(); assert.equal(await editor.locator('th').count(), 0); assert.equal(await editor.locator('tr').first().locator('td').first().innerText(), '1-2');
  await selectTableText(); await page.getByRole('button', { name: '表头设置', exact: true }).click(); assert.equal(await headerChoice.getAttribute('aria-checked'), 'false'); await headerChoice.click(); assert.equal(await editor.locator('th').count(), 5);
  await page.getByRole('button', { name: '完成编辑' }).click(); await until(async () => (await notebook()).document.pages[1].doc.content[0].content[0].content.length === 5);
  console.log('PASS 阅读页六种标记、跨页连续编号、三级字号、多段标题与加粗、嵌套列表和起点保存、旧宽表兼容');
  await firstSpread(); await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: '编辑正文：标题与列表' }).first().click(); await editor.locator('.loose-source-block > h1').first().click();
  await page.getByRole('button', { name: '插入或调整内容' }).click(); await page.getByRole('menuitem', { name: '表格', exact: true }).click(); const grid = page.getByRole('group', { name: '选择表格尺寸' }); await grid.waitFor(); await page.getByRole('menuitem', { name: '5 列 × 8 行', exact: true }).hover();
  for (const popup of await page.getByRole('menu').all()) { const bounds = await popup.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844); }
  const square = await page.getByRole('menuitem', { name: '5 列 × 8 行', exact: true }).boundingBox(); assert.equal(square.width, square.height);
  await page.screenshot({ path: 'test-results/notebook-table-picker-mobile.png' });
  await page.keyboard.press('Escape'); assert.equal(await grid.count(), 0); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('menu').count(), 0);
  await editor.locator('th').first().click(); const toolbar = page.getByRole('toolbar', { name: '表格设置' }); await toolbar.waitFor({ state: 'hidden' }); await editor.press('Home'); await editor.press('Shift+End'); await toolbar.waitFor(); const bounds = await toolbar.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, JSON.stringify(bounds)); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844, JSON.stringify(bounds)); await page.screenshot({ path: 'test-results/notebook-table-toolbar-mobile.png' });
  await page.getByRole('button', { name: '行列操作' }).click(); const operations = page.getByRole('menu'); await operations.waitFor(); const menuBounds = await operations.boundingBox(); assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 390); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '表头设置', exact: true }).click(); const headerBounds = await page.locator('.notebook-header-menu').boundingBox(); assert.ok(headerBounds.x >= 0 && headerBounds.x + headerBounds.width <= 390); await page.screenshot({ path: 'test-results/notebook-header-menu-mobile.png' }); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []); console.log('PASS 390px 表格选择网格、单元格工具条、行列菜单和焦点返回');
  await context.close();
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: 'test-results/notebook-format-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close(); if (course) await database.course.delete({ where: { id: course } }); await database.$disconnect();
}
