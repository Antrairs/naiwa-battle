const { chromium, executablePath } = require('./browser-runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.QA_BASE_URL || 'http://localhost:4173';

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
  const errors = [], result = {};
  fs.mkdirSync('artifacts', { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/factory-floor.webp', async route => { await gate; await route.continue(); });
    await page.goto(base + '/?qa=entry', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__arena?.state.connected && document.querySelector('#entry-art').naturalWidth > 0);
    assert.equal(await page.locator('#entry-loading').isVisible(), true);
    assert.equal(await page.locator('#mode-picker').isVisible(), false);
    assert.equal(await page.evaluate(() => __arena.state.room), null);
    await page.screenshot({ path: 'artifacts/entry-loading-desktop.png' });
    release();
    await page.locator('#mode-training').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#entry-screen').getAttribute('aria-busy'), 'false');
    assert.equal(await page.evaluate(() => __arena.state.snapshot), null);
    const boxes = await page.locator('.mode-button').evaluateAll(items => items.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, bottom: r.bottom, width: r.width }; }));
    assert.ok(boxes[0].right < boxes[1].x && boxes.every(b => b.width > 0 && b.bottom <= 900));
    await page.screenshot({ path: 'artifacts/entry-desktop.png' });

    await page.locator('#mode-training').click();
    await page.waitForFunction(() => __arena.state.snapshot?.state === 'playing');
    assert.equal(await page.locator('#entry-screen').isVisible(), false);
    assert.equal(await page.evaluate(() => __arena.state.room.training), true);
    const pixels = await page.evaluate(() => {
      const v = __arena.view, gl = v.renderer.getContext(); v.renderer.render(v.scene, v.camera);
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const colors = new Set(); for (let i = 0; i < data.length; i += 388) colors.add(data.slice(i, i + 3).join(',')); return colors.size;
    });
    assert.ok(pixels > 100, `Canvas has only ${pixels} sampled colors`);
    await page.screenshot({ path: 'artifacts/entry-game-desktop.png' });
    await page.locator('.top-actions [data-fullscreen]').click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    assert.equal(await page.locator('.top-actions [data-fullscreen]').getAttribute('aria-pressed'), 'true');
    await page.locator('.top-actions [data-fullscreen]').click();
    await page.waitForFunction(() => !document.fullscreenElement);
    result.fullscreen = true;

    await page.locator('#home-button').click();
    await page.waitForFunction(() => !__arena.state.busy);
    assert.equal(await page.locator('#mode-picker').isVisible(), true);
    assert.equal(await page.evaluate(() => __arena.state.snapshot), null);
    await page.locator('#mode-friends').click();
    await page.locator('#room-code').fill('0000'); await page.locator('#join-room').click();
    await page.waitForFunction(() => document.querySelector('#room-error').textContent.length > 0);
    await page.locator('#create-room').click(); await page.locator('#display-code').waitFor({ state: 'visible' });
    const code = await page.locator('#display-code').textContent();
    assert.match(code, /^\d{4}$/);
    assert.equal(await page.evaluate(() => __arena.state.snapshot), null);
    await page.screenshot({ path: 'artifacts/entry-room-desktop.png' });
    const friend = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    friend.on('pageerror', e => errors.push(e.message));
    await friend.goto(base + '/?qa=entry'); await friend.locator('#mode-friends').click();
    await friend.locator('#room-code').fill(code); await friend.locator('#join-room').click();
    await friend.waitForFunction(() => __arena.state.room?.members.length === 2);
    await page.locator('#fill-bots').click(); await page.locator('#start-match').click();
    await page.waitForFunction(() => __arena.state.snapshot?.state === 'playing');
    await friend.waitForFunction(() => __arena.state.snapshot?.state === 'playing');
    assert.equal(await friend.evaluate(() => __arena.state.screen), 'battle');
    const departed = await page.evaluate(() => __arena.state.localId);
    await page.locator('#home-button').click();
    await friend.waitForFunction(id => __arena.state.snapshot?.players.find(p => p.id === id)?.bot, departed);
    result.multiplayer = true;
    await friend.close();
    await page.waitForFunction(() => !__arena.state.busy);
    await page.locator('#mode-friends').click(); await page.locator('[data-close="room-modal"]').click();
    await page.waitForFunction(() => !__arena.state.busy);
    assert.equal(await page.evaluate(() => __arena.state.screen), 'home');
    await page.locator('#mode-training').click();
    await page.waitForFunction(() => __arena.state.snapshot?.state === 'playing');
    await page.evaluate(() => { __arena.socket.disconnect(); __arena.socket.connect(); });
    await page.waitForFunction(() => __arena.state.connected && __arena.state.screen === 'home' && !__arena.state.busy);
    assert.equal(await page.evaluate(() => __arena.state.room), null);
    result.reconnectToLobby = true;
    await page.close();

    for (const [width, height] of [[844, 390], [568, 320], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
      const phone = await context.newPage(); phone.on('pageerror', e => errors.push(e.message));
      await phone.goto(base + '/?qa=entry'); await phone.locator('#mode-picker').waitFor({ state: 'visible' });
      const layout = await phone.locator('.mode-button').evaluateAll(items => items.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, overflow: el.scrollWidth > el.clientWidth }; }));
      assert.ok(layout[0].right < layout[1].x);
      assert.ok(layout.every(r => r.x >= 0 && r.right <= width && r.y >= 0 && r.bottom <= height && !r.overflow), JSON.stringify(layout));
      await phone.screenshot({ path: `artifacts/entry-${width}x${height}.png` });
      await phone.locator('#mode-training').click();
      if (height > width) {
        await phone.locator('#rotate-prompt').waitFor({ state: 'visible' });
        await phone.setViewportSize({ width: height, height: width });
      }
      await phone.waitForFunction(() => __arena.state.snapshot?.state === 'playing');
      assert.equal(await phone.evaluate(() => __arena.state.snapshot.paused), false);
      await phone.locator('.top-actions [data-fullscreen]').click();
      await phone.waitForFunction(() => !!document.fullscreenElement);
      await phone.locator('.top-actions [data-fullscreen]').click();
      await phone.waitForFunction(() => !document.fullscreenElement);
      await phone.evaluate(() => { document.documentElement.requestFullscreen = undefined; document.documentElement.webkitRequestFullscreen = undefined; });
      await phone.locator('.top-actions [data-fullscreen]').click();
      assert.match(await phone.locator('#toast').textContent(), /不支持网页全屏/);
      await context.close();
    }
    const failure = await browser.newPage();
    failure.on('pageerror', e => errors.push(e.message));
    await failure.route('**/factory-floor.webp', route => route.abort());
    await failure.goto(base + '/?qa=entry');
    await failure.locator('#loading-retry').waitFor({ state: 'visible' });
    assert.match(await failure.locator('#loading-message').textContent(), /素材加载失败/);
    assert.equal(await failure.evaluate(() => __arena.state.room), null);
    await failure.close();
    result.loadingFailure = true;
    assert.deepEqual(errors, []);
    Object.assign(result, { ok: true, pixels, errors });
    fs.writeFileSync('artifacts/entry-qa.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
