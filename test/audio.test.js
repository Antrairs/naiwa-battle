import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ArenaAudio } from '../audio.js';

const saved = { window: globalThis.window, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
class Node {
  constructor() { this.gain = this.threshold = this.ratio = { value: 0, setTargetAtTime(value) { this.value = value; } }; }
  connect() {}
  disconnect() {}
}
class Context extends EventTarget {
  constructor() { super(); this.currentTime = 0; this.sampleRate = 100; this.state = 'suspended'; this.mediaNodes = []; }
  createGain() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createBuffer() { return { getChannelData: () => new Float32Array(100) }; }
  createMediaElementSource(element) { const node = new Node(); node.mediaElement = element; this.mediaNodes.push(node); return node; }
  async resume() { this.state = 'running'; this.dispatchEvent(new Event('statechange')); }
}
class Media extends EventTarget {
  constructor() { super(); this.paused = true; this.currentTime = 0; this.readyState = 3; this.playCalls = 0; this.loadCalls = 0; }
  setAttribute() {}
  async play() { this.playCalls++; this.paused = false; }
  pause() { this.paused = true; }
  load() { this.loadCalls++; this.error = null; }
}
beforeEach(() => {
  globalThis.window = { AudioContext: Context, Audio: Media };
  const storage = new Map(); globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  globalThis.fetch = () => { throw new Error('Music must stream instead of fetching and decoding a whole file'); };
});
afterEach(() => Object.assign(globalThis, saved));
const settle = async audio => { await audio.musicPlayPending; };
const ready = async () => { const audio = new ArenaAudio(); audio.setPaused(false); await audio.enable(); await settle(audio); return audio; };

test('music streams through one media element, remains separate from combat voices, and gestures do not stack it', async () => {
  const audio = await ready(), music = audio.musicElement;
  assert.equal(music.loop, true); assert.equal(music.preload, 'auto');
  assert.equal(music.src, '/assets/audio/nai-dou-luo-battle.m4a');
  assert.equal(audio.musicPlaying, true);
  await audio.enable(); await audio.enable();
  assert.equal(audio.musicElement, music); assert.equal(music.playCalls, 1);
  assert.equal(audio.context.mediaNodes.length, 1); assert.equal(audio.voices, 0);
});
test('pause, backgrounding and mute preserve position and resume the same media element', async () => {
  const audio = await ready(), music = audio.musicElement;
  music.currentTime = 8; audio.setPaused(true);
  assert.equal(music.currentTime, 8); assert.equal(music.paused, true); assert.equal(audio.musicGain.gain.value, 0);
  audio.setPaused(false); await settle(audio);
  assert.equal(music.paused, false); assert.equal(music.currentTime, 8);
  music.currentTime = 13; audio.setHidden(true); assert.equal(music.paused, true);
  audio.setHidden(false); await settle(audio); assert.equal(music.paused, false);
  music.currentTime = 16; audio.mute(); assert.equal(music.paused, true);
  await audio.enable(); await settle(audio);
  assert.equal(audio.musicElement, music); assert.equal(music.currentTime, 16); assert.equal(audio.musicPlaying, true);
});
test('a slow media start cannot become audible after muting', async () => {
  let finish;
  window.Audio = class extends Media { play() { this.playCalls++; this.paused = false; return new Promise(resolve => { finish = resolve; }); } };
  const audio = new ArenaAudio(); audio.setPaused(false); await audio.enable();
  const pending = audio.musicPlayPending; audio.mute();
  assert.equal(audio.musicGain.gain.value, 0);
  finish(); await pending;
  assert.equal(audio.musicElement.paused, true); assert.equal(audio.musicPlaying, false);
  await audio.enable(); finish(); await settle(audio);
  assert.equal(audio.musicPlaying, true);
});
test('zero music volume stops only the music and volume choices persist', async () => {
  const audio = await ready(); audio.setMusicVolume(0);
  assert.equal(audio.musicElement.paused, true); assert.equal(audio.ready, true);
  audio.setMusicVolume(0.4); await settle(audio); assert.equal(audio.musicPlaying, true);
  audio.setVolume(0); assert.equal(audio.musicPlaying, false);
  audio.setVolume(0.6); await settle(audio); assert.equal(audio.musicPlaying, true);
  const restored = new ArenaAudio(); assert.equal(restored.musicVolume, 0.4); assert.equal(restored.volume, 0.6);
});
test('music failure leaves combat audio usable and does not retry on every gesture', async () => {
  window.Audio = class extends Media { async play() { this.playCalls++; throw new Error('offline'); } };
  const audio = await ready(); await audio.enable();
  assert.equal(audio.musicElement.playCalls, 1); assert.equal(audio.ready, true); assert.equal(audio.musicError, 'offline');
});

test('a browser autoplay rejection can be retried immediately by the next gesture', async () => {
  let allowed = false;
  window.Audio = class extends Media {
    async play() { this.playCalls++; if (!allowed) throw new DOMException('Gesture required', 'NotAllowedError'); this.paused = false; }
  };
  const audio = await ready();
  assert.equal(audio.musicNeedsGesture, true); assert.equal(audio.musicPlaying, false);
  audio.syncGain(); audio.syncMusic(); assert.equal(audio.musicElement.playCalls, 1);
  allowed = true; await audio.enable(); await settle(audio);
  assert.equal(audio.musicPlaying, true); assert.equal(audio.musicNeedsGesture, false); assert.equal(audio.musicError, null);
});

test('play is called synchronously within the gesture before context resume resolves', async () => {
  let resume;
  window.AudioContext = class extends Context { resume() { return new Promise(resolve => { resume = () => { this.state = 'running'; resolve(); }; }); } };
  const audio = new ArenaAudio(); audio.setPaused(false);
  const enabled = audio.enable();
  assert.equal(audio.musicElement.playCalls, 1);
  resume(); await enabled; await settle(audio);
  assert.equal(audio.musicPlaying, true);
});

test('the first gesture can unlock music silently in settings and then resume without another gesture', async () => {
  const audio = new ArenaAudio(); await audio.enable(); await settle(audio);
  assert.equal(audio.musicUnlocked, true); assert.equal(audio.musicElement.paused, true); assert.equal(audio.musicGain.gain.value, 0);
  audio.setPaused(false); await settle(audio);
  assert.equal(audio.musicPlaying, true);
});

test('an interrupted mobile context pauses music and can be resumed on return', async () => {
  const audio = await ready(), music = audio.musicElement;
  music.currentTime = 12; audio.context.state = 'interrupted'; audio.context.dispatchEvent(new Event('statechange'));
  assert.equal(audio.musicPlaying, false); assert.equal(music.paused, true);
  audio.setHidden(false); await settle(audio);
  assert.equal(audio.musicPlaying, true); assert.equal(music.currentTime, 12);
});

test('a failed media request reloads only after its retry interval', async () => {
  const audio = await ready(), music = audio.musicElement;
  music.pause(); music.error = { code: 2 }; music.dispatchEvent(new Event('error'));
  await audio.enable(); assert.equal(music.loadCalls, 0);
  audio.musicRetryAt = 0; await audio.enable(); await settle(audio);
  assert.equal(music.loadCalls, 1); assert.equal(audio.musicPlaying, true);
});

test('a rapid pause and resume retries a play request interrupted by pause', async () => {
  const audio = await ready(), music = audio.musicElement;
  audio.setPaused(true);
  let abort;
  music.play = () => { music.playCalls++; music.paused = false; return new Promise((_resolve, reject) => { abort = reject; }); };
  audio.setPaused(false);
  const pending = audio.musicPlayPending;
  audio.setPaused(true); audio.setPaused(false);
  music.play = Media.prototype.play;
  abort(new DOMException('Paused before play resolved', 'AbortError'));
  await pending; await settle(audio);
  assert.equal(audio.musicPlaying, true); assert.equal(audio.musicError, null);
});
