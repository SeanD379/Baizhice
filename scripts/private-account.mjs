import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

const email = process.env.PRIVATE_OWNER_EMAIL?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请先设置 PRIVATE_OWNER_EMAIL。');
const database = new PrismaClient();
try {
  if (await database.user.findUnique({ where: { email } }) && !process.argv.includes('--reset-password')) { console.log('私人账号已存在，密码未修改。'); process.exitCode = 0; }
  else {
    let muted = false;
    const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
    const reader = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
    process.stdout.write('设置私人密码（至少 12 位）：'); muted = true;
    const password = await reader.question(''); muted = false; process.stdout.write('\n再次输入：'); muted = true;
    const repeated = await reader.question(''); muted = false; reader.close(); process.stdout.write('\n');
    if (password.length < 12 || password !== repeated) throw new Error('密码长度不足或两次输入不一致，账号未修改。');
    const hashed = await hashPassword(password);
    await database.$transaction(async transaction => {
      const user = await transaction.user.upsert({ where: { email }, create: { id: randomUUID(), name: '我的学习空间', email, emailVerified: true }, update: {} });
      const account = await transaction.account.findFirst({ where: { userId: user.id, providerId: 'credential' } });
      if (account) await transaction.account.update({ where: { id: account.id }, data: { password: hashed } });
      else await transaction.account.create({ data: { id: randomUUID(), userId: user.id, accountId: user.id, providerId: 'credential', password: hashed } });
      await transaction.session.deleteMany({ where: { userId: user.id } });
    });
    console.log('私人账号已保存，公开注册已关闭。');
  }
} finally { await database.$disconnect(); }
