import { NesCore, validateRom, romHash } from './emulator.js';
import { RollbackSession, NETPLAY_VERSION } from './rollback.js';
import { LobbyConnection, PeerConnection } from './connection.js';
import { AudioSink } from './audio.js';

const $ = id => document.getElementById(id);
const lobby = new LobbyConnection();
const audio = new AudioSink();
const context = $('game').getContext('2d', { alpha: false });
const image = context.createImageData(256, 240);
let game = null, core = null, pickedGame = null, useCurrentGame = false;
let peer = null, roomId = null, isHost = true, remoteReady = false, localReady = false;
let mode = 'idle', pausedMode = null, session = null, epoch = null;
let incoming = null, rooms = [], nickname = readSetting('name') || '';
let lastTime = 0, accumulator = 0, fpsCount = 0, fpsTime = 0, lastHash = -1;
let toastTimer, peerTimeout, transferTimeout;
const checks = new Map(), pressed = new Set(), touched = new Set();
const keyMap = { KeyX: 0, KeyZ: 1, ShiftLeft: 2, ShiftRight: 2, Enter: 3,
  ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7 };
const secondKeys = { KeyG: 0, KeyF: 1, KeyR: 2, KeyT: 3, KeyW: 4, KeyS: 5, KeyA: 6, KeyD: 7 };

function readSetting(key) { try { return localStorage.getItem('retroroom-' + key); } catch { return null; } }
function saveSetting(key, value) { try { localStorage.setItem('retroroom-' + key, value); } catch { /* Private browsing can disable persistence. */ } }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500); }
function overlay(title, description) {
  $('screen-overlay').hidden = false;
  $('screen-overlay').querySelector('strong').textContent = title;
  $('screen-overlay').querySelector('p').textContent = description;
}
function stop(message) {
  mode = 'idle'; session = null; pausedMode = null; audio.clear();
  $('fps-value').textContent = '—';
  $('pause-button').disabled = true; $('pause-button').textContent = 'Pauzeren';
  if (message && game) { overlay('Even pas op de plaats.', message); $('room-message').textContent = message; $('room-status').textContent = 'Onderbroken'; }
}
function report(error) {
  const message = error?.message || String(error);
  toast(message);
  for (const [dialog, target] of [['create-dialog', 'create-error'], ['join-dialog', 'join-error'], ['settings-dialog', 'settings-error']]) {
    if ($(dialog).open) $(target).textContent = message;
  }
  $('create-submit').disabled = false;
}
function fatal(error) {
  const message = error?.message || String(error);
  stop(message); report(message);
  try { peer?.send('control', { type: 'interrupted', message, epoch }); } catch { /* Disconnected. */ }
  if (isHost && roomId && lobby.online) lobby.send({ type: 'status', status: 'paused' });
}
function showRoom() {
  $('home').hidden = true; $('room-view').hidden = false;
  $('game-title').textContent = game.name;
  $('game-hint').textContent = game.demo ? 'Room Rally: tik op A (X) om te racen. Start begint opnieuw.' : 'Pijlen bewegen · X = A · Z = B · Enter = Start';
  $('player-one').textContent = isHost ? nickname || 'Jij' : $('player-one').textContent;
  $('solo-controls').hidden = !!roomId;
  $('room-subtitle').textContent = roomId ? 'SPEELKAMER ' + roomId : 'EVEN PROEFSPELEN';
  $('invite-code').hidden = !roomId;
  $('room-code').textContent = roomId || '';
  $('publish-room-button').hidden = !!roomId || !isHost;
  $('invite-card').hidden = !isHost;
  $('invite-description').textContent = roomId ? 'Deel je kamerlink. Je vriend hoeft zelf geen ROM te selecteren.' : 'Maak een kamer om een uitnodigingslink te delen.';
  $('room-status').textContent = 'Klaar om te spelen';
  $('solo-button').textContent = 'Speel solo';
  $('play-mode').textContent = roomId ? 'Kamer ' + roomId : 'Lokaal · solo';
  $('route-value').textContent = roomId ? 'Verbinden…' : 'Lokaal';
  updateActions(); window.scrollTo({ top: 0, behavior: 'instant' });
}
function draw(frame) {
  const data = image.data;
  for (let i = 0; i < frame.length; i++) {
    const pixel = frame[i], offset = i * 4;
    data[offset] = pixel & 255; data[offset + 1] = pixel >> 8 & 255;
    data[offset + 2] = pixel >> 16 & 255; data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}
async function loadGame(bytes, name, demo = false) {
  validateRom(bytes);
  if (!window.jsnes?.NES) throw new Error('De emulator kon niet worden geladen. Vernieuw de pagina.');
  const next = new NesCore(window.jsnes.NES, { onFrame: draw, onAudio: (l, r) => audio.push(l, r) });
  next.load(bytes);
  stop(); core = next;
  game = { bytes, name: String(name).slice(0, 80), demo, hash: await romHash(bytes) };
  audio.clear();
  for (let i = 0; i < 6; i++) core.run(0, 0);
  audio.clear(); core.load(bytes);
  overlay('Klaar voor de start.', 'Start solo of nodig een vriend uit.');
  $('rollback-value').textContent = '0'; $('fps-value').textContent = '—';
}
async function demoData() {
  const response = await fetch(new URL('../assets/room-rally.nes', import.meta.url));
  if (!response.ok) throw new Error('De demo kon niet worden geladen.');
  return { bytes: new Uint8Array(await response.arrayBuffer()), name: 'Room Rally', demo: true };
}
async function enableAudio() {
  try { await audio.enable(); updateAudio(); }
  catch { toast('Geluid is hier niet beschikbaar. Je kunt zonder geluid verder spelen.'); }
}
function updateAudio() {
  const text = audio.enabled ? 'Geluid uitzetten' : 'Geluid aanzetten';
  $('audio-button').setAttribute('aria-label', text); $('audio-button').title = text;
  $('audio-button').textContent = audio.enabled ? '♫' : '♪';
}
function updateActions() {
  const connected = peer?.control?.readyState === 'open';
  $('solo-button').hidden = !isHost || !!connected;
  $('start-button').disabled = isHost ? !remoteReady || !connected || mode === 'online' : !game || !connected || localReady;
  $('start-button').textContent = isHost ? (mode === 'online' ? 'Samen aan het spelen' : mode === 'paused' && session ? 'Verder spelen →' : 'Start samen →') : (mode === 'online' ? 'Samen aan het spelen' : localReady ? 'Wachten op de host…' : 'Ik ben klaar →');
  $('restart-button').hidden = !isHost || !connected || !remoteReady || !(mode === 'online' || mode === 'paused');
  $('guest-state').textContent = (isHost ? remoteReady : localReady) ? 'Klaar' : connected ? 'Verbonden' : '—';
}
function beginOnline(newEpoch) {
  core.load(game.bytes); audio.clear(); checks.clear(); lastHash = -1;
  epoch = newEpoch; mode = 'online'; pausedMode = null; accumulator = 0; lastTime = 0;
  fpsTime = performance.now(); fpsCount = 0;
  session = new RollbackSession(core, { player: isHost ? 1 : 2,
    send: message => peer.send('input', { ...message, epoch }) });
  $('screen-overlay').hidden = true; $('pause-button').disabled = false;
  $('pause-button').textContent = 'Pauzeren'; $('room-status').textContent = 'Samen aan het spelen';
  $('room-message').textContent = 'Jullie spelen allebei lokaal. De verbinding houdt jullie game gelijk.';
  $('play-mode').textContent = 'Samen · rollback'; $('solo-controls').hidden = true;
  $('game').focus(); updateActions();
  if (isHost) lobby.send({ type: 'status', status: 'playing' });
}
function pause(send = true) {
  if (!['online', 'solo'].includes(mode)) return;
  pausedMode = mode; mode = 'paused'; audio.clear(); pressed.clear(); touched.clear();
  $('fps-value').textContent = '—';
  overlay('Even pauze.', roomId ? 'De host kan de game weer hervatten.' : 'Klaar voor nog een ronde?');
  $('room-status').textContent = 'Gepauzeerd'; $('pause-button').textContent = 'Verder spelen';
  if (send && pausedMode === 'online') peer.send('control', { type: 'pause', epoch });
  if (isHost && roomId) lobby.send({ type: 'status', status: 'paused' });
  updateActions();
}
function resume(send = true) {
  if (mode !== 'paused') return;
  if (pausedMode === 'online' && send && !isHost) { toast('De host kan de game hervatten.'); return; }
  if (send && pausedMode === 'online') peer.send('control', { type: 'resume', epoch });
  mode = pausedMode; pausedMode = null; accumulator = 0; lastTime = 0;
  fpsTime = performance.now(); fpsCount = 0;
  $('screen-overlay').hidden = true; $('pause-button').textContent = 'Pauzeren';
  $('room-status').textContent = mode === 'online' ? 'Samen aan het spelen' : 'Solo aan het spelen';
  if (isHost && roomId) lobby.send({ type: 'status', status: 'playing' });
  $('game').focus(); updateActions();
}
function resetPeer() {
  clearTimeout(peerTimeout); clearTimeout(transferTimeout); incoming = null;
  peer?.close(); peer = null; remoteReady = false; localReady = false;
  $('transfer').hidden = true; $('ping-value').textContent = '—';
  $('route-value').textContent = 'Niet verbonden';
}
function leaveRoom() {
  stop(); resetPeer(); if (roomId && lobby.online) lobby.send({ type: 'leave' });
  roomId = null; game = null; core = null; pickedGame = null; isHost = true;
  pressed.clear(); touched.clear();
  $('home').hidden = false; $('room-view').hidden = true;
  $('player-two').textContent = 'Nog een plekje vrij'; $('guest-detail').textContent = 'Nodig je favoriete rivaal uit';
  $('room-message').textContent = 'Je kunt alvast solo spelen.';
  history.replaceState(null, '', location.pathname + location.search);
}
function setTransfer(value, label) {
  $('transfer').hidden = false; $('transfer-progress').value = value;
  $('transfer-label').textContent = label + ' · ' + Math.round(value * 100) + '%';
}
function setupPeer(host) {
  resetPeer();
  if (mode === 'solo') stop();
  peer = new PeerConnection(lobby, host);
  const current = peer;
  peerTimeout = setTimeout(() => {
    if (current === peer && current.pc.connectionState !== 'connected') fatal('De directe verbinding lukt niet. Controleer of de lobbyserver TURN heeft ingesteld.');
  }, 20000);
  peer.addEventListener('open', async () => {
    if (current !== peer) return;
    clearTimeout(peerTimeout); stop();
    $('room-message').textContent = host ? 'Speler 2 is verbonden. De game wordt verstuurd.' : 'Verbonden. Wachten op de game van de host.';
    updateActions();
    if (host) {
      try {
        await current.transfer(game.bytes, { name: game.name, hash: game.hash, demo: game.demo, version: NETPLAY_VERSION },
          progress => setTransfer(progress, 'ROM verzenden'));
        $('room-message').textContent = 'Game verstuurd. Speler 2 controleert de ROM en maakt zich klaar.';
      } catch (error) { fatal(error); }
    }
  });
  peer.addEventListener('rom', event => { if (current === peer) receiveRom(event.detail, current).catch(fatal); });
  peer.addEventListener('input', ({ detail }) => {
    if (current !== peer || detail?.epoch !== epoch || !session || detail.type !== 'input') return;
    try { session.receive(detail.frame, detail.buttons); } catch (error) { fatal(error); }
  });
  peer.addEventListener('control', ({ detail }) => {
    if (current !== peer) return;
    try { handleControl(detail); } catch (error) { fatal(error); }
  });
  peer.addEventListener('error', ({ detail }) => { if (current === peer && !current.closed) fatal(detail); });
  peer.addEventListener('state', ({ detail }) => {
    if (current !== peer) return;
    if (detail === 'failed') fatal('Verbinding mislukt. Controleer de STUN/TURN-instellingen van de server.');
    if (detail === 'disconnected' || detail === 'closed') {
      stop('De verbinding met de andere speler is weggevallen. Verlaat de kamer en verbind opnieuw.');
      remoteReady = false; updateActions();
    }
  });
  return peer;
}
async function receiveRom(message, sender) {
  if (isHost) throw new Error('Alleen de host kan een ROM versturen.');
  if (message instanceof ArrayBuffer) {
    if (!incoming || message.byteLength > 16384 || incoming.offset + message.byteLength > incoming.bytes.length) throw new Error('Ongeldige ROM-overdracht.');
    incoming.bytes.set(new Uint8Array(message), incoming.offset); incoming.offset += message.byteLength;
    setTransfer(incoming.offset / incoming.bytes.length, 'ROM ontvangen'); armTransferTimeout(); return;
  }
  if (message?.type === 'begin') {
    if (message.version !== NETPLAY_VERSION) throw new Error('Jullie gebruiken verschillende emulatorversies. Vernieuw allebei de pagina.');
    if (!Number.isInteger(message.size) || message.size < 16 || message.size > 8 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(message.hash)) throw new Error('Ongeldige ROM-gegevens.');
    incoming = { ...message, bytes: new Uint8Array(message.size), offset: 0 };
    game = null; localReady = false; setTransfer(0, 'ROM ontvangen'); armTransferTimeout(); updateActions();
  } else if (message?.type === 'complete') {
    if (!incoming || incoming.offset !== incoming.bytes.length) throw new Error('De ROM-overdracht is niet compleet.');
    clearTimeout(transferTimeout);
    const received = incoming; incoming = null;
    const hash = await romHash(received.bytes);
    if (sender !== peer || sender.closed) return;
    if (hash !== received.hash) throw new Error('De ROM-controle is mislukt. Verbind opnieuw.');
    await loadGame(received.bytes, received.name, received.demo === true);
    showRoom(); $('transfer').hidden = true;
    $('room-message').textContent = 'Game ontvangen en gecontroleerd. Klik op ‘Ik ben klaar’.';
    $('guest-detail').textContent = 'Jij · controller 2'; $('player-two').textContent = nickname;
    overlay('Je game staat klaar.', 'Klik op ‘Ik ben klaar’. De host start jullie game.');
    peer.send('control', { type: 'rom-ready', hash: game.hash });
    updateActions();
  } else throw new Error('Onbekend overdrachtsbericht.');
}
function armTransferTimeout() {
  clearTimeout(transferTimeout);
  transferTimeout = setTimeout(() => { incoming = null; fatal('ROM-overdracht onderbroken. Verbind opnieuw.'); }, 20000);
}
function handleControl(message) {
  if (!message || typeof message !== 'object') throw new Error('Ongeldig spelbericht.');
  if (message.type === 'ping' && typeof message.time === 'number') return peer.send('control', { type: 'pong', time: message.time });
  if (message.type === 'pong' && typeof message.time === 'number') {
    $('ping-value').textContent = Math.max(0, Math.round(performance.now() - message.time)) + ' ms'; return;
  }
  if (message.type === 'rom-ready' && isHost) {
    if (message.hash !== game.hash) throw new Error('De ROMs komen niet overeen.');
    $('transfer').hidden = true; $('room-message').textContent = 'Game gecontroleerd. Wachten tot speler 2 klaar is.'; return;
  }
  if (message.type === 'ready' && isHost) {
    if (message.hash !== game.hash) throw new Error('De ROMs komen niet overeen.');
    remoteReady = true; $('room-message').textContent = 'Iedereen is klaar. Jij kunt de game starten.'; updateActions(); return;
  }
  if (message.type === 'start' && !isHost && localReady && game) {
    if (message.version !== NETPLAY_VERSION || message.hash !== game.hash || typeof message.epoch !== 'string') throw new Error('De startgegevens komen niet overeen.');
    beginOnline(message.epoch); return;
  }
  if (message.type === 'pause' && message.epoch === epoch) { pause(false); return; }
  if (message.type === 'resume' && !isHost && message.epoch === epoch) { resume(false); return; }
  if (message.type === 'hash' && !isHost && message.epoch === epoch && session && Number.isSafeInteger(message.frame) && /^[a-f0-9]{8}$/.test(message.hash)) {
    if (checks.size < 8) checks.set(message.frame, message.hash); return;
  }
  if (message.type === 'interrupted' && message.epoch === epoch) {
    stop('De game is onderbroken bij de andere speler. De host kan opnieuw starten.'); return;
  }
}
function buttons(map, padIndex = 0, touch = false) {
  let bits = 0;
  for (const key of pressed) if (map[key] !== undefined) bits |= 1 << map[key];
  if (touch) for (const b of touched) bits |= 1 << b;
  const pad = [...(navigator.getGamepads?.() || [])].filter(Boolean)[padIndex];
  if (pad) {
    if (pad.buttons[0]?.pressed) bits |= 1;
    if (pad.buttons[1]?.pressed || pad.buttons[2]?.pressed) bits |= 2;
    if (pad.buttons[8]?.pressed) bits |= 4;
    if (pad.buttons[9]?.pressed) bits |= 8;
    if (pad.buttons[12]?.pressed || pad.axes[1] < -.45) bits |= 16;
    if (pad.buttons[13]?.pressed || pad.axes[1] > .45) bits |= 32;
    if (pad.buttons[14]?.pressed || pad.axes[0] < -.45) bits |= 64;
    if (pad.buttons[15]?.pressed || pad.axes[0] > .45) bits |= 128;
  }
  // Opposite directions are undefined on physical NES controllers.
  if ((bits & 48) === 48) bits &= ~48;
  if ((bits & 192) === 192) bits &= ~192;
  return bits;
}
function loop(time) {
  requestAnimationFrame(loop);
  if (!core || !['solo', 'online'].includes(mode)) { lastTime = time; return; }
  if (!lastTime) lastTime = time;
  accumulator = Math.min(accumulator + time - lastTime, 100); lastTime = time;
  try {
    let count = 0;
    while (accumulator >= 1000 / 60 && count++ < 5) {
      let advanced = true;
      if (mode === 'online') advanced = session.tick(buttons(keyMap, 0, true));
      else core.run(buttons(keyMap, 0, true), buttons(secondKeys, 1));
      accumulator -= 1000 / 60;
      if (advanced) fpsCount++;
      else { accumulator = 0; break; }
    }
    audio.flush();
    if (mode === 'online') {
      $('room-status').textContent = session.waiting ? 'Wachten op de verbinding…' : 'Samen aan het spelen';
      for (const [frame, hash] of checks) {
        const local = session.hashAt(frame);
        if (local !== null) {
          checks.delete(frame);
          if (local !== hash) throw new Error('De games lopen niet meer gelijk. De host kan samen opnieuw starten.');
        } else if (session.frame > frame + 180) checks.delete(frame);
      }
    }
    if (time - fpsTime > 1000) {
      $('fps-value').textContent = Math.round(fpsCount * 1000 / (time - fpsTime)) + ' fps';
      $('rollback-value').textContent = String(session?.rollbacks || 0);
      fpsCount = 0; fpsTime = time;
    }
  } catch (error) { fatal(error); }
}
requestAnimationFrame(loop);

function renderRooms() {
  $('rooms').replaceChildren();
  const availableOnly = $('available-only').checked;
  const shown = rooms.filter(room => !availableOnly || room.players < 2);
  $('room-count').textContent = String(rooms.length);
  $('lobby-empty').hidden = shown.length > 0;
  $('lobby-empty').querySelector('h3').textContent = availableOnly && rooms.length ? 'Alle banken zijn even bezet.' : 'De eerste kamer is voor jou.';
  for (const room of shown) {
    const card = document.createElement('article'); card.className = 'room-card';
    card.innerHTML = '<div class="room-card-top"><span class="badge">NES</span><small></small></div><h3></h3><p></p><div class="room-card-bottom"><span></span><button class="button outline small">Schuif aan ↗</button></div>';
    card.querySelector('h3').textContent = room.game;
    card.querySelector('p').textContent = room.title + ' · ' + room.host;
    card.querySelector('small').textContent = room.status === 'playing' ? 'Aan het spelen' : room.status === 'paused' ? 'Gepauzeerd' : 'Wacht op speler';
    card.querySelector('.room-card-bottom span').textContent = room.players + '/2 spelers';
    const button = card.querySelector('button'); button.disabled = room.players >= 2;
    if (room.players >= 2) button.textContent = 'Kamer vol';
    button.onclick = () => openJoin(room.id);
    $('rooms').append(card);
  }
}
function connectionStatus(online) {
  const local = lobby.url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(lobby.url).hostname);
  $('connection-label').classList.toggle('offline', !online);
  $('connection-label').lastChild.textContent = online ? (local ? ' Lokale lobby' : ' Lobby online') : ' Lobby niet verbonden';
  $('empty-copy').innerHTML = online ? 'Kies een game en nodig iemand uit.<br>Een ouderwets goede avond begint hier.' : 'Koppel een lobbyserver via Instellingen.<br>Je kunt de demo alvast solo proberen.';
  $('server-note').textContent = local ? 'Dit is een lokale server. Een vriend op een ander apparaat heeft een bereikbaar openbaar serveradres nodig.' : 'Voor online spelen is een bereikbare lobbyserver nodig. Solo spelen kan ook zonder verbinding.';
}
async function ensureLobby() {
  if (lobby.online) return;
  const url = $('server-url').value.trim();
  if (!url) throw new Error('Koppel eerst een lobbyserver via Instellingen. Je kunt de demo alvast solo proberen.');
  await lobby.connect(url);
}

lobby.addEventListener('rooms', ({ detail }) => { rooms = detail.rooms; renderRooms(); });
lobby.addEventListener('online', () => connectionStatus(true));
lobby.addEventListener('offline', () => {
  connectionStatus(false); rooms = []; renderRooms();
  if (roomId) { resetPeer(); stop('De lobbyverbinding is weggevallen. Verbind opnieuw via Instellingen en maak een nieuwe kamer.'); roomId = null; updateActions(); }
});
lobby.addEventListener('error', ({ detail }) => report(detail.message));
lobby.addEventListener('created', ({ detail }) => {
  roomId = detail.id; isHost = true;
  $('create-dialog').close(); $('create-submit').disabled = false;
  $('player-one').textContent = nickname; showRoom();
  $('room-message').textContent = 'Je kamer staat klaar. Deel de link of wacht tot iemand aanschuift.';
  $('player-two').textContent = 'Nog een plekje vrij';
});
lobby.addEventListener('joined', ({ detail }) => {
  roomId = detail.id; isHost = false; game = null;
  $('join-dialog').close(); $('home').hidden = true; $('room-view').hidden = false;
  $('game-title').textContent = detail.game; $('room-subtitle').textContent = detail.title;
  $('player-one').textContent = detail.host; $('player-two').textContent = nickname;
  $('guest-detail').textContent = 'Jij · controller 2'; $('invite-card').hidden = true;
  $('room-message').textContent = 'Verbinding maken met de host…'; $('room-status').textContent = 'Verbinden…';
  $('solo-controls').hidden = true; $('solo-button').hidden = true;
  overlay('Schuif maar aan.', 'We verbinden je met de host.');
  setupPeer(false); updateActions(); window.scrollTo({ top: 0, behavior: 'instant' });
});
lobby.addEventListener('guest-joined', ({ detail }) => {
  $('player-two').textContent = detail.name; $('guest-detail').textContent = 'Gast · controller 2';
  $('room-message').textContent = detail.name + ' schuift aan. Verbinding maken…';
  setupPeer(true).offer().catch(fatal);
});
lobby.addEventListener('signal', ({ detail }) => { peer?.signal(detail.data).catch(fatal); });
lobby.addEventListener('guest-left', () => {
  stop('Speler 2 heeft de kamer verlaten. Je kunt opnieuw iemand uitnodigen.'); resetPeer();
  $('player-two').textContent = 'Nog een plekje vrij'; $('guest-detail').textContent = 'Nodig iemand uit'; updateActions();
  if (roomId && lobby.online) lobby.send({ type: 'status', status: 'waiting' });
});
lobby.addEventListener('room-closed', () => { leaveRoom(); toast('De host heeft de kamer gesloten.'); });

function openCreate(current = false) {
  if (roomId) { toast('Verlaat eerst je huidige kamer.'); return; }
  useCurrentGame = current && !!game; pickedGame = null;
  $('game-picker').hidden = useCurrentGame;
  $('host-name').value = nickname; $('create-error').textContent = ''; $('file-name').textContent = 'Kies je NES-ROM';
  $('rom-file').value = ''; $('create-submit').disabled = false; $('create-dialog').showModal();
}
function openJoin(code = '') {
  if (roomId || game && !$('room-view').hidden) { toast('Verlaat eerst je huidige speelkamer.'); return; }
  $('guest-name').value = nickname; $('join-code').value = code; $('join-error').textContent = '';
  $('join-dialog').showModal();
}
document.querySelectorAll('[data-create]').forEach(button => button.onclick = () => openCreate());
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
}));
$('join-button').onclick = () => openJoin();
$('publish-room-button').onclick = () => openCreate(true);
$('leave-button').onclick = leaveRoom;
$('about-button').onclick = () => $('about-dialog').showModal();
document.querySelectorAll('.brand, .topbar nav a').forEach(link => link.addEventListener('click', () => {
  if (!$('room-view').hidden) leaveRoom();
}));
$('settings-button').onclick = () => { $('settings-error').textContent = ''; $('settings-dialog').showModal(); };
$('available-only').onchange = renderRooms;
$('refresh-button').onclick = () => { ensureLobby().then(() => lobby.send({ type: 'list' })).catch(report); };
$('rom-file').onchange = async () => {
  try {
    const file = $('rom-file').files[0]; if (!file) return;
    if (file.size > 8 * 1024 * 1024) throw new Error('De ROM mag maximaal 8 MB zijn.');
    const bytes = new Uint8Array(await file.arrayBuffer()); validateRom(bytes);
    pickedGame = { bytes, name: file.name.replace(/\.nes$/i, ''), demo: false };
    $('file-name').textContent = file.name; $('create-error').textContent = '';
  } catch (error) { pickedGame = null; report(error); }
};
$('choose-demo').onclick = async () => {
  try { pickedGame = await demoData(); $('file-name').textContent = 'Room Rally · originele NES-demo'; $('rom-file').value = ''; $('create-error').textContent = ''; }
  catch (error) { report(error); }
};
$('create-form').onsubmit = async event => {
  event.preventDefault(); $('create-error').textContent = ''; $('create-submit').disabled = true;
  try {
    if (!useCurrentGame && !pickedGame) throw new Error('Kies eerst een NES-ROM of gebruik onze demo.');
    await ensureLobby();
    const values = new FormData(event.target);
    nickname = String(values.get('name')).trim(); saveSetting('name', nickname);
    if (!useCurrentGame) await loadGame(pickedGame.bytes, pickedGame.name, pickedGame.demo);
    stop();
    lobby.send({ type: 'create', name: nickname, title: values.get('title'), game: game.name, public: values.has('public') });
  } catch (error) { report(error); }
};
$('join-form').onsubmit = async event => {
  event.preventDefault(); $('join-error').textContent = '';
  try {
    let code = $('join-code').value.trim();
    if (/^https?:\/\//.test(code)) {
      const params = new URLSearchParams(new URL(code).hash.slice(1));
      code = params.get('room') || '';
      const server = params.get('server');
      if (server && server !== lobby.url) {
        $('server-url').value = server; await lobby.connect(server); saveSetting('server', server);
      }
    }
    if (!/^[a-f\d]{10}$/i.test(code)) throw new Error('Gebruik de tien tekens van de kamercode of de volledige uitnodigingslink.');
    await ensureLobby(); nickname = $('guest-name').value.trim(); saveSetting('name', nickname);
    lobby.send({ type: 'join', id: code.toUpperCase(), name: nickname });
  } catch (error) { report(error); }
};
$('settings-form').onsubmit = async event => {
  event.preventDefault(); $('settings-error').textContent = '';
  try {
    if (roomId) throw new Error('Verlaat eerst je kamer voordat je de lobbyserver verandert.');
    const url = $('server-url').value.trim(); await lobby.connect(url); saveSetting('server', url);
    $('settings-dialog').close(); toast('Verbonden met de lobbyserver.');
  } catch (error) { report(error); }
};
$('demo-button').onclick = async () => {
  try {
    const demo = await demoData(); isHost = true; roomId = null;
    await loadGame(demo.bytes, demo.name, true); showRoom();
    $('room-message').textContent = 'Tik op A om te racen. Speel solo of maak een kamer om samen te testen.';
  } catch (error) { report(error); }
};
$('solo-button').onclick = async () => {
  try {
    await enableAudio(); core.load(game.bytes); session = null; mode = 'solo'; accumulator = 0; lastTime = 0;
    fpsTime = performance.now(); fpsCount = 0;
    $('screen-overlay').hidden = true; $('pause-button').disabled = false;
    $('pause-button').textContent = 'Pauzeren'; $('room-status').textContent = 'Solo aan het spelen';
    $('solo-button').textContent = 'Solo opnieuw beginnen'; $('game').focus();
    $('play-mode').textContent = 'Lokaal · solo'; $('solo-controls').hidden = false;
  } catch (error) { fatal(error); }
};
async function startTogether() {
  await enableAudio();
  if (!isHost) {
    localReady = true; peer.send('control', { type: 'ready', hash: game.hash });
    $('room-message').textContent = 'Je bent klaar. De host kan nu starten.'; updateActions(); return;
  }
  if (!remoteReady || !peer) throw new Error('Wacht tot speler 2 klaar is.');
  if (mode === 'paused' && session) { resume(); return; }
  const nextEpoch = crypto.randomUUID();
  peer.send('control', { type: 'start', epoch: nextEpoch, hash: game.hash, version: NETPLAY_VERSION });
  beginOnline(nextEpoch);
}
$('start-button').onclick = () => startTogether().catch(report);
$('restart-button').onclick = () => { stop(); startTogether().catch(report); };
$('pause-button').onclick = () => { try { mode === 'paused' ? resume() : pause(); } catch (error) { report(error); } };
$('audio-button').onclick = async () => { if (audio.enabled) { audio.mute(); updateAudio(); } else await enableAudio(); };
$('fullscreen-button').onclick = async () => {
  try { document.fullscreenElement ? await document.exitFullscreen() : await $('play-panel').requestFullscreen(); }
  catch { toast('Volledig scherm is hier niet beschikbaar.'); }
};
$('copy-button').onclick = async () => {
  const url = new URL(location.href); url.hash = new URLSearchParams({ room: roomId, server: lobby.url }).toString();
  try { await navigator.clipboard.writeText(url.href); toast('Kamerlink gekopieerd. Tijd om iemand uit te dagen.'); }
  catch { window.prompt('Kopieer deze uitnodigingslink:', url.href); }
};
document.addEventListener('keydown', event => {
  if ($('room-view').hidden || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (keyMap[event.code] !== undefined || secondKeys[event.code] !== undefined) { event.preventDefault(); pressed.add(event.code); }
});
document.addEventListener('keyup', event => pressed.delete(event.code));
window.addEventListener('blur', () => pressed.clear());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pressed.clear(); touched.clear(); try { pause(); } catch { /* Connection may be closing. */ } }
});
document.querySelectorAll('[data-pad]').forEach(button => {
  button.onpointerdown = event => { event.preventDefault(); button.setPointerCapture(event.pointerId); touched.add(Number(button.dataset.pad)); button.classList.add('pressed'); };
  const release = () => { touched.delete(Number(button.dataset.pad)); button.classList.remove('pressed'); };
  button.onpointerup = release; button.onpointercancel = release; button.onlostpointercapture = release;
});
window.addEventListener('gamepadconnected', ({ gamepad }) => { $('gamepad-hint').textContent = 'Gamepad verbonden: ' + gamepad.id; });
window.addEventListener('gamepaddisconnected', () => { $('gamepad-hint').textContent = 'Gamepad losgekoppeld. Je kunt het toetsenbord gebruiken.'; });

setInterval(async () => {
  if (!peer || peer.control?.readyState !== 'open') return;
  try {
    peer.send('control', { type: 'ping', time: performance.now() });
    if (isHost && session && mode === 'online') {
      const checkpoint = session.confirmedState();
      if (checkpoint && checkpoint.frame > lastHash) {
        peer.send('control', { type: 'hash', ...checkpoint, epoch }); lastHash = checkpoint.frame;
      }
    }
    const stats = await peer.pc.getStats();
    for (const value of stats.values()) {
      if (value.type === 'transport' && value.selectedCandidatePairId) {
        const pair = stats.get(value.selectedCandidatePairId);
        const local = stats.get(pair?.localCandidateId), remote = stats.get(pair?.remoteCandidateId);
        $('route-value').textContent = [local?.candidateType, remote?.candidateType].includes('relay') ? 'Via TURN' : 'Rechtstreeks';
      }
    }
  } catch (error) { if (mode === 'online') fatal(error); }
}, 2000);

async function init() {
  const invitation = new URLSearchParams(location.hash.slice(1));
  let config = {};
  try { const response = await fetch(new URL('../config.json', import.meta.url)); if (response.ok) config = await response.json(); } catch { /* Optional deployment configuration. */ }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const endpoint = invitation.get('server') || readSetting('server') || config.serverUrl || (local ? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws` : '');
  $('server-url').value = endpoint;
  connectionStatus(false); renderRooms();
  if (endpoint) { try { await lobby.connect(endpoint); } catch { connectionStatus(false); } }
  if (invitation.get('room')) openJoin(invitation.get('room'));
}
init().catch(report);
