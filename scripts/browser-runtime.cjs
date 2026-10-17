const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let runtime;
for (const candidate of [process.env.PLAYWRIGHT_PACKAGE, 'playwright', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
  try { runtime = require(candidate); break; } catch {}
}
if (!runtime) throw new Error('Browser QA requires Playwright. Set PLAYWRIGHT_PACKAGE or install it locally.');
const edge = process.platform === 'win32' ? path.join(process.env['ProgramFiles(x86)'] || process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe') : '';
module.exports = { chromium: runtime.chromium, executablePath: process.env.QA_BROWSER_PATH || (edge && fs.existsSync(edge) ? edge : undefined) };
