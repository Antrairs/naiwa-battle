const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const root = __dirname;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function health(port) {
  try { return await (await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(700) })).json(); } catch { return null; }
}
function open(url) {
  if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  console.log(`嘉年华竞技场: ${url}`);
}
function occupied(port) {
  return new Promise(resolve => {
    const probe = net.createConnection({ host: '127.0.0.1', port });
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => { probe.destroy(); resolve(false); });
    probe.setTimeout(700, () => { probe.destroy(); resolve(true); });
  });
}
(async () => {
  if (!fs.existsSync(path.join(root, 'node_modules', 'three'))) throw new Error('请先在此目录运行 npm install，再启动游戏。');
  let port = 4173;
  for (; port < 4184; port++) {
    const existing = await health(port);
    if (existing?.app === 'bombo-arena') {
      const assets = await fetch(`http://localhost:${port}/fullscreen.js`, { method: 'HEAD', signal: AbortSignal.timeout(700) }).catch(() => null);
      if (assets?.ok) return open(`http://localhost:${port}`);
    }
    if (!(await occupied(port))) break;
  }
  if (port >= 4184) throw new Error('4173 至 4183 端口均被占用，请设置其他端口后运行 npm start。');
  const stdout = fs.openSync(path.join(root, 'server.log'), 'a');
  const stderr = fs.openSync(path.join(root, 'server-error.log'), 'a');
  const server = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: { ...process.env, PORT: String(port) }, windowsHide: true, detached: true, stdio: ['ignore', stdout, stderr] });
  server.unref(); fs.closeSync(stdout); fs.closeSync(stderr);
  for (let i = 0; i < 40; i++) { await wait(200); if ((await health(port))?.app === 'bombo-arena') return open(`http://localhost:${port}`); }
  throw new Error('服务器未能启动，请查看 server-error.log。');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
