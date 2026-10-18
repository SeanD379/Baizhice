import { spawnSync, spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
if (process.env.PRIVATE_CLOUD !== '1' || !process.env.APP_URL?.startsWith('https://') || !process.env.BETTER_AUTH_SECRET || !process.env.PRIVATE_OWNER_EMAIL) throw new Error('请完整配置私人云端账号、HTTPS 入口和登录密钥。');
const directory = path.resolve(process.env.DATA_DIR || 'data');
await mkdir(directory, { recursive: true });
// Refuse destructive schema changes: prisma asks for --accept-data-loss when needed.
const schema = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { stdio: 'inherit', env: process.env });
if (schema.status !== 0) process.exit(schema.status || 1);
const database = new PrismaClient();
try {
  for (const [model, folder] of [['material', 'uploads'], ['inboxItem', 'import-inbox']]) {
    for (const item of await database[model].findMany({ select: { id: true, filePath: true } })) {
      const relocated = path.join(directory, folder, path.win32.basename(item.filePath.replaceAll('/', '\\')));
      await access(relocated).catch(() => { throw new Error('迁移数据中缺少原文件，请检查完整数据目录后重启。'); });
      if (item.filePath !== relocated) await database[model].update({ where: { id: item.id }, data: { filePath: relocated } });
    }
  }
  if (!await database.user.findUnique({ where: { email: process.env.PRIVATE_OWNER_EMAIL.toLowerCase() } })) console.log('请运行私人账号初始化命令后登录。');
} finally { await database.$disconnect(); }
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', '4173'], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal));
server.on('exit', code => process.exit(code || 0));
