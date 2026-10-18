import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = process.env.LMS_TEST_URL || 'http://127.0.0.1:4175';
const database = new PrismaClient({ datasources: { db: { url: `file:${path.resolve('data/workbench.db').replaceAll('\\', '/')}` } } });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const courses = [], errors = [], pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8FYAAAAASUVORK5CYII=', 'base64');
const read = async (url, body) => {
  const response = await fetch(base + url, body === undefined ? {} : { method: url === '/api/workspace' ? 'POST' : 'PATCH', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); assert.equal(response.ok, true, result.error); return result;
};
const until = async (predicate, message) => { const start = Date.now(); while (Date.now() - start < 15000) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 150)); } throw new Error(message); };
const paragraph = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
const log = message => console.log('PASS', message);
try {
  await mkdir('test-results', { recursive: true });
  for (const name of ['编辑交互验收', '纸张隔离验收']) courses.push((await read('/api/workspace', { action: 'create-course', name: `临时${name}（自动清理）` })).id);
  const [course, otherCourse] = courses, endpoint = `/api/notebooks/${course}`;
  const notebook = () => read(endpoint);
  const seed = { chapters: [], pages: [{ id: 'point', title: '交互验收', chapterId: null, doc: { type: 'doc', content: [{ type: 'sourceBlock', attrs: { id: 'stable-source', origin: { kind: 'manual', label: '验收摘录', refs: [] } }, content: [paragraph('来源段落示例'), paragraph()] }, paragraph('末尾段落')] } }], inbox: [], trash: [] };
  await read(endpoint, { revision: (await notebook()).revision, requestId: crypto.randomUUID(), document: seed });
  const second = await read(`/api/notebooks/${otherCourse}`);
  await read(`/api/notebooks/${otherCourse}`, { revision: second.revision, requestId: crypto.randomUUID(), document: { ...second.document, paperType: 'ruled' } });
  const context = await browser.newContext({ viewport: { width: 1413, height: 871 } }), page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const goto = async id => { await page.goto(`${base}/?course=${id}&view=outline`, { waitUntil: 'domcontentloaded' }); await page.locator('.loose-notebook').waitFor(); await page.waitForFunction(() => !document.querySelector('.loose-loading')); };
  const settings = async () => { const button = page.getByRole('button', { name: '阅读设置' }); if (await button.getAttribute('aria-expanded') !== 'true') await button.click(); };
  const choose = async label => { await settings(); await page.getByRole('button', { name: `${label}纸`, exact: true }).click(); };
  const insertTable = async (rows, columns) => { await page.getByRole('button', { name: '插入或调整内容' }).click(); await page.getByRole('menuitem', { name: '表格', exact: true }).click(); await page.getByRole('menuitem', { name: `${columns} 列 × ${rows} 行`, exact: true }).click(); };
  const menu = async label => {
    if (label === '表格') return insertTable(3, 3);
    if (label === '切换表头') { await page.getByRole('button', { name: '表头设置', exact: true }).click(); await page.getByRole('menuitemcheckbox', { name: '首行作为表头', exact: true }).click(); return; }
    if (/插入行|插入列|删除当前|删除表格/.test(label)) { await page.getByRole('button', { name: '行列操作' }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); return; }
    await page.getByRole('button', { name: '插入或调整内容' }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click();
    const defaults = { 标题: '二级标题', 列表: '实心圆', 编号: '数字' }; if (defaults[label]) await page.getByRole('menuitem', { name: defaults[label], exact: true }).click();
  };
  await goto(course); assert.ok(await page.locator('.paper-blank').count());
  for (const [value, label] of [['ruled', '横线'], ['grid', '方格'], ['blank', '空白']]) {
    await choose(label); await until(async () => (await notebook()).document.paperType === value, '纸张未保存');
    assert.ok(await page.locator(`.paper-${value}`).count());
    await page.screenshot({ path: `test-results/notebook-paper-${value}.png`, fullPage: true });
  }
  await choose('方格'); await until(async () => (await notebook()).document.paperType === 'grid', '方格未保存');
  await page.reload(); await page.locator('.paper-grid').waitFor();
  await goto(otherCourse); await page.locator('.paper-ruled').waitFor(); await goto(course); await page.locator('.paper-grid').waitFor(); log('三种纸张、刷新恢复、课程隔离与末尾活页底纹');
  await page.getByRole('button', { name: '编辑正文：交互验收' }).first().click();
  const editor = page.getByRole('textbox', { name: '知识点正文' }); await editor.waitFor();
  assert.equal(await page.locator('.loose-editor-toolbar').count(), 0);
  for (const [level, label] of [[1, '一级标题'], [2, '二级标题'], [3, '三级标题']]) {
    await editor.locator('.loose-source-block p').first().click(); await page.getByRole('button', { name: '插入或调整内容' }).click(); await page.getByRole('menuitem', { name: '标题', exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click();
    assert.equal(await editor.locator(`h${level}`).count(), 1);
    const ratio = await editor.locator(`h${level}`).evaluate(element => parseFloat(getComputedStyle(element).fontSize) / parseFloat(getComputedStyle(element.closest('.notebook-rich-input')).fontSize)); assert.ok(Math.abs(ratio - [0, 26 / 15, 22 / 15, 20 / 15][level]) < .01);
    await menu('正文');
  }
  for (const [kind, tag, options] of [['列表', 'ul', [['实心圆', 'disc'], ['空心圆', 'circle'], ['方块', 'square']]], ['编号', 'ol', [['数字', 'decimal'], ['字母', 'lower-alpha'], ['罗马数字', 'lower-roman']]]]) {
    for (const [label, style] of options) { await page.getByRole('button', { name: '插入或调整内容' }).click(); await page.getByRole('menuitem', { name: kind, exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); assert.equal(await editor.locator(tag).count(), 1); assert.equal(await editor.locator(tag).evaluate(element => getComputedStyle(element).listStyleType), style); }
    await menu('正文');
  }
  await editor.locator('.loose-source-block p').first().click(); await editor.press('Home'); await editor.press('Shift+End');
  await page.getByRole('button', { name: '正文或标题' }).click(); await page.getByRole('menuitem', { name: '三级标题', exact: true }).click(); assert.equal(await editor.locator('h3').count(), 1);
  await editor.press('ArrowRight'); await menu('正文');
  await editor.locator('.loose-source-block p').first().click(); await page.getByRole('button', { name: '插入或调整内容' }).click(); await page.getByRole('menuitem', { name: '表格', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await page.getByRole('menuitem', { name: '1 列 × 1 行', exact: true }).waitFor(); await page.keyboard.press('Enter'); assert.equal(await editor.locator('tr').count(), 1); assert.equal(await editor.locator('th').count(), 1);
  await editor.locator('th').first().click(); await menu('删除表格');
  await editor.locator('.loose-source-block p').first().click(); await page.getByRole('button', { name: '插入或调整内容' }).click(); await page.getByRole('menuitem', { name: '表格', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  for (let index = 0; index < 4; index++) await page.keyboard.press('ArrowRight'); for (let index = 0; index < 7; index++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); assert.equal(await editor.locator('tr').count(), 8); assert.equal(await editor.locator('tr').first().locator('th').count(), 5);
  const mergeStart = await editor.locator('th').first().boundingBox(), mergeEnd = await editor.locator('tr').nth(1).locator('td').last().boundingBox();
  await page.mouse.move(mergeStart.x + 6, mergeStart.y + 8); await page.mouse.down(); await page.mouse.move(mergeEnd.x + mergeEnd.width - 6, mergeEnd.y + 8, { steps: 15 }); await page.mouse.up(); assert.equal(await editor.locator('.selectedCell').count(), 10);
  await page.getByRole('button', { name: '合并单元格' }).click(); assert.equal(await editor.locator('th').first().getAttribute('colspan'), '5'); assert.equal(await editor.locator('th').first().getAttribute('rowspan'), '2');
  await until(async () => JSON.stringify((await notebook()).document).includes('"rowspan":2'), '跨行合并未保存');
  await editor.locator('th').first().click(); await page.getByRole('button', { name: '行列操作' }).click(); assert.equal(await page.getByRole('menuitem', { name: '在右侧插入列' }).getAttribute('aria-disabled'), 'true'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '拆分单元格' }).click(); assert.equal(await editor.locator('tr').first().locator('th').count(), 5);
  await menu('在后面插入行'); assert.equal(await editor.locator('tr').count(), 9); await menu('删除表格');
  await editor.locator('.loose-source-block p').first().click();
  await editor.evaluate(element => { const clipboardData = new DataTransfer(); clipboardData.setData('text/html', `<table><tr>${'<td>宽表</td>'.repeat(6)}</tr></table>`); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })); });
  assert.equal(await editor.locator('table').count(), 0); assert.ok((await page.locator('.notebook-editor-surface [role=alert]').innerText()).includes('5 列'));
  log('三级标题、浮动标题选择、六种列表标记、键盘表格选择、5列8行网格与粘贴限制');
  await editor.locator('.loose-source-block p').first().click(); await menu('标题'); assert.equal(await editor.locator('h2').count(), 1); await menu('正文');
  await menu('列表'); assert.equal(await editor.locator('ul').count(), 1); await menu('正文'); assert.equal(await editor.locator('ul').count(), 0);
  await menu('编号'); assert.equal(await editor.locator('ol').count(), 1); await menu('正文');
  await menu('引用'); assert.equal(await editor.locator('blockquote').count(), 1); await menu('正文'); assert.equal(await editor.locator('blockquote').count(), 0);
  await editor.locator('.loose-source-block p').first().click(); await menu('表格');
  assert.equal(await editor.locator('tr').count(), 3); assert.equal(await editor.locator('th').count(), 3);
  await editor.locator('th').first().click(); await editor.pressSequentially('概念'); await editor.press('Tab'); await editor.pressSequentially('理解');
  assert.equal(await editor.locator('th').nth(1).innerText(), '理解');
  const tableToolbar = page.getByRole('toolbar', { name: '表格设置' });
  await tableToolbar.waitFor({ state: 'hidden' });
  await editor.locator('th').first().click(); await editor.press('Home'); await editor.press('Shift+End');
  await tableToolbar.waitFor(); const textToolbar = page.getByRole('toolbar', { name: '文字格式' }); await textToolbar.waitFor();
  const textBounds = await textToolbar.boundingBox(), tableBounds = await tableToolbar.boundingBox();
  assert.ok(textBounds.y + textBounds.height <= tableBounds.y || tableBounds.y + tableBounds.height <= textBounds.y, '文字与表格工具条重叠');
  await editor.locator('tr').nth(1).locator('td').first().click(); await tableToolbar.waitFor();
  const firstCell = await editor.locator('th').nth(0).boundingBox(), secondCell = await editor.locator('th').nth(1).boundingBox();
  await page.mouse.move(firstCell.x + 6, firstCell.y + 8); await page.mouse.down(); await page.mouse.move(secondCell.x + secondCell.width - 6, secondCell.y + 8, { steps: 12 }); await page.mouse.up();
  assert.equal(await editor.locator('.selectedCell').count(), 2); assert.equal(await page.getByRole('toolbar', { name: '文字格式' }).count(), 0);
  await page.getByRole('button', { name: '居中对齐', exact: true }).click(); assert.equal(await editor.locator('th').nth(0).evaluate(element => element.style.textAlign), 'center'); assert.equal(await editor.locator('th').nth(1).evaluate(element => element.style.textAlign), 'center');
  await page.getByRole('button', { name: '合并单元格' }).click(); assert.equal(await editor.locator('th').first().getAttribute('colspan'), '2');
  await page.getByRole('button', { name: '拆分单元格' }).click(); assert.equal(await editor.locator('th').count(), 3);
  await page.getByRole('button', { name: '左对齐', exact: true }).click();
  await menu('在后面插入行'); assert.equal(await editor.locator('tr').count(), 4);
  await editor.locator('tr').nth(1).locator('td').first().click();
  await menu('在右侧插入列'); assert.equal(await editor.locator('tr').first().locator('th,td').count(), 4);
  await editor.locator('tr').nth(1).locator('td').nth(1).click();
  await menu('删除当前列'); await menu('删除当前行'); assert.equal(await editor.locator('tr').count(), 3);
  await menu('切换表头'); assert.equal(await editor.locator('th').count(), 0); await menu('切换表头');
  await page.getByRole('button', { name: '插入或调整内容' }).click(); await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').count(), 0); assert.equal(await editor.evaluate(element => element === document.activeElement), true);
  await editor.locator(':scope > p').last().click(); await editor.press('Home'); await editor.press('Shift+End');
  for (const label of ['加粗', '斜体', '下划线', '删除线']) await page.getByRole('button', { name: label, exact: true }).click();
  assert.ok(await editor.locator('strong em u s, s u em strong, strong,em,u,s').count());
  await page.getByRole('button', { name: '清除文字格式' }).click(); assert.equal(await editor.locator('strong,em,u,s').count(), 0);
  await page.getByRole('button', { name: '加粗', exact: true }).click(); await page.getByRole('button', { name: '链接', exact: true }).click();
  await page.getByLabel('链接地址').fill('javascript:alert(1)'); await page.getByRole('button', { name: '确认链接' }).click(); assert.ok(await page.locator('[role=dialog] [role=alert]').count());
  await page.getByLabel('链接地址').fill('https://example.com/notes'); await page.getByRole('button', { name: '确认链接' }).click(); assert.equal(await editor.locator('a').getAttribute('href'), 'https://example.com/notes');
  await editor.press('End'); await menu('公式'); await page.getByLabel('LaTeX 公式').fill('x^2'); await page.getByRole('button', { name: '确认公式' }).click();
  await editor.locator('[data-type="inline-math"]').first().click(); await page.getByLabel('LaTeX 公式').fill('x^3'); await page.getByRole('button', { name: '确认公式' }).click();
  await editor.locator('.loose-source-block p').first().click(); await page.getByRole('button', { name: '插入或调整内容' }).click();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('menuitem', { name: '图片', exact: true }).click();
  await (await chooser).setFiles({ name: 'placement.png', mimeType: 'image/png', buffer: pixel });
  await editor.getByRole('img', { name: 'placement.png' }).waitFor();
  await until(async () => JSON.stringify((await notebook()).document).includes('/api/notebook-assets/'), '图片未同步');
  const saved = (await notebook()).document, source = saved.pages[0].doc.content.find(node => node.type === 'sourceBlock');
  assert.ok(source); assert.equal(saved.pages[0].doc.content[0].type, 'sourceBlock');
  assert.equal(source.attrs.id, 'stable-source'); assert.equal(source.attrs.origin.label, '验收摘录'); assert.equal(source.content[1].type, 'image');
  assert.ok(JSON.stringify(saved).includes('x^3')); assert.ok(JSON.stringify(saved).includes('"type":"table"'));
  for (const kind of ['paste', 'drop']) {
    await editor.locator('.loose-source-block p').first().click();
    await editor.evaluate((element, { kind, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0)), data = new DataTransfer(); data.items.add(new File([bytes], `${kind}.png`, { type: 'image/png' }));
      if (kind === 'paste') element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      else { const rect = element.querySelector('p').getBoundingClientRect(); element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: rect.left + 4, clientY: rect.top + 4, bubbles: true, cancelable: true })); }
    }, { kind, base64: pixel.toString('base64') });
    await editor.getByRole('img', { name: `${kind}.png`, exact: true }).waitFor();
  }
  await editor.locator('.loose-source-block p').last().click(); await menu('分隔线'); assert.ok(await editor.locator('hr').count());
  await page.screenshot({ path: 'test-results/notebook-editor-grid.png', fullPage: true });
  log('来源块内表格、增删行列、表头、Tab、浮动格式、链接、公式修改和图片插入位置');
  await page.getByRole('button', { name: '完成编辑' }).click(); await until(async () => (await page.locator('.loose-save-status').innerText()) === '已保存', '完成编辑未保存');
  await page.reload(); await page.locator('.loose-paper table').waitFor(); assert.ok((await page.locator('.loose-paper table').innerText()).includes('概念'));
  await page.getByRole('button', { name: '更多笔记操作' }).click(); const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '导出笔记', exact: true }).click();
  const stream = await (await downloadEvent).createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const exported = Buffer.concat(chunks).toString('utf8'); assert.ok(exported.includes('<table>') && exported.includes('概念') && exported.includes('**[末尾段落](https://example.com/notes)**'), exported);
  await page.getByRole('textbox', { name: '搜索知识点' }).fill('概念'); assert.equal(await page.locator('.loose-search-results button').count(), 1); await page.getByRole('button', { name: '清除搜索' }).click();
  await page.getByRole('button', { name: '编辑正文：交互验收' }).first().click(); await editor.waitFor(); assert.equal(await editor.locator('tr').count(), 3);
  await editor.locator('td').first().click(); await editor.pressSequentially('重开继续编辑'); await page.getByRole('button', { name: '完成编辑' }).click();
  await until(async () => JSON.stringify((await notebook()).document).includes('重开继续编辑'), '重开表格未保存'); log('表格阅读、重开编辑、搜索和保留格式导出');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [value, label] of [['ruled', '横线'], ['grid', '方格'], ['blank', '空白']]) {
    await choose(label); await page.locator(`.paper-${value}`).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/notebook-paper-mobile-${value}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '编辑正文：交互验收' }).first().click(); await editor.waitFor();
  await editor.locator('td').first().click(); await page.getByRole('button', { name: '插入或调整内容' }).click();
  const menuBounds = await page.getByRole('menu').boundingBox(); assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 390);
  await page.screenshot({ path: 'test-results/notebook-editor-mobile-menu.png', fullPage: true }); await page.keyboard.press('Escape');
  await editor.locator(':scope > p').last().click(); await editor.press('Home'); await editor.press('Shift+End'); await page.getByRole('toolbar', { name: '文字格式' }).waitFor();
  await page.screenshot({ path: 'test-results/notebook-editor-mobile-selection.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: '完成编辑' }).click(); log('390px 三种纸张、宽表格滚动和菜单无溢出');
  await page.setViewportSize({ width: 1413, height: 871 }); await until(async () => (await notebook()).document.paperType === 'blank', '空白未保存');
  await context.setOffline(true); await choose('横线'); await page.waitForTimeout(1400);
  const draft = await page.evaluate(course => new Promise(resolve => { const open = indexedDB.open('lms-notebook-drafts', 2); open.onsuccess = () => { const db = open.result, request = db.transaction('drafts').objectStore('drafts').get(course); request.onsuccess = () => { resolve(request.result?.data.document.paperType); db.close(); }; }; }), course);
  assert.equal(draft, 'ruled'); await context.setOffline(false); await until(async () => (await notebook()).document.paperType === 'ruled', '离线纸张未同步');
  for (const keepLocal of [true, false]) {
    await context.setOffline(true); await choose(keepLocal ? '方格' : '横线'); await page.waitForTimeout(1200);
    const remote = await notebook(); await read(endpoint, { revision: remote.revision, requestId: crypto.randomUUID(), document: { ...remote.document, paperType: 'blank' } });
    await context.setOffline(false); await page.locator('.loose-conflict').waitFor();
    await page.getByRole('button', { name: keepLocal ? '保留两份，继续整理' : '使用云端，本机稿移到回收区', exact: true }).click();
    await until(async () => (await notebook()).document.paperType === (keepLocal ? 'grid' : 'blank'), '冲突纸张选择错误');
    assert.equal((await notebook()).document.pages.length, 1);
  }
  assert.equal((await read(`/api/notebooks/${otherCourse}`)).document.paperType, 'ruled');
  assert.deepEqual(errors, []); log('离线纸张草稿、联网同步、冲突保留本机或采用远端、无浏览器异常');
  await context.close();
} catch (error) {
  console.error('Browser errors:', errors);
  for (const context of browser.contexts()) for (const [index, page] of context.pages().entries()) { console.error((await page.locator('body').innerText().catch(() => '')).slice(-1400)); await page.screenshot({ path: `test-results/notebook-editor-failure-${index}.png`, fullPage: true }).catch(() => {}); }
  throw error;
} finally {
  await browser.close();
  for (const id of courses) await database.course.delete({ where: { id } });
  await database.$disconnect();
}
