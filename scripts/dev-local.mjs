import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '4175'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, NODE_ENV: 'development', NEXT_DIST_DIR: '.next-app-shell' } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code || 0));
