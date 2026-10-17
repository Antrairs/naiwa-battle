const { chromium, executablePath } = require('./browser-runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
  try {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    const page = await context.newPage(), errors = [], mediaRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.url().includes('/assets/audio/')) mediaRequests.push({ url: r.url(), type: r.resourceType(), range: r.headers().range }); });
    await page.addInitScript(() => {
      const nativePlay = HTMLMediaElement.prototype.play;
      window.__musicPlayAttempts = 0;
      HTMLMediaElement.prototype.play = function (...args) {
        if (this.src.includes('/assets/audio/')) {
          window.__musicPlayAttempts++;
          if (window.__musicPlayAttempts === 1) return Promise.reject(new DOMException('Simulated mobile gesture restriction', 'NotAllowedError'));
        }
        return nativePlay.apply(this, args);
      };
    });
    await page.goto((process.env.QA_BASE_URL || 'http://localhost:4174') + '/?qa', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__arena?.state.snapshot?.state === 'playing');
    assert.equal(await page.evaluate(() => __arena.audio.context), null);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 50, downloadThroughput: 14 * 1024, uploadThroughput: 128 * 1024, connectionType: 'cellular3g' });
    const started = Date.now();
    await page.locator('#joystick').tap();
    await page.waitForFunction(() => __arena.audio.musicPlaying, { timeout: 25000 });
    const streaming = await page.evaluate(() => {
      const audio = __arena.audio, music = audio.musicElement;
      window.__firstMusicElement = music;
      return { duration: music.duration, time: music.currentTime, buffered: Array.from({ length: music.buffered.length }, (_, i) => [music.buffered.start(i), music.buffered.end(i)]), readyState: music.readyState, loop: music.loop, attempts: __musicPlayAttempts, context: audio.context.state, error: audio.musicError };
    });
    streaming.startMs = Date.now() - started;
    assert.ok(streaming.duration > 5 && streaming.loop && streaming.context === 'running' && streaming.attempts >= 2, JSON.stringify(streaming));
    assert.equal(streaming.error, null);
    assert.ok(streaming.buffered.length && streaming.buffered.every(r => r[1] < streaming.duration - 0.5), JSON.stringify(streaming));
    assert.ok(mediaRequests.length && mediaRequests.every(r => r.type === 'media'), JSON.stringify(mediaRequests));
    const peak = await page.evaluate(async () => {
      const audio = __arena.audio, analyser = audio.context.createAnalyser();
      analyser.fftSize = 1024; audio.musicGain.connect(analyser);
      const samples = new Float32Array(1024); let peak = 0;
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 40)); analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      }
      audio.musicGain.disconnect(analyser); analyser.disconnect(); return peak;
    });
    assert.ok(peak > 0.0001, `Silent music output: ${peak}`);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.locator('#pause-button').tap();
    await page.waitForFunction(() => __arena.state.snapshot.paused && __arena.audio.musicElement.paused);
    const pausedAt = await page.evaluate(() => __arena.audio.musicElement.currentTime);
    await page.waitForTimeout(350);
    assert.ok(Math.abs(await page.evaluate(() => __arena.audio.musicElement.currentTime) - pausedAt) < 0.05);
    await page.locator('#resume-button').tap();
    await page.waitForFunction(() => __arena.audio.musicPlaying);
    await page.locator('#sound-button').tap();
    await page.waitForFunction(() => !__arena.audio.enabled && __arena.audio.musicElement.paused);
    await page.locator('#sound-button').tap();
    await page.waitForFunction(() => __arena.audio.musicPlaying);
    await page.evaluate(() => __arena.audio.setHidden(true));
    assert.equal(await page.evaluate(() => __arena.audio.musicElement.paused), true);
    await page.evaluate(() => __arena.audio.setHidden(false));
    await page.waitForFunction(() => __arena.audio.musicPlaying);
    assert.equal(await page.evaluate(() => __arena.audio.musicElement === __firstMusicElement), true);
    assert.equal(await page.evaluate(() => __arena.audio.musicError), null);
    await page.screenshot({ path: 'artifacts/mobile-music-stream.png' });
    assert.equal(errors.length, 0, errors.join('\n'));
    const result = { ok: true, streaming, peak, mediaRequests, pausedAt, checks: ['no full-file fetch or decode','native media range streaming under 14 KB/s','music audible before complete download','pointer release/click retries autoplay rejection','single media element survives gestures and lifecycle changes','pause retains position','mute and return from background resume music'], errors };
    fs.writeFileSync('artifacts/music-stream-qa.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
