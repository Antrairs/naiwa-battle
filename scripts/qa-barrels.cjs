const { chromium, executablePath } = require('./browser-runtime.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const url = (process.env.QA_BASE_URL || 'http://localhost:4173') + '/?qa';
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => __arena.state.snapshot?.state === 'playing');
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'artifacts/barrels-game-desktop.png' });
    const model = await page.evaluate(() => ({ barrels: __arena.view.environment.children.filter(c => c.name === 'milk-tank').length, triangles: __arena.view.renderer.info.render.triangles }));
    assert.equal(model.barrels, 6);
    await page.evaluate(() => new Promise(resolve => __arena.socket.emit('pause', { paused: true }, resolve)));
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.addStyleTag({ content: '#app > :not(#arena) { visibility:hidden!important }' });
    await page.evaluate(() => {
      const view = __arena.view, original = view.render.bind(view);
      view.render = (...args) => {
        original(...args);
        view.camera.left = -4.7; view.camera.right = 4.7; view.camera.top = 3.76; view.camera.bottom = -3.76;
        view.camera.position.set(-1.7, 6.2, -3.1); view.camera.lookAt(-6.7, 1.3, -15.1); view.camera.updateProjectionMatrix();
        view.renderer.render(view.scene, view.camera);
      };
    });
    await page.waitForTimeout(500);
    const pixels = await page.evaluate(() => {
      const renderer = __arena.view.renderer, gl = renderer.getContext(); renderer.render(__arena.view.scene, __arena.view.camera);
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const colors = new Set(); for (let i = 0; i < data.length; i += 388) colors.add(data.slice(i, i + 3).join(',')); return colors.size;
    });
    assert.ok(pixels > 100, String(pixels));
    await page.screenshot({ path: 'artifacts/barrel-model-detail.png' }); await page.close();
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    const phone = await context.newPage(); phone.on('pageerror', e => errors.push(e.message));
    await phone.goto(url, { waitUntil: 'networkidle' }); await phone.waitForFunction(() => __arena.state.snapshot?.state === 'playing'); await phone.waitForTimeout(250);
    await phone.screenshot({ path: 'artifacts/barrels-game-mobile.png' });
    await context.close(); assert.equal(errors.length, 0, errors.join('\n'));
    const result = { ok: true, ...model, colors: pixels, errors }; fs.writeFileSync('artifacts/barrels-qa.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
