const { chromium, executablePath } = require('./browser-runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: process.env.QA_GPU ? ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=d3d11'] : ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const output = path.resolve('artifacts'); fs.mkdirSync(output, { recursive: true });
  const results = [];
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 667, height: 375 }, { width: 568, height: 320 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 900, isMobile: viewport.width < 900 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto((process.env.QA_BASE_URL || 'http://localhost:4173') + '/?qa', { waitUntil: 'networkidle' });
    if (viewport.width < viewport.height && viewport.width < 900) {
      await page.waitForFunction(() => document.body.classList.contains('rotate-required') && __arena.state.snapshot?.paused);
      await page.screenshot({ path: path.join(output, `arena-${viewport.width}x${viewport.height}.png`) });
      const data = await page.evaluate(() => ({ rotate: !document.querySelector('#rotate-prompt').hidden, paused: __arena.state.snapshot.paused, overflow: document.documentElement.scrollWidth > innerWidth }));
      results.push({ viewport, errors, before: { frames: 0 }, data });
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() => !document.body.classList.contains('rotate-required') && !__arena.state.snapshot.paused);
      await context.close();
      continue;
    }
    await page.waitForFunction(() => window.__arena?.state.snapshot?.state === 'playing');
    await page.mouse.move(viewport.width * 0.65, viewport.height * 0.5);
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => ({ snapshot: __arena.snapshot(), frames: __arena.frames }));
    if (viewport.width > 1000) {
      await page.keyboard.down('d'); await page.waitForTimeout(600); await page.keyboard.up('d');
      await page.keyboard.press('1'); await page.keyboard.press('3');
    } else {
      const bounds = await page.locator('#joystick').boundingBox();
      await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.locator('[data-skill="3"]').tap();
    }
    await page.waitForTimeout(500);
    const data = await page.evaluate(() => {
      const gl = __arena.view.renderer.getContext();
      const pixels = new Uint8Array(4 * gl.drawingBufferWidth * gl.drawingBufferHeight);
      __arena.view.renderer.render(__arena.view.scene, __arena.view.camera);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const samples = [];
      for (let i = 0; i < pixels.length; i += 388) samples.push(pixels.slice(i, i + 3).join(','));
      return { snapshot: __arena.snapshot(), frames: __arena.frames, canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight], colors: new Set(samples).size,
        overflow: document.documentElement.scrollWidth > innerWidth,
        labelCount: document.querySelectorAll('.character-label').length,
        legs: [...__arena.view.actors.values()].map(a => a.legParts.map(l => l.hip.rotation.x)),
        geometry: __arena.view.renderer.info.render.triangles };
    });
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.ok(data.colors > 50, JSON.stringify(data.canvas));
    assert.equal(data.overflow, false);
    data.layout = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
      const actor = __arena.view.actors.get(__arena.state.localId);
      return { controls: ['#joystick', '.skill-line', '.skill-dash', '.skill-lob', '.skill-basic', '.matchboard', '#mini-map', '.brand', '.top-actions', '.player-status'].map(rect), character: actor ? __arena.view.project(actor.root.position.x, 1, actor.root.position.z) : null };
    });
    if (viewport.width < 900) for (const control of data.layout.controls) {
      assert.ok(control.x >= 0 && control.right <= viewport.width && control.y >= 0 && control.bottom <= viewport.height, JSON.stringify({ viewport, control }));
      const p = data.layout.character;
      assert.ok(!p || p.x < control.x || p.x > control.right || p.y < control.y || p.y > control.bottom, JSON.stringify({ viewport, p, control }));
    }
    const frameStart = await page.evaluate(() => ({ frames: __arena.frames, now: performance.now() }));
    await page.waitForTimeout(5000);
    data.performance = await page.evaluate(start => { const gl = __arena.view.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return { fps: (__arena.frames - start.frames) * 1000 / (performance.now() - start.now), drawCalls: __arena.view.renderer.info.render.calls, pixelRatio: __arena.view.renderer.getPixelRatio(), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) }; }, frameStart);
    await page.screenshot({ path: path.join(output, `arena-${viewport.width}x${viewport.height}.png`) });
    await page.locator('#network-button').click();
    await page.screenshot({ path: path.join(output, `room-${viewport.width}x${viewport.height}.png`) });
    results.push({ viewport, errors, before: { players: before.snapshot.players.length, frames: before.frames }, data });
    await context.close();
  }
  fs.writeFileSync(path.join(output, 'browser-qa.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(r => ({ viewport: r.viewport, errors: r.errors, canvas: r.data.canvas, colors: r.data.colors, overflow: r.data.overflow, rotate: r.data.rotate, paused: r.data.paused, labels: r.data.labelCount, triangles: r.data.geometry, performance: r.data.performance, frameDelta: r.data.frames - r.before.frames, local: r.data.snapshot?.players[0], legs: r.data.legs })), null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
