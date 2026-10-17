const { chromium, executablePath } = require('./browser-runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const requests = []; page.on('response', r => { if (r.url().includes('/assets/')) requests.push({ url: r.url(), status: r.status() }); });
    await page.goto((process.env.QA_BASE_URL || 'http://localhost:4173') + '/?qa', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => __arena.state.snapshot?.state === 'playing');
    assert.equal(await page.evaluate(() => __arena.audio.context), null);
    await page.keyboard.press('w');
    await page.waitForFunction(() => __arena.audio.musicPlaying);
    const music = await page.evaluate(async () => {
      const audio = __arena.audio, ctx = audio.context, analyser = ctx.createAnalyser();
      analyser.fftSize = 2048; audio.musicGain.connect(analyser);
      const values = new Float32Array(2048);
      const peak = async () => { let max = 0; for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 35)); analyser.getFloatTimeDomainData(values); for (const value of values) max = Math.max(max, Math.abs(value)); } return max; };
      const source = audio.musicElement, duration = source.duration;
      const audible = await peak();
      for (let i = 0; i < 8; i++) await audio.enable();
      const sameAfterGestures = source === audio.musicElement;
      source.currentTime = duration - 0.35;
      await new Promise(r => setTimeout(r, 1200));
      const afterLoop = await peak(), sameAfterLoop = source === audio.musicElement, looped = source.currentTime < 3;
      audio.setHidden(true); const hiddenStopped = source.paused && !audio.musicPlaying;
      audio.setHidden(false); await audio.musicPlayPending; const restored = audio.musicPlaying;
      audio.mute(); const mutedStopped = source.paused && !audio.musicPlaying;
      await audio.enable(); await audio.musicPlayPending; const resumed = audio.musicPlaying;
      audio.setMusicVolume(0); const musicOnlyMuted = source.paused && audio.ready;
      audio.setMusicVolume(0.28); await audio.musicPlayPending;
      audio.musicGain.disconnect(analyser); analyser.disconnect();
      return { duration, audible, afterLoop, sameAfterGestures, sameAfterLoop, looped, hiddenStopped, restored, mutedStopped, resumed, musicOnlyMuted, loop: source.loop, voices: audio.voices, musicError: audio.musicError };
    });
    assert.ok(music.duration > 5 && music.audible > 0.0001 && music.afterLoop > 0.0001, JSON.stringify(music));
    for (const key of ['sameAfterGestures','sameAfterLoop','looped','hiddenStopped','restored','mutedStopped','resumed','musicOnlyMuted','loop']) assert.equal(music[key], true, key);
    assert.equal(music.musicError, null);
    const map = await page.evaluate(() => {
      const view = __arena.view;
      return { textures: view.environmentTextures.map(t => ({ loaded: t.image?.width > 0, width: t.image?.width, height: t.image?.height, url: t.image?.src })), walls: view.wallMeshes.length, wallBatches: view.wallMeshes.map(w => w.children.length), geometry: view.renderer.info.render.triangles, calls: view.renderer.info.render.calls };
    });
    assert.ok(map.textures.every(t => t.loaded)); assert.equal(map.walls, 8); assert.ok(map.wallBatches.every(n => n <= 3));
    await page.locator('#pause-button').click();
    await page.waitForFunction(() => !__arena.audio.musicPlaying && __arena.state.snapshot.paused);
    await page.screenshot({ path: 'artifacts/factory-settings-desktop.png' });
    await page.locator('[data-quality="high"]').click();
    assert.equal(await page.evaluate(() => __arena.view.renderer.shadowMap.enabled), true);
    await page.locator('[data-quality="standard"]').click();
    assert.equal(await page.evaluate(() => __arena.view.renderer.shadowMap.enabled), false);
    await page.locator('#resume-button').click(); await page.waitForFunction(() => __arena.audio.musicPlaying);
    await page.screenshot({ path: 'artifacts/factory-final-desktop.png' });
    assert.equal(errors.length, 0, errors.join('\n')); assert.ok(requests.length >= 3 && requests.every(r => r.status === 200 || r.status === 206), JSON.stringify(requests));
    await page.close();
    const mobile = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    const phone = await mobile.newPage(); phone.on('pageerror', e => errors.push(e.message));
    await phone.goto((process.env.QA_BASE_URL || 'http://localhost:4173') + '/?qa', { waitUntil: 'networkidle' });
    await phone.waitForFunction(() => __arena.state.snapshot?.state === 'playing');
    await phone.locator('#pause-button').tap(); await phone.waitForFunction(() => __arena.state.snapshot.paused);
    await phone.locator('#music-volume').scrollIntoViewIfNeeded();
    const slider = await phone.locator('#music-volume').boundingBox();
    await phone.touchscreen.tap(slider.x + slider.width * 0.55, slider.y + slider.height / 2);
    const phoneVolume = await phone.evaluate(() => __arena.audio.musicVolume);
    assert.ok(phoneVolume > 0.45 && phoneVolume < 0.65, String(phoneVolume));
    const mobileLayouts = [];
    for (const viewport of [{ width: 844, height: 390 }, { width: 568, height: 320 }]) {
      await phone.setViewportSize(viewport); await phone.waitForTimeout(200);
      const layout = await phone.locator('.settings-dialog').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { height: element.clientHeight, contentHeight: element.scrollHeight, x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, innerWidth, scale: visualViewport.scale };
      });
      assert.ok(layout.contentHeight <= layout.height + 1 && layout.x >= 0 && layout.right <= viewport.width && layout.y >= 0 && layout.bottom <= viewport.height, JSON.stringify({ viewport, layout }));
      assert.ok(Math.abs(layout.innerWidth - viewport.width) <= 1 && Math.abs(layout.scale - 1) < 0.01, JSON.stringify({ viewport, layout }));
      mobileLayouts.push({ viewport, ...layout });
      await phone.screenshot({ path: `artifacts/factory-settings-mobile-${viewport.width}.png` });
    }
    await phone.locator('#resume-button').tap(); await phone.waitForFunction(() => __arena.audio.musicPlaying);
    await phone.reload({ waitUntil: 'networkidle' });
    assert.equal(await phone.evaluate(() => __arena.audio.musicVolume), phoneVolume);
    assert.equal(await phone.evaluate(() => __arena.audio.context), null);
    await mobile.close();
    assert.equal(errors.length, 0, errors.join('\n'));
    const result = { ok: true, music, map, phoneVolume, mobileLayouts, requests, errors }; fs.writeFileSync('artifacts/factory-qa.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
