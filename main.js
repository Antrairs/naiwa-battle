import { ArenaView } from './view.js';
import { ArenaAudio } from './audio.js?v=20261017-stream';
import { ARENA, BOUNDS, SKILLS, BUFFS, WALLS } from './shared/config.js';
import { Motion } from './shared/motion.js';
import { setupFullscreen } from './fullscreen.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const icons = () => window.lucide?.createIcons({ attrs: { 'stroke-width': 1.9 } });
const teamName = team => team === 'blue' ? '蓝莓队' : '红柚队';
const formatTime = n => { const seconds = Math.ceil(Math.max(0, n)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
const audio = new ArenaAudio();
const motion = new Motion();
const qaMode = new URLSearchParams(location.search).has('qa');
let view;
try { view = new ArenaView($('#arena')); } catch (error) { $('#fatal').classList.remove('hidden'); $('#fatal-message').textContent = '浏览器未能创建 3D 场景。请使用支持 WebGL 的新版 Chrome、Edge 或 Safari。'; throw error; }
icons();
view.quality('standard');
$$('[data-quality]').forEach(button => button.classList.toggle('selected', button.dataset.quality === 'standard'));

let nickname = '球球';
try { nickname = localStorage.getItem('bombo-name') || nickname; } catch {}
$('#nickname').value = nickname;
const input = { keys: new Set(), stick: { x: 0, z: 0 }, aim: { x: 0, z: 0 }, pointer: { x: 0, y: 0 }, hasPointer: false, skill: 0, activeTouch: null, fire: null, guide: false };
const pendingSkills = new Set(), pendingEvents = [], readyAt = {};
const state = { snapshot: null, localId: '', room: null, lastEvent: 0, lastRound: 0, lastSnapshot: 0, resultShown: false, connected: false, modalPause: false, screen: 'home', loading: true, busy: false };
state.latency = 0;
let toastTimer, sendTimer = 0, hudTimer = 0, frameCount = 0, stickPointer = null;
const loaded = new Set();
let loadingError = '';
function updateEntry() {
  const count = loaded.size + Number(state.connected);
  const ready = count === 4 && !loadingError;
  state.loading = !ready;
  $('#entry-screen').setAttribute('aria-busy', String(!ready));
  $('#loading-progress').value = count;
  $('#loading-percent').textContent = `${Math.round(count / 4 * 100)}%`;
  $('#loading-message').textContent = loadingError || (count === 3 && !state.connected ? '正在连接竞技场…' : '正在装配竞技场…');
  $('#loading-retry').classList.toggle('hidden', !loadingError);
  $('#entry-loading').classList.toggle('hidden', ready || state.screen !== 'home');
  $('#mode-picker').classList.toggle('hidden', !ready || state.screen !== 'home');
}
function entryLoaded(name) { loaded.add(name); updateEntry(); }
function entryFailed(error) { loadingError = error.message || '加载未完成，请重试'; updateEntry(); }
view.ready.then(() => entryLoaded('scene')).catch(entryFailed);
const art = $('#entry-art');
const checkArt = () => art.decode().then(() => entryLoaded('art')).catch(() => entryFailed(new Error('入场画面加载失败，请重新加载')));
if (art.complete) checkArt(); else { art.addEventListener('load', checkArt, { once: true }); art.addEventListener('error', () => entryFailed(new Error('入场画面加载失败，请重新加载')), { once: true }); }
document.fonts.ready.then(() => entryLoaded('interface'));
$('#loading-retry').addEventListener('click', () => location.reload());

function enterBattle() {
  state.screen = 'battle';
  if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
  document.body.classList.remove('at-home'); $('#entry-screen').classList.add('hidden');
  syncOrientation();
}
async function returnHome() {
  if (state.busy) return;
  state.busy = true; state.screen = 'home';
  clearMatch(); state.room = null;
  $$('.modal').forEach(el => el.classList.add('hidden'));
  document.body.classList.add('at-home'); $('#entry-screen').classList.remove('hidden');
  updateEntry(); syncOrientation();
  if (state.connected) {
    const response = await request('leave');
    if (!response.ok) { socket.disconnect(); socket.connect(); }
  }
  state.busy = false;
}
$('#home-button').addEventListener('click', returnHome);
$('#mode-training').addEventListener('click', newTraining);
$('#mode-friends').addEventListener('click', openFriends);

function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), Math.min(6500, Math.max(2300, message.length * 75))); }
function feed(message, tone = '') { const item = document.createElement('div'); item.className = `feed-item ${tone}`; item.textContent = message; $('#feed').prepend(item); while ($('#feed').children.length > 3) $('#feed').lastElementChild.remove(); setTimeout(() => item.remove(), 6000); }
function local() { return state.snapshot?.players.find(p => p.id === state.localId); }
function anyModal() { return state.screen !== 'battle' || document.body.classList.contains('rotate-required') || ['room-modal','settings-modal','result-modal'].some(id => !$('#' + id).classList.contains('hidden')); }
function resetInput() {
  const pointers = [input.activeTouch?.pointer, input.fire?.pointer, stickPointer].filter(id => id != null);
  input.keys.clear(); input.stick = { x: 0, z: 0 }; input.activeTouch = null; input.fire = null; stickPointer = null; input.guide = false; input.hasPointer = false;
  for (const element of $$('.skill, #joystick, #arena')) for (const id of pointers) if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
  $$('.skill').forEach(b => { b.classList.remove('aiming'); b.style.removeProperty('--drag-x'); b.style.removeProperty('--drag-y'); });
  $('#drag-feedback').classList.add('hidden'); $('.joystick-knob').style.transform = ''; sendInput();
}
function clearMatch() { resetInput(); audio.setPaused(true); pendingSkills.clear(); pendingEvents.length = 0; for (const key of Object.keys(readyAt)) delete readyAt[key]; view.reset(); motion.reset(); state.snapshot = null; state.lastEvent = 0; state.lastRound = 0; state.resultShown = false; $('#feed').replaceChildren(); $('#result-modal').classList.add('hidden'); }
function request(event, data = {}) { return new Promise(resolve => socket.timeout(7000).emit(event, data, (error, response) => resolve(error ? { ok: false, error: '连接超时，请重试' } : response || { ok: true }))); }

const socket = window.io({ reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 2000 });
$('#connection').classList.remove('hidden');
socket.on('connect', async () => {
  state.connected = true; state.localId = socket.id;
  $('#connection').classList.add('hidden');
  updateEntry(); measureLatency();
  if (state.reconnecting) {
    state.reconnecting = false;
    await returnHome(); toast('连接已恢复，请重新选择模式');
  } else if (qaMode && new URLSearchParams(location.search).get('qa') !== 'entry') await newTraining();
});
socket.on('connect_error', () => { updateEntry(); $('#connection').classList.remove('hidden'); $('#connection>span:nth-child(2)').textContent = '竞技场连接中，请稍候…'; $('#retry').classList.remove('hidden'); });
socket.on('disconnect', () => { state.connected = false; state.reconnecting = true; updateEntry(); audio.setPaused(true); $('#connection').classList.remove('hidden'); $('#connection>span:nth-child(2)').textContent = '连接已断开，正在重连…'; resetInput(); });
$('#retry').addEventListener('click', () => { socket.connect(); $('#retry').classList.add('hidden'); });
socket.on('room', room => {
  if (state.room?.code !== room.code) pendingEvents.length = 0;
  state.room = room; updateLobby();
});
socket.on('events', packet => {
  if (packet.room === state.room?.code) pendingEvents.push(...packet.events);
});
socket.on('snapshot', snapshot => {
  if (state.screen === 'home' || snapshot.room !== state.room?.code) return;
  snapshot.events = pendingEvents.splice(0);
  if (state.screen === 'friends' && !snapshot.training) enterBattle();
  const roundChanged = snapshot.round !== state.lastRound;
  if (roundChanged) {
    resetInput(); for (const key of Object.keys(readyAt)) delete readyAt[key];
    view.reset(); state.lastRound = snapshot.round; state.resultShown = false;
    $('#result-modal').classList.add('hidden'); $('#feed').replaceChildren();
    $('#rematch').disabled = false; $('#rematch span').textContent = '再来一局';
  }
  state.snapshot = snapshot; state.lastSnapshot = performance.now();
  audio.setPaused(snapshot.paused || !['countdown', 'playing'].includes(snapshot.state));
  if (snapshot.players.find(p => p.id === state.localId)?.hp <= 0 && (input.fire || input.activeTouch)) resetInput();
  if (snapshot.events.some(event => event.id > state.lastEvent && event.type === 'dash' && event.player === state.localId)) motion.snapLocal = true;
  motion.push(snapshot, state.lastSnapshot, state.localId, state.latency);
  if (state.room && !state.room.training && snapshot.state !== 'result') $('#room-modal').classList.add('hidden');
  for (const event of snapshot.events) {
    if (event.id <= state.lastEvent) continue;
    state.lastEvent = event.id;
    if (event.type === 'round') continue;
    view.onEvent(event, snapshot, state.localId);
    audio.play(event, local());
    handleEvent(event, snapshot);
  }
  if (snapshot.state === 'result' && !state.resultShown) showResult();
});

function handleEvent(event, snapshot) {
  const p = snapshot.players.find(p => p.id === event.player), owner = snapshot.players.find(p => p.id === event.owner);
  if (event.type === 'start') feed('战斗开始 · 团灭对方即可获胜');
  if (event.type === 'lootSpawn') feed('中央广场 · 强化武器已出现', 'gold');
  if (event.type === 'pickup' && p) feed(`${p.name} 拾取了${BUFFS[event.buff].name}`, 'gold');
  if (event.type === 'down' && p) feed(`${owner?.name || '榴弹'} 击倒 ${p.name}`, p.team === local()?.team ? 'red' : 'gold');
  if (event.type === 'disconnect' && p) feed(`${p.name} 由训练伙伴接管`);
  if (event.type === 'damage' && event.player === state.localId) { $('#flash').style.opacity = '0.65'; setTimeout(() => $('#flash').style.opacity = '0', 130); }
}

function moveDirection() {
  let x = Number(input.keys.has('d') || input.keys.has('arrowright')) - Number(input.keys.has('a') || input.keys.has('arrowleft')) + input.stick.x;
  let z = Number(input.keys.has('s') || input.keys.has('arrowdown')) - Number(input.keys.has('w') || input.keys.has('arrowup')) + input.stick.z;
  const len = Math.max(1, Math.hypot(x, z)); return { x: x / len, z: z / len };
}
function sendInput() {
  if (!state.connected) return;
  const movement = anyModal() ? { x: 0, z: 0 } : moveDirection();
  socket.volatile.emit('input', { ...movement, aim: input.aim });
}
async function measureLatency() {
  const start = performance.now();
  const response = await request('latency');
  if (response.ok) state.latency = Math.min(0.15, (performance.now() - start) / 2000);
}
setInterval(() => { if (state.connected && !document.hidden) measureLatency(); }, 10000);
function syncOrientation() {
  const required = state.screen === 'battle' && matchMedia('(pointer:coarse)').matches && innerHeight > innerWidth;
  const changed = document.body.classList.contains('rotate-required') !== required;
  document.body.classList.toggle('rotate-required', required);
  $('#rotate-prompt').hidden = !required;
  if (changed) resetInput();
  if (state.room?.training && (changed || required)) pauseTraining(required || ['room-modal','settings-modal'].some(id => !$('#' + id).classList.contains('hidden')));
}
window.addEventListener('resize', syncOrientation);
syncOrientation();
setupFullscreen({ message: toast, changed: () => { resetInput(); view.resize(); syncOrientation(); } });
document.addEventListener('pointerdown', () => {
  if (matchMedia('(pointer:coarse)').matches && innerWidth > innerHeight && document.fullscreenElement) screen.orientation?.lock?.('landscape').catch(() => {});
}, { passive: true });
function facingTarget(skill = input.skill) {
  const p = local();
  if (!p) return { x: 0, z: 0 };
  const position = motion.position || p, movement = moveDirection();
  const facing = Math.hypot(movement.x, movement.z) > 0.1 ? movement : motion.facing || p.facing;
  const length = Math.max(0.001, Math.hypot(facing.x, facing.z));
  return { x: position.x + facing.x / length * SKILLS[skill].range, z: position.z + facing.z / length * SKILLS[skill].range };
}
async function cast(skill, explicitTarget = null, quiet = false) {
  if (anyModal() || !state.connected || state.snapshot?.state !== 'playing' || state.snapshot.paused) return false;
  const p = local();
  if (!p || p.hp <= 0 || pendingSkills.has(skill)) return false;
  const now = performance.now(), remaining = Math.max(p.cd[skill] - (now - state.lastSnapshot) / 1000, ((readyAt[skill] || 0) - now) / 1000);
  if (remaining > 0) { if (!quiet && skill !== 0) toast(`${SKILLS[skill].name} · 还需 ${remaining.toFixed(1)} 秒`); return false; }
  input.skill = skill;
  const target = explicitTarget || (input.hasPointer && !matchMedia('(pointer:coarse)').matches ? { ...input.aim } : facingTarget(skill));
  if (skill === 3) { target.x = Math.max(-BOUNDS.x, Math.min(BOUNDS.x, target.x)); target.z = Math.max(-BOUNDS.z, Math.min(BOUNDS.z, target.z)); }
  input.aim = target;
  sendInput();
  pendingSkills.add(skill); readyAt[skill] = now + SKILLS[skill].cooldown * 1000 + 20;
  if (skill === 0 && input.fire) input.fire.attempted = true;
  const round = state.lastRound;
  const response = await request('skill', { skill, target });
  pendingSkills.delete(skill);
  if (state.lastRound !== round) return false;
  if (!response.ok) { readyAt[skill] = performance.now() + 65; if (!quiet) toast(response.error); }
  return response.ok;
}

window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement) return;
  const key = event.key.toLowerCase();
  if (state.screen !== 'battle') { if (key === 'escape' && state.screen === 'friends') closeModal('room-modal'); return; }
  if (['w','a','s','d','arrowleft','arrowright','arrowup','arrowdown',' '].includes(key)) event.preventDefault();
  if (key === 'escape') { if (!$('#room-modal').classList.contains('hidden')) closeModal('room-modal'); else if (!$('#settings-modal').classList.contains('hidden')) closeModal('settings-modal'); else if ($('#result-modal').classList.contains('hidden')) openSettings(); return; }
  input.keys.add(key);
  sendInput();
  if (['1','2','3'].includes(key) && !event.repeat) cast(Number(key));
  if (key === 'f' && !event.repeat) input.fire = { source: 'keyboard', started: performance.now() - 150 };
  if (key === ' ' && !event.repeat) cast(2);
});
window.addEventListener('keyup', event => { input.keys.delete(event.key.toLowerCase()); if (event.key.toLowerCase() === 'f' && input.fire?.source === 'keyboard') input.fire = null; sendInput(); });
window.addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); audio.setHidden(document.hidden); });
$('#arena').addEventListener('contextmenu', event => event.preventDefault());
$('#arena').addEventListener('pointermove', event => {
  input.pointer = { x: event.clientX, y: event.clientY }; input.hasPointer = true; input.guide = true;
  input.aim = view.screenPoint(event.clientX, event.clientY);
});
$('#arena').addEventListener('pointerdown', event => {
  if (anyModal()) return;
  input.hasPointer = true; input.guide = true; input.pointer = { x: event.clientX, y: event.clientY };
  input.aim = view.screenPoint(event.clientX, event.clientY);
  if (event.pointerType === 'mouse') {
    if (event.button === 2) cast(3);
    else if (event.button === 0) { input.skill = 0; input.fire = { source: 'canvas', pointer: event.pointerId, started: performance.now() - 150 }; $('#arena').setPointerCapture(event.pointerId); cast(0, input.aim, true); }
  }
});
for (const type of ['pointerup','pointercancel','lostpointercapture']) $('#arena').addEventListener(type, event => { if (input.fire?.source === 'canvas' && input.fire.pointer === event.pointerId) input.fire = null; });

for (const button of $$('.skill')) {
  const skill = Number(button.dataset.skill);
  button.addEventListener('pointerenter', () => { if (!input.activeTouch) input.skill = skill; });
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (anyModal() || input.activeTouch || local()?.hp <= 0) return;
    input.activeTouch = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, skill, moved: false };
    input.skill = skill; button.setPointerCapture(event.pointerId); button.classList.add('aiming');
    input.hasPointer = false; input.aim = facingTarget(skill); input.guide = true;
    if (skill === 0) input.fire = { source: 'button', started: performance.now(), attempted: false };
  });
  button.addEventListener('pointermove', event => {
    const touch = input.activeTouch;
    if (!touch || touch.pointer !== event.pointerId) return;
    const dx = event.clientX - touch.startX, dy = event.clientY - touch.startY;
    if (touch.moved || Math.hypot(dx, dy) > 5) {
      touch.moved = true;
      const p = local(); if (!p) return;
      touch.dx = dx; touch.dy = dy;
      updateDragAim(touch);
      const length = Math.max(1, Math.hypot(dx, dy) / 25);
      button.style.setProperty('--drag-x', `${dx / length}px`); button.style.setProperty('--drag-y', `${dy / length}px`);
      const feedback = $('#drag-feedback'); feedback.classList.remove('hidden');
      feedback.style.left = `${event.clientX}px`; feedback.style.top = `${event.clientY}px`;
    }
  });
  button.addEventListener('pointerup', event => {
    const touch = input.activeTouch;
    if (!touch || touch.pointer !== event.pointerId) return;
    if (touch.moved) updateDragAim(touch);
    const target = touch.moved ? { ...input.aim } : facingTarget(skill);
    const attempted = input.fire?.attempted; input.fire = null; input.activeTouch = null;
    button.classList.remove('aiming'); button.style.removeProperty('--drag-x'); button.style.removeProperty('--drag-y'); $('#drag-feedback').classList.add('hidden');
    if (skill !== 0 || !attempted) cast(skill, target);
    input.guide = false;
  });
  for (const type of ['pointercancel', 'lostpointercapture']) button.addEventListener(type, event => {
    if (input.activeTouch?.pointer !== event.pointerId) return;
    resetInput();
  });
}
function updateDragAim(touch) {
  const p = motion.position || local(); if (!p) return;
  const dx = touch.dx || 0, dz = (touch.dy || 0) / view.groundProjection;
  const range = touch.skill === 3 ? Math.min(SKILLS[3].range, Math.hypot(touch.dx || 0, touch.dy || 0) / 7) : SKILLS[touch.skill].range;
  const scale = range / Math.max(0.001, Math.hypot(dx, dz));
  input.aim = { x: p.x + dx * scale, z: p.z + dz * scale };
}
const stick = $('#joystick'), knob = $('.joystick-knob');
function stickMove(event) {
  const rect = stick.getBoundingClientRect();
  let x = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2 - 10);
  let z = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2 - 10);
  const len = Math.max(1, Math.hypot(x, z)); x /= len; z /= len;
  input.stick = { x, z }; knob.style.transform = `translate(${x * 25}px,${z * 25}px)`;
  sendInput();
}
stick.addEventListener('pointerdown', event => { stickPointer = event.pointerId; stick.setPointerCapture(event.pointerId); stickMove(event); });
stick.addEventListener('pointermove', event => { if (stickPointer === event.pointerId) stickMove(event); });
for (const type of ['pointerup','pointercancel','lostpointercapture']) stick.addEventListener(type, () => { stickPointer = null; input.stick = { x: 0, z: 0 }; knob.style.transform = ''; sendInput(); });

async function pauseTraining(paused) { if (state.room?.training) await request('pause', { paused }); }
async function openSettings() {
  if (state.screen !== 'battle') return;
  resetInput(); await pauseTraining(true);
  $('#settings-title').textContent = state.room?.training ? '稍作休息' : '对局进行中';
  $('#settings-modal').classList.remove('hidden');
}
async function closeModal(id) {
  if (id === 'room-modal' && (state.screen === 'friends' || (!state.room?.training && !state.snapshot))) return returnHome();
  $('#' + id).classList.add('hidden'); resetInput(); if (!anyModal()) await pauseTraining(false);
}
$('#pause-button').addEventListener('click', openSettings);
$('#resume-button').addEventListener('click', () => closeModal('settings-modal'));
$$('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
async function openFriends() {
  if (!state.connected || state.busy || (state.screen === 'home' && state.loading)) return;
  if (state.screen === 'home') { state.screen = 'friends'; updateEntry(); }
  resetInput(); await pauseTraining(true); $('#room-error').textContent = '';
  $('#room-modal').classList.remove('hidden'); updateLobby(); loadLan();
  if (!matchMedia('(pointer:coarse)').matches) $('#nickname').focus({ preventScroll: true });
}
$('#network-button').addEventListener('click', openFriends);
function updateSoundButton() {
  const button = $('#sound-button');
  button.innerHTML = `<i data-lucide="${audio.enabled ? 'volume-2' : 'volume-x'}"></i>`;
  button.title = audio.enabled ? '关闭声音' : '开启声音'; button.setAttribute('aria-label', button.title); button.setAttribute('aria-pressed', String(audio.enabled)); icons();
}
updateSoundButton(); $('#volume').value = audio.volume * 100;
$('#music-volume').value = audio.musicVolume * 100;
const unlockAudio = () => { if (audio.enabled) audio.enable().catch(() => {}); };
for (const event of ['pointerdown', 'pointerup', 'touchend', 'click']) document.addEventListener(event, unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio);
$('#sound-button').addEventListener('click', async () => {
  if (!audio.enabled) await audio.enable(); else audio.mute();
  updateSoundButton(); if (audio.enabled) audio.tone(660, 0.13, 'sine', 0.08);
});
$('#volume').addEventListener('input', async event => { audio.setVolume(Number(event.target.value) / 100); if (audio.volume > 0) await audio.enable(); updateSoundButton(); });
$('#music-volume').addEventListener('input', async event => { audio.setMusicVolume(Number(event.target.value) / 100); if (audio.musicVolume > 0) await audio.enable(); updateSoundButton(); });
$$('[data-quality]').forEach(button => button.addEventListener('click', () => { $$('[data-quality]').forEach(b => b.classList.toggle('selected', b === button)); view.quality(button.dataset.quality); }));

function saveName() { nickname = $('#nickname').value.trim().slice(0, 12) || '球球'; try { localStorage.setItem('bombo-name', nickname); } catch {} }
async function newTraining() {
  if (!state.connected || state.busy || (state.screen === 'home' && state.loading && !qaMode)) return;
  state.busy = true;
  clearMatch(); $$('.modal').forEach(el => el.classList.add('hidden'));
  state.room = null; enterBattle();
  const response = await request('training', { name: nickname });
  state.busy = false;
  if (response.ok) { state.room = response.room; syncOrientation(); if (anyModal()) await pauseTraining(true); }
  else { await returnHome(); toast(response.error); }
}
$('#new-training').addEventListener('click', newTraining);
$('#result-training').addEventListener('click', newTraining);
$('#leave-room').textContent = '离开房间，返回大厅';
$('#leave-room').addEventListener('click', returnHome);
$('#create-room').addEventListener('click', async () => {
  if (state.busy || !state.connected) return;
  state.busy = true;
  saveName(); const response = await request('create', { name: nickname });
  state.busy = false;
  if (!response.ok) return $('#room-error').textContent = response.error;
  clearMatch(); state.room = response.room; updateLobby();
});
$('#join-room').addEventListener('click', async () => {
  if (state.busy || !state.connected) return;
  state.busy = true;
  saveName(); const response = await request('join', { code: $('#room-code').value, name: nickname });
  state.busy = false;
  if (!response.ok) return $('#room-error').textContent = response.error;
  clearMatch(); state.room = response.room; updateLobby();
});
$('#room-code').addEventListener('keydown', event => { if (event.key === 'Enter') $('#join-room').click(); });
$('#copy-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.room.code); toast('房间码已复制'); } catch { toast(`房间码：${state.room.code}`); }
});
$('#fill-bots').addEventListener('click', async () => { const response = await request('fill'); if (!response.ok) toast(response.error); });
$('#start-match').addEventListener('click', async () => { const response = await request('start'); if (!response.ok) toast(response.error); });

function updateLobby() {
  const room = state.room;
  const inLobby = room && !room.training;
  $('#room-entry').classList.toggle('hidden', !!inLobby); $('#room-lobby').classList.toggle('hidden', !inLobby);
  if (!inLobby) return;
  $('#display-code').textContent = room.code; $('#room-members').replaceChildren();
  for (let i = 0; i < 4; i++) {
    const member = room.members[i];
    const row = document.createElement('div'); row.className = `room-member${member ? '' : ' empty'}`;
    const mark = document.createElement('span'); mark.className = 'member-mark'; mark.textContent = member?.bot ? 'AI' : String(i + 1);
    const name = document.createElement('span'); name.textContent = member ? member.name + (member.id === state.localId ? ' · 你' : '') : '等待队员…';
    const role = document.createElement('small'); role.textContent = member?.id === room.host ? '房主' : member?.bot ? '训练伙伴' : member ? '已就绪' : '空位';
    row.append(mark, name, role); $('#room-members').appendChild(row);
  }
  const host = room.host === state.localId;
  $('#fill-bots').disabled = !host || room.members.length === 4;
  $('#start-match').disabled = !host || room.members.length < 4;
  $('#start-match').innerHTML = `<i data-lucide="${host ? 'play' : 'hourglass'}"></i>${host ? '开始对战' : '等待房主开始'}`; icons();
}
async function loadLan() {
  if ($('#lan-links').children.length) return;
  try {
    const info = await (await fetch('/api/info')).json();
    const urls = info.addresses.length ? info.addresses : [info.url];
    for (const url of urls) { const link = document.createElement('a'); link.href = url; link.textContent = url; link.target = '_blank'; link.rel = 'noreferrer'; const div = document.createElement('div'); div.appendChild(link); $('#lan-links').appendChild(div); }
    $('#qr').src = info.qr; $('#qr').classList.remove('hidden');
  } catch { $('#lan-links').textContent = location.origin; }
}

function showResult() {
  const snapshot = state.snapshot; state.resultShown = true; resetInput();
  $('#result-heading').textContent = snapshot.winner === 'draw' ? '平局，再战一场' : `${teamName(snapshot.winner)}胜利`;
  $('#result-heading').style.color = snapshot.winner === 'red' ? '#d26468' : '#2f806c';
  $('#result-reason').textContent = `${snapshot.reason} · 用时 ${formatTime(snapshot.time)}`;
  $('#result-players').replaceChildren();
  for (const p of snapshot.players) {
    const row = document.createElement('div'); row.className = `result-row ${p.team}`;
    const name = document.createElement('span'); name.textContent = p.name + (p.id === state.localId ? ' · 你' : '');
    const kills = document.createElement('span'); kills.textContent = `${p.kills} 击倒`;
    const damage = document.createElement('span'); damage.textContent = `${p.damage} 伤害`; row.append(name, kills, damage); $('#result-players').appendChild(row);
  }
  const mvp = [...snapshot.players].sort((a,b) => b.kills * 100 + b.damage - (a.kills * 100 + a.damage))[0];
  $('#mvp').textContent = `本场 MVP · ${mvp.name}`;
  $('#result-modal').classList.remove('hidden');
}
$('#rematch').addEventListener('click', async () => {
  const response = await request('rematch'); if (!response.ok) return toast(response.error);
  $('#rematch').disabled = true; $('#rematch span').textContent = '已准备，等待队员…';
});

function drawMinimap(snapshot) {
  const canvas = $('#mini-canvas'), ctx = canvas.getContext('2d');
  const sx = canvas.width / ARENA.width, sz = canvas.height / ARENA.depth;
  ctx.clearRect(0, 0, 280, 160); ctx.fillStyle = '#88b59f'; ctx.fillRect(0, 0, 280, 160);
  for (const w of WALLS) { ctx.fillStyle = w.h === 2 ? '#e3ead9' : '#dda78b'; ctx.fillRect((w.x - w.w / 2 + BOUNDS.x) * sx, (w.z - w.d / 2 + BOUNDS.z) * sz, w.w * sx, w.d * sz); }
  ctx.fillStyle = '#eecb55'; ctx.beginPath(); ctx.arc(140, 80, snapshot.loot ? 6 : 3, 0, Math.PI * 2); ctx.fill();
  for (const p of snapshot.players) if (p.hp > 0) { ctx.fillStyle = p.team === 'blue' ? '#249ebd' : '#dc6670'; ctx.beginPath(); ctx.arc((p.x + BOUNDS.x) * sx, (p.z + BOUNDS.z) * sz, p.id === state.localId ? 5.5 : 4, 0, Math.PI * 2); ctx.fill(); if (p.id === state.localId) { ctx.strokeStyle = '#fffadd'; ctx.lineWidth = 2; ctx.stroke(); } }
}
function updateHud() {
  const s = state.snapshot, p = local(); if (!s || !p) return;
  $('#clock').textContent = formatTime(600 - s.time);
  $('#mode-label').textContent = s.training ? '训练场 · 2V2' : `房间 ${state.room?.code || ''} · 2V2`;
  $('#round-label').textContent = `ROUND ${String(s.round).padStart(2,'0')}`;
  for (const team of ['blue','red']) {
    const members = s.players.filter(p => p.team === team);
    $('#' + team + '-alive').textContent = members.filter(p => p.hp > 0).length;
    const dots = $('#' + team + '-dots'); dots.replaceChildren();
    for (const member of members) { const dot = document.createElement('i'); if (member.hp <= 0) dot.className = 'dead'; dots.appendChild(dot); }
  }
  $('#local-name').textContent = p.name; $('#local-team').textContent = `${teamName(p.team)} · 你`;
  $('#local-hp').innerHTML = `${p.hp} <em>/ 100</em>`; $('#local-hp-fill').style.width = `${p.hp}%`;
  $('#shield-fill').style.width = `${p.shield}%`;
  $('#buff-text').textContent = p.buff ? `${BUFFS[p.buff].name} ${Math.ceil(p.buffRemaining)}s` : '榴弹发射器';
  $('.portrait').style.borderBottomColor = p.team === 'blue' ? '#43a5ba' : '#db7276';
  $('#loot-title').textContent = s.loot ? BUFFS[s.loot.type].name : '中央补给';
  $('#loot-timer').textContent = s.loot ? '争夺中' : formatTime(s.lootTimer);
  $('.objective').classList.toggle('available', !!s.loot);
  $('#spectate').classList.toggle('hidden', p.hp > 0 || s.state === 'result');
  const cd = $('#countdown'); cd.classList.toggle('hidden', s.state !== 'countdown');
  cd.querySelector('strong').textContent = Math.max(1, Math.ceil(s.countdown)); $('#count-team').textContent = teamName(p.team);
  for (const button of $$('.skill')) {
    const skill = Number(button.dataset.skill), remaining = Math.max(0, p.cd[skill] - (s.paused ? 0 : (performance.now() - state.lastSnapshot) / 1000));
    button.classList.toggle('cooling', remaining > 0.03); button.style.setProperty('--progress', `${remaining / SKILLS[skill].cooldown * 100}%`);
    button.querySelector('.cooldown-text').textContent = remaining < 1 ? remaining.toFixed(1) : String(Math.ceil(remaining));
  }
  if (s.state === 'result' && !s.training) {
    const ready = s.players.filter(p => p.ready || p.bot).length;
    if (p.ready) $('#rematch span').textContent = `已准备 · ${ready} / 4`;
  }
  if (view.follow) drawMinimap(s);
}

let previous = performance.now(), nextFrame = previous;
function frame(now) {
  requestAnimationFrame(frame);
  if (now < nextFrame - 0.75) return;
  nextFrame = Math.max(nextFrame + 1000 / 60, now);
  const dt = Math.min(0.05, (now - previous) / 1000); previous = now; frameCount++;
  const p = local();
  if (p && !input.hasPointer && !input.activeTouch?.moved) input.aim = facingTarget();
  if (p && input.hasPointer && !input.activeTouch && input.guide && !matchMedia('(pointer:coarse)').matches) input.aim = view.screenPoint(input.pointer.x, input.pointer.y);
  sendTimer += dt; hudTimer += dt;
  if (sendTimer >= 1 / 60) { sendTimer %= 1 / 60; sendInput(); }
  if (hudTimer > 0.08) { hudTimer = 0; updateHud(); }
  if (input.activeTouch?.moved) updateDragAim(input.activeTouch);
  if (input.fire && now - input.fire.started >= 150) {
    const target = input.fire.source === 'button' ? (input.activeTouch?.moved ? { ...input.aim } : facingTarget(0)) : null;
    cast(0, target, true);
  }
  const presentation = motion.sample(now, dt, state.localId, anyModal() ? { x: 0, z: 0 } : moveDirection());
  if (state.screen === 'battle' && !document.body.classList.contains('rotate-required')) view.render(presentation, state.localId, dt, input.aim, input.skill, input.guide || !!input.activeTouch);
}
requestAnimationFrame(frame);
if (qaMode) {
  window.__arena = { view, state, input, cast, socket, motion, audio, resetInput, get frames() { return frameCount; }, snapshot: () => JSON.parse(JSON.stringify(state.snapshot)) };
}
window.addEventListener('error', event => { console.error('Arena error:', event.error || event.message); });
