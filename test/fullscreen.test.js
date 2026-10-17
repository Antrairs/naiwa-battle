import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupFullscreen } from '../fullscreen.js';

const saved = Object.fromEntries(['document', 'window', 'screen', 'matchMedia'].map(key => [key, globalThis[key]]));
afterEach(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
function fixture() {
  const messages = [], calls = [], events = new Map();
  const buttons = Array.from({ length: 3 }, () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(_event, fn) { this.click = fn; } }));
  const root = {};
  const doc = { documentElement: root, querySelectorAll: () => buttons, addEventListener(type, fn) { events.set(type, fn); } };
  globalThis.document = doc; globalThis.window = { lucide: { createIcons() {} } };
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.screen = { orientation: { lock: async value => calls.push(value), unlock: () => calls.push('unlock') } };
  const init = () => setupFullscreen({ message: value => messages.push(value), changed: () => calls.push('resize') });
  return { messages, calls, events, buttons, root, doc, init };
}

test('fullscreen is requested during the click gesture, toggles all buttons, and unlocks on exit', async () => {
  const f = fixture();
  f.root.requestFullscreen = function (options) { assert.equal(this, f.root); assert.equal(options.navigationUI, 'hide'); f.calls.push('request'); f.doc.fullscreenElement = f.root; return Promise.resolve(); };
  f.doc.exitFullscreen = async function () { assert.equal(this, f.doc); f.doc.fullscreenElement = null; };
  f.init();
  const clicked = f.buttons[0].click();
  assert.ok(f.calls.includes('request'));
  await clicked;
  assert.ok(f.calls.includes('landscape'));
  assert.ok(f.buttons.every(b => b.attrs['aria-pressed'] === 'true' && b.title === '退出全屏'));
  await f.buttons[1].click();
  assert.ok(f.buttons.every(b => b.attrs['aria-pressed'] === 'false'));
  assert.ok(f.calls.includes('unlock'));
  assert.deepEqual(f.messages, []);
});

test('unsupported browsers get a clear fallback without breaking input', async () => {
  const f = fixture(); f.init(); await f.buttons[0].click();
  assert.match(f.messages[0], /不支持网页全屏/);
  assert.equal(f.buttons[0].attrs['aria-pressed'], 'false');
});

test('a rejected fullscreen request is handled without an unhandled rejection', async () => {
  const f = fixture(); f.root.requestFullscreen = () => Promise.reject(new Error('Denied')); f.init();
  await f.buttons[0].click(); assert.match(f.messages[0], /未允许全屏/);
  assert.equal(f.buttons[0].attrs['aria-pressed'], 'false');
});

test('prefixed fullscreen works and browser exit events refresh every control', async () => {
  const f = fixture();
  f.root.webkitRequestFullscreen = () => { f.doc.webkitFullscreenElement = f.root; };
  f.doc.webkitExitFullscreen = () => { f.doc.webkitFullscreenElement = null; };
  f.init(); await f.buttons[0].click(); assert.equal(f.buttons[0].attrs['aria-pressed'], 'true');
  await f.buttons[0].click(); assert.equal(f.buttons[0].attrs['aria-pressed'], 'false');
  f.doc.webkitFullscreenElement = f.root; f.events.get('webkitfullscreenchange')();
  assert.ok(f.buttons.every(b => b.attrs['aria-pressed'] === 'true'));
});
