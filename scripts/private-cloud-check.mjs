import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:4174', email = 'private-test@example.com', password = randomBytes(20).toString('hex');
await mkdir('tmp', { recursive: true });
const directory = await mkdtemp(path.resolve('tmp/private-cloud-')), dataDir = path.join(directory, 'data'); await mkdir(path.join(dataDir, 'uploads'), { recursive: true });
const url = `file:${path.join(dataDir, 'workbench.db').replaceAll('\\', '/')}`;
const env = { ...process.env, DATABASE_URL: url, DATA_DIR: dataDir, PRIVATE_CLOUD: '1', APP_URL: base, PRIVATE_OWNER_EMAIL: email, BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), DEEPSEEK_API_KEY: '', NODE_ENV: 'production' }; delete env.NEXT_DIST_DIR;
const schema = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env, encoding: 'utf8', windowsHide: true });
assert.equal(schema.status, 0, schema.stderr);
const database = new PrismaClient({ datasources: { db: { url } } });
const userId = randomUUID();
await database.user.create({ data: { id: userId, email, emailVerified: true, name: '验收账号', accounts: { create: { id: randomUUID(), accountId: userId, providerId: 'credential', password: await hashPassword(password) } } } });
await database.course.create({ data: { id: 'cloud-test', name: '隔离云端验收' } });
const bytes = Buffer.from('仅登录可读的原文件'), filePath = path.join(dataDir, 'uploads', 'private-test.txt'); await writeFile(filePath, bytes);
await database.material.create({ data: { id: 'private-material', courseId: 'cloud-test', name: '私人资料.txt', mime: 'text/plain', size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex'), filePath, origin: '隔离验收' } });
const document = { chapters: [], pages: [{ id: 'point', title: '验收知识点', chapterId: null, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '云端原稿。' }] }] } }], inbox: [], trash: [] };
await database.notebook.create({ data: { courseId: 'cloud-test', content: JSON.stringify(document) } });
let server, browser, logText = '';
const log = message => console.log('PASS', message);
const until = async (predicate, message, limit = 30000) => { const start = Date.now(); while (Date.now() - start < limit) { try { if (await predicate()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 120)); } throw new Error(message + '\n' + logText.slice(-2000)); };
async function start() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '4174'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => { logText += data; }); server.stderr.on('data', data => { logText += data; });
  await until(async () => (await fetch(base + '/login')).ok, '隔离服务未启动');
}
async function stop() { const active = server; server = undefined; if (active && active.exitCode === null && active.signalCode === null) { const exited = new Promise(resolve => active.once('exit', resolve)); active.kill(); await exited; } }
try {
  await start();
  const root = await fetch(base + '/?course=cloud-test&view=outline', { redirect: 'manual' }); assert.equal(root.status, 307); assert.ok(root.headers.get('location').startsWith('/login'));
  for (const route of ['/api/workspace', '/api/notebooks/cloud-test', '/api/notebooks/cloud-test?history=1', '/api/files/private-material', '/api/notebook-assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png', '/api/import-inbox', '/api/chat?courseId=cloud-test', '/api/practice/history?courseId=cloud-test', '/api/practice?courseId=cloud-test', '/api/exam-records?courseId=cloud-test', '/api/materials/private-material/extraction', '/api/samples/core']) assert.equal((await fetch(base + route)).status, 401, route);
  for (const route of ['/api/materials', '/api/folders', '/api/generation', '/api/versions', '/api/notebook-assets', '/api/practice/feedback']) assert.equal((await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' })).status, 401, route);
  log('未登录页面跳转，全部学习数据与原文件拒绝访问');
  const signup = await fetch(base + '/api/auth/sign-up/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ email: 'new-test@example.com', name: '外部账号', password }) }); assert.equal(signup.ok, false); assert.equal(await database.user.count(), 1); log('公开注册关闭');
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1092, height: 871 } }), page = await context.newPage();
  await page.goto(base + '/?course=cloud-test&view=outline', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('私人账号').fill(email); await page.getByLabel('密码', { exact: true }).fill(password); await page.getByRole('button', { name: '登录学习空间' }).click();
  await page.waitForSelector('.loose-paper'); assert.equal((await context.request.get(base + '/api/files/private-material')).status(), 200); log('固定账号登录后能读笔记与原件');
  await page.screenshot({ path: 'test-results/private-login-notebook.png', fullPage: true });
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), phone = await phoneContext.newPage();
  await phone.goto(base + '/?course=cloud-test&view=outline', { waitUntil: 'domcontentloaded' }); await phone.getByLabel('私人账号').fill(email); await phone.getByLabel('密码', { exact: true }).fill(password); await phone.getByRole('button', { name: '登录学习空间' }).click(); await phone.waitForSelector('.loose-paper');
  const current = await (await phoneContext.request.get(base + '/api/notebooks/cloud-test')).json();
  current.document.pages[0].doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: '手机的跨设备补记。' }] });
  const begin = Date.now(); const response = await phoneContext.request.patch(base + '/api/notebooks/cloud-test', { headers: { Origin: base }, data: { revision: current.revision, requestId: randomUUID(), document: current.document } }); assert.equal(response.status(), 200);
  await page.getByText('手机的跨设备补记。', { exact: true }).first().waitFor({ timeout: 5000 }); assert.ok(Date.now() - begin < 5000); log(`正常网络跨设备更新 ${Date.now() - begin}ms`);
  await stop(); await start(); await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByText('手机的跨设备补记。', { exact: true }).first().waitFor();
  assert.equal(await (await context.request.get(base + '/api/files/private-material')).text(), bytes.toString()); log('服务重启后账号、原件和笔记完整');
  await context.close(); await phoneContext.close(); await browser.close(); browser = null; await stop(); await database.$disconnect();
  const python = process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3'), backup = path.join(directory, 'checked-backup.tar.gz'), restored = path.join(directory, 'restored-data');
  for (const args of [['backup', dataDir, backup], ['restore', backup, restored]]) { const check = spawnSync(python, ['scripts/learning-backup.py', ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(check.status, 0, check.stderr); }
  assert.deepEqual(await readFile(path.join(restored, 'uploads', 'private-test.txt')), bytes);
  const restoredDatabase = new PrismaClient({ datasources: { db: { url: `file:${path.join(restored, 'workbench.db').replaceAll('\\', '/')}` } } });
  assert.ok((await restoredDatabase.notebook.findUniqueOrThrow({ where: { courseId: 'cloud-test' } })).content.includes('手机的跨设备补记')); await restoredDatabase.$disconnect();
  log('数据库与原件完整备份、恢复到新目录并校验');
} finally { await browser?.close(); await stop(); await database.$disconnect(); }
