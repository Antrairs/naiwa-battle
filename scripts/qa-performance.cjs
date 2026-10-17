const { chromium, executablePath } = require('./browser-runtime.cjs');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
  const results = [];
  for (const viewport of [{ width: 1440, height: 960 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });
    const page = await context.newPage();
    await page.goto((process.env.QA_BASE_URL || 'http://localhost:4173') + '/?qa', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => __arena.state.snapshot?.state === 'playing');
    await page.waitForTimeout(9000);
    const before = await page.evaluate(() => ({ frames: __arena.frames, now: performance.now() }));
    await page.waitForTimeout(8000);
    const result = await page.evaluate(before => ({ fps: (__arena.frames - before.frames) * 1000 / (performance.now() - before.now), ratio: __arena.view.renderer.getPixelRatio(), resolutionScale: __arena.view.resolutionScale, calls: __arena.view.renderer.info.render.calls, antialias: __arena.view.renderer.getContext().getContextAttributes().antialias }), before);
    results.push({ viewport, ...result });
    await context.close();
  }
  fs.writeFileSync('artifacts/performance-qa.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
