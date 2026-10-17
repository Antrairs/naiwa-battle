export class ArenaAudio {
  constructor() {
    this.enabled = true; this.volume = 0.45; this.musicVolume = 0.28; this.context = null; this.hidden = false; this.paused = true; this.last = {}; this.voices = 0;
    this.musicElement = null; this.musicNode = null; this.musicPlayPending = null; this.musicUnlocked = false; this.musicResumeQueued = false;
    this.musicNeedsGesture = false; this.musicRetryAt = 0; this.musicError = null;
    try { this.enabled = localStorage.getItem('arena-muted') !== '1'; this.volume = Number(localStorage.getItem('arena-volume') ?? 0.45); this.musicVolume = Number(localStorage.getItem('arena-music-volume') ?? 0.28); } catch {}
    this.volume = Math.max(0, Math.min(1, this.volume));
    this.musicVolume = Math.max(0, Math.min(1, this.musicVolume));
  }
  async enable() {
    this.enabled = true;
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.context.createGain();
      this.musicGain = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -15; limiter.ratio.value = 5;
      this.master.connect(limiter); limiter.connect(this.context.destination);
      this.musicGain.connect(limiter);
      this.noiseBuffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.context.addEventListener('statechange', () => this.syncGain());
      const music = new window.Audio();
      music.preload = 'auto'; music.loop = true;
      music.setAttribute('playsinline', ''); music.setAttribute('webkit-playsinline', '');
      this.musicNode = this.context.createMediaElementSource(music); this.musicNode.connect(this.musicGain);
      music.addEventListener('error', () => this.musicFailed(new Error(`Music media error ${music.error?.code || 'unknown'}`)));
      music.src = '/assets/audio/nai-dou-luo-battle.m4a'; this.musicElement = music;
    }
    this.syncGain();
    const resumed = this.context.resume();
    // Start the media element inside the gesture, before waiting for AudioContext.resume().
    if (this.musicActive || !this.musicUnlocked) this.startMusic(true);
    this.save(); await resumed; this.syncGain();
  }
  get musicActive() { return this.enabled && !this.hidden && !this.paused && this.volume > 0 && this.musicVolume > 0 && this.context?.state === 'running'; }
  get musicPlaying() { return this.musicActive && !!this.musicElement && !this.musicElement.paused && this.musicElement.readyState >= 2; }
  musicFailed(error) {
    if (error.name === 'AbortError') return;
    this.musicError = String(error.message || error);
    this.musicNeedsGesture = error.name === 'NotAllowedError';
    if (!this.musicNeedsGesture) this.musicRetryAt = Date.now() + 10000;
  }
  startMusic(gesture = false) {
    const music = this.musicElement;
    if (!music) return;
    if (this.musicPlayPending) { if (this.musicActive && music.paused) this.musicResumeQueued = true; return; }
    if ((!music.paused && !music.ended) || Date.now() < this.musicRetryAt || (this.musicNeedsGesture && !gesture)) return;
    if (music.error) music.load();
    try {
      const pending = Promise.resolve(music.play()).then(() => {
        this.musicUnlocked = true; this.musicNeedsGesture = false; this.musicError = null;
      }, error => this.musicFailed(error)).finally(() => {
        if (this.musicPlayPending === pending) this.musicPlayPending = null;
        const resumeQueued = this.musicResumeQueued; this.musicResumeQueued = false;
        if (!this.musicActive) music.pause();
        else if (resumeQueued) this.startMusic();
      });
      this.musicPlayPending = pending;
    } catch (error) { this.musicFailed(error); }
  }
  syncMusic() {
    if (this.musicActive) this.startMusic();
    else if (this.musicElement && (!this.musicPlayPending || this.musicUnlocked)) {
      // The first gesture can prime playback silently while the match is paused.
      this.musicElement.pause();
    }
  }
  save() { try { localStorage.setItem('arena-muted', this.enabled ? '0' : '1'); localStorage.setItem('arena-volume', String(this.volume)); localStorage.setItem('arena-music-volume', String(this.musicVolume)); } catch {} }
  syncGain() {
    if (this.master) {
      const gain = this.enabled && !this.hidden ? this.volume : 0;
      this.master.gain.setTargetAtTime(gain, this.context.currentTime, 0.015);
      this.musicGain.gain.setTargetAtTime(this.musicActive ? gain * this.musicVolume : 0, this.context.currentTime, 0.03);
    }
    this.syncMusic();
  }
  mute() { this.enabled = false; this.syncGain(); this.save(); }
  setVolume(volume) { this.volume = Math.max(0, Math.min(1, volume)); this.syncGain(); this.save(); }
  setMusicVolume(volume) { this.musicVolume = Math.max(0, Math.min(1, volume)); this.syncGain(); this.save(); }
  setHidden(hidden) {
    this.hidden = hidden; this.syncGain();
    if (!hidden && this.enabled && this.context) this.context.resume().then(() => this.syncGain()).catch(() => {});
  }
  setPaused(paused) { if (this.paused !== paused) { this.paused = paused; this.syncGain(); } }
  get ready() { return this.enabled && !this.hidden && this.context?.state === 'running' && this.voices < 36; }
  tone(frequency, length, type = 'sine', volume = 0.1, end = frequency, delay = 0) {
    if (!this.ready) return;
    const ctx = this.context, osc = ctx.createOscillator(), gain = ctx.createGain(), at = ctx.currentTime + delay;
    osc.type = type; osc.frequency.setValueAtTime(frequency, at); osc.frequency.exponentialRampToValueAtTime(Math.max(end, 15), at + length);
    gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), at + 0.004); gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain); gain.connect(this.master); this.voices++;
    osc.onended = () => { osc.disconnect(); gain.disconnect(); this.voices--; }; osc.start(at); osc.stop(at + length);
  }
  noise(length = 0.2, volume = 0.15, frequency = 1000, high = false) {
    if (!this.ready) return;
    const ctx = this.context, source = ctx.createBufferSource(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    source.buffer = this.noiseBuffer; filter.type = high ? 'highpass' : 'lowpass'; filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + length);
    source.connect(filter); filter.connect(gain); gain.connect(this.master); this.voices++;
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); this.voices--; };
    source.start(); source.stop(ctx.currentTime + length);
  }
  play(event, listener) {
    if (!this.ready) return;
    const distant = listener && Number.isFinite(event.x) ? Math.min(1, 10 / Math.max(10, Math.hypot(event.x - listener.x, event.z - listener.z))) : 1;
    const now = this.context.currentTime, key = event.type === 'shot' ? `shot-${event.skill}` : event.type;
    if (now - (this.last[key] ?? -1) < (event.type === 'impact' ? 0.045 : 0.025)) return;
    this.last[key] = now;
    if (event.type === 'shot') {
      if (event.skill === 0) { this.noise(0.065, 0.1, 1900, true); this.tone(205, 0.085, 'triangle', 0.13, 65); }
      if (event.skill === 1) { this.noise(0.19, 0.23, 1700); this.tone(125, 0.19, 'triangle', 0.22, 35); this.tone(590, 0.05, 'square', 0.025, 140); }
      if (event.skill === 3) { this.tone(175, 0.25, 'sine', 0.24, 42); this.noise(0.12, 0.12, 550); }
    }
    if (event.type === 'impact') { this.noise(0.045, 0.07 * distant, 2300, true); if (event.hit) this.tone(920, 0.055, 'sine', 0.055 * distant, 540); }
    if (event.type === 'blast') { this.noise(0.42, 0.32 * distant, 850); this.tone(92, 0.4, 'sine', 0.32 * distant, 26); this.noise(0.13, 0.16 * distant, 2200, true); }
    if (event.type === 'dash') { this.noise(0.18, 0.1, 2400, true); this.tone(260, 0.17, 'sine', 0.09, 800); }
    if (event.type === 'damage' && event.player === listener?.id) this.tone(185, 0.09, 'triangle', 0.12, 65);
    if (event.type === 'down') this.tone(290, 0.32, 'triangle', 0.09, 55);
    if (event.type === 'pickup') [660, 880, 1100].forEach((n, i) => this.tone(n, 0.18, 'sine', 0.11, n, i * 0.09));
    if (event.type === 'start') [440, 660, 880].forEach((n, i) => this.tone(n, 0.17, 'triangle', 0.1, n, i * 0.12));
    if (event.type === 'finish') [392, 494, 587, 784].forEach((n, i) => this.tone(n, 0.28, 'triangle', 0.12, n, i * 0.15));
  }
}
