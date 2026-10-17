const { chromium, executablePath } = require('./browser-runtime.cjs');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const media = new Set();
  page.on('response', r => { if (/\.(m4a|mp3|ogg|png|webp)(\?|$)/.test(r.url())) media.add(r.url()); });
  await page.goto('https://nai-dou-luo.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  if (await page.locator('#profileDialog').isVisible()) await page.locator('#profileSkip').click();
  await page.screenshot({ path: 'artifacts/reference-menu.png' });
  await page.locator('#startBtn').click();
  if (await page.locator('#profileDialog').isVisible()) await page.locator('#profileSkip').click();
  await page.locator('#campaignBtn').click();
  await page.locator('#enterLevelBtn').click();
  await page.locator('#beginBtn').click();
  if (await page.locator('#guideSkipBtn').isVisible()) await page.locator('#guideSkipBtn').click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'artifacts/reference-game.png' });
  await page.keyboard.down('d'); await page.keyboard.down('j');
  await page.waitForTimeout(2200);
  await page.keyboard.up('d'); await page.keyboard.up('j');
  await page.screenshot({ path: 'artifacts/reference-game-moving.png' });
  console.log(JSON.stringify({ title: await page.title(), screen: await page.locator('#gameShell').getAttribute('data-screen'), media: [...media] }, null, 2));
  fs.writeFileSync('artifacts/reference-media.json', JSON.stringify([...media], null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
