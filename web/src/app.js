import { romHash } from './emulator.js';
import { RollbackSession, NETPLAY_VERSION } from './rollback.js';
import { InviteConnection, PeerConnection, parseInvitation } from './connection.js';
import { AudioSink } from './audio.js';
import { MesenCore, MESEN_BUILD, cartridgeSystem, validateOverclock } from './mesen.js';
import { encodeSavestate, decodeSavestate, savestateFilename, MAX_SAVESTATE_FILE } from './savestate.js';
import { createGameConfig, validateGameConfig, verifyLocalRom } from './protocol.js';
import { PlaybackClock } from './playback-clock.js';

const $ = id => document.getElementById(id);
const invites = new InviteConnection();
const audio = new AudioSink();
const context = $('game').getContext('2d', { alpha: false });
let image = context.createImageData(256, 240);
let game = null, core = null, pickedGame = null, useCurrentGame = false;
let peer = null, roomId = null, isHost = true, remoteReady = false, localReady = false;
let mode = 'idle', pausedMode = null, session = null, epoch = null;
let expectedGame = null, guestLoading = false, nickname = readSetting('name') || '';
let lastTime = 0, accumulator = 0, fpsCount = 0, fpsTime = 0, lastHash = -1;
let toastTimer;
let launchMode = 'room', selectedSystem = null, launchGeneration = 0, launchBusy = false, launchCommitted = false, currentGameRequested = false;
let stateBusy = false;
const checks = new Map(), pressed = new Set(), touched = new Set();
const keyMap = { KeyX: 0, KeyZ: 1, ShiftLeft: 2, ShiftRight: 2, Enter: 3,
  ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, KeyC: 8, KeyV: 9, KeyQ: 10, KeyE: 11 };
const secondKeys = { KeyG: 0, KeyF: 1, KeyR: 2, KeyT: 3, KeyW: 4, KeyS: 5, KeyA: 6, KeyD: 7, KeyY: 8, KeyH: 9, Digit1: 10, Digit2: 11 };

function readSetting(key) { try { return localStorage.getItem('retroroom-' + key); } catch { return null; } }
function saveSetting(key, value) { try { localStorage.setItem('retroroom-' + key, value); } catch { /* Private browsing can disable persistence. */ } }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500); }
function overlay(title, description) {
  $('screen-overlay').hidden = false;
  $('screen-overlay').querySelector('strong').textContent = title;
  $('screen-overlay').querySelector('p').textContent = description;
}
function stop(message) {
  playbackClock.setRunning(false);
  mode = 'idle'; session = null; pausedMode = null; audio.clear();
  $('fps-value').textContent = '—';
  $('pause-button').disabled = true; $('pause-button').textContent = 'Pauzeren';
  if (message && game) { overlay('Even pas op de plaats.', message); $('room-message').textContent = message; $('room-status').textContent = 'Onderbroken'; }
}
function report(error) {
  const message = error?.message || String(error);
  toast(message);
  for (const [dialog, target] of [['create-dialog', 'create-error'], ['join-dialog', 'join-error']]) {
    if ($(dialog).open) $(target).textContent = message;
  }
  if (!launchBusy) $('create-submit').disabled = false;
}
function fatal(error) {
  const message = error?.message || String(error);
  stop(message); report(message);
  try { peer?.send('control', { type: 'interrupted', message, epoch }); } catch { /* Disconnected. */ }
}
function showRoom() {
  $('savestate-status').textContent = '';
  $('home').hidden = true; $('room-view').hidden = false;
  $('game-title').textContent = game.name;
  $('console-badge').textContent = (game.system === 'snes' ? 'SNES' : 'NES') + ' · MESEN · ALPHA';
  $('game').setAttribute('aria-label', `${game.system.toUpperCase()}-gamescherm`);
  $('snes-controls-guide').hidden = $('snes-touch').hidden = game.system !== 'snes';
  $('game-hint').textContent = game.demo ? 'Room Rally: tik op A (X) om te racen. Start begint opnieuw.' : 'Pijlen bewegen · X = A · Z = B · Enter = Start';
  $('player-one').textContent = isHost ? nickname || 'Jij' : $('player-one').textContent;
  $('solo-controls').hidden = !!roomId;
  $('room-subtitle').textContent = roomId ? 'PRIVÉKAMER · UITNODIGING' : 'SOLO · LOKAAL';
  $('invite-code').hidden = !roomId;
  $('room-code').textContent = roomId ? 'Alleen via jouw link' : '';
  $('invite-link').value = roomId ? invitationUrl() : '';
  $('invite-link').closest('label').hidden = !roomId;
  $('publish-room-button').hidden = !!roomId || !isHost;
  $('invite-card').hidden = !isHost;
  $('invite-description').textContent = roomId ? 'Deel je kamerlink. Je vriend kiest zelf dezelfde ROM op het eigen apparaat.' : 'Maak een kamer om een uitnodigingslink te delen.';
  $('room-status').textContent = 'Klaar om te spelen';
  $('solo-button').textContent = 'Speel solo';
  $('play-mode').textContent = roomId ? 'Privékamer · twee spelers' : 'Lokaal · solo';
  $('route-value').textContent = peer?.opened ? peer.route : roomId ? 'Verbinden…' : 'Lokaal';
  updateActions(); window.scrollTo({ top: 0, behavior: 'instant' });
}
function draw(frame, width = 256, height = 240) {
  if (image.width !== width || image.height !== height) {
    $('game').width = width; $('game').height = height; image = context.createImageData(width, height);
  }
  const data = image.data;
  for (let i = 0; i < frame.length; i++) {
    const pixel = frame[i], offset = i * 4;
    data[offset] = pixel & 255; data[offset + 1] = pixel >> 8 & 255;
    data[offset + 2] = pixel >> 16 & 255; data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}
async function loadGame(bytes, name, demo = false, system = 'nes', overclock = 100, isCurrent = () => true) {
  validateOverclock(overclock);
  if (!['nes', 'snes'].includes(system)) throw new Error('Dit systeem wordt nog niet ondersteund.');
  cartridgeSystem(bytes, system === 'snes' ? 'game.sfc' : 'game.nes');
  const next = await MesenCore.create({ onFrame: draw, onAudio: (l, r) => audio.push(l, r) });
  const hash = await romHash(bytes);
  if (!isCurrent()) return false;
  next.load(bytes, system, { overclock });
  stop(); core = next;
  game = { bytes, name: String(name).slice(0, 80), demo, system, overclock, hash };
  audio.clear();
  for (let i = 0; i < 6; i++) core.run(0, 0);
  audio.clear(); core.load(bytes, system, { overclock });
  overlay('Klaar voor de start.', 'Start solo of nodig een vriend uit.');
  $('rollback-value').textContent = '0'; $('fps-value').textContent = '—';
  return true;
}
async function demoData() {
  const response = await fetch(new URL('../assets/room-rally.nes', import.meta.url));
  if (!response.ok) throw new Error('De demo kon niet worden geladen.');
  return { bytes: new Uint8Array(await response.arrayBuffer()), name: 'Room Rally', demo: true, system: 'nes' };
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
  playbackClock.setRunning(!!core && ['solo', 'online'].includes(mode));
  const connected = peer?.opened && peer?.control?.readyState === 'open';
  $('guest-rom-card').hidden = isHost || !expectedGame;
  $('guest-rom-file').disabled = guestLoading || localReady || mode === 'online' || mode === 'paused';
  $('guest-demo-button').hidden = !expectedGame?.demo;
  $('guest-demo-button').disabled = $('guest-rom-file').disabled;
  $('room-overclock').value = String(game?.overclock ?? expectedGame?.overclock ?? 100);
  $('room-overclock').disabled = !game || !isHost || !!peer || !!invites.connection || stateBusy;
  $('overclock-note').textContent = !isHost ? 'De host kiest deze instelling. Jullie gebruiken allebei dezelfde waarde.' : peer || invites.connection ? 'Vastgezet zolang speler 2 verbonden is. Beide spelers gebruiken dezelfde waarde.' : 'Wijzigen begint de game opnieuw. Kies de waarde voordat speler 2 verbindt.';
  $('solo-button').hidden = !isHost || !!connected;
  $('solo-button').disabled = stateBusy;
  $('solo-button').textContent = mode === 'paused' && pausedMode === 'solo' ? 'Verder spelen' : mode === 'solo' ? 'Solo opnieuw beginnen' : 'Speel solo';
  $('pause-button').disabled = stateBusy || !core || !['solo', 'online', 'paused'].includes(mode);
  const canSave = canUseSavestates();
  $('export-state-button').disabled = $('import-state-file').disabled = !canSave || stateBusy;
  $('savestate-note').textContent = roomId || peer ? 'Savestates zijn alleen beschikbaar bij solo spelen. Online starten beide spelers gelijk.' : 'Download je speltoestand en laad hem later met dezelfde ROM, emulatorversie en overclock. Bestanden blijven lokaal.';
  $('start-button').disabled = isHost ? !remoteReady || !connected || mode === 'online' : !game || !connected || localReady;
  $('start-button').textContent = isHost ? (mode === 'online' ? 'Samen aan het spelen' : mode === 'paused' && session ? 'Verder spelen →' : 'Start samen →') : (mode === 'online' ? 'Samen aan het spelen' : localReady ? 'Wachten op de host…' : 'Ik ben klaar →');
  $('restart-button').hidden = !isHost || !connected || !remoteReady || !(mode === 'online' || mode === 'paused');
  $('guest-state').textContent = (isHost ? remoteReady : localReady) ? 'Klaar' : connected ? 'Verbonden' : '—';
}
function beginOnline(newEpoch) {
  core.load(game.bytes, game.system, game); audio.clear(); checks.clear(); lastHash = -1;
  epoch = newEpoch; mode = 'online'; pausedMode = null; accumulator = 0; lastTime = 0;
  fpsTime = performance.now(); fpsCount = 0;
  session = new RollbackSession(core, { player: isHost ? 1 : 2,
    send: message => peer.send('input', { ...message, epoch }) });
  $('screen-overlay').hidden = true; $('pause-button').disabled = false;
  $('pause-button').textContent = 'Pauzeren'; $('room-status').textContent = 'Samen aan het spelen';
  $('room-message').textContent = 'Jullie spelen allebei lokaal. De verbinding houdt jullie game gelijk.';
  $('play-mode').textContent = 'Samen · rollback'; $('solo-controls').hidden = true;
  $('game').focus(); updateActions();
}
function pause(send = true) {
  if (!['online', 'solo'].includes(mode)) return;
  pausedMode = mode; mode = 'paused'; audio.clear(); pressed.clear(); touched.clear();
  $('fps-value').textContent = '—';
  overlay('Even pauze.', roomId ? 'De host kan de game weer hervatten.' : 'Klaar voor nog een ronde?');
  $('room-status').textContent = 'Gepauzeerd'; $('pause-button').textContent = 'Verder spelen';
  if (send && pausedMode === 'online') peer.send('control', { type: 'pause', epoch });
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
  $('game').focus(); updateActions();
}
function resetPeer() {
  expectedGame = null; guestLoading = false;
  peer?.close(); peer = null; remoteReady = false; localReady = false;
  $('guest-rom-card').hidden = true; $('guest-rom-file').value = ''; $('ping-value').textContent = '—';
  $('route-value').textContent = 'Niet verbonden';
}
function leaveRoom() {
  stop(); invites.leave(); resetPeer(); connectionStatus(false);
  roomId = null; game = null; core = null; pickedGame = null; isHost = true;
  pressed.clear(); touched.clear();
  $('home').hidden = false; $('room-view').hidden = true;
  $('player-two').textContent = 'Nog een plekje vrij'; $('guest-detail').textContent = 'Nodig je favoriete rivaal uit';
  $('room-message').textContent = 'Je kunt alvast solo spelen.';
  history.replaceState(null, '', location.pathname + location.search);
}
function setupPeer(connection, host) {
  resetPeer();
  if (mode === 'solo') stop();
  peer = new PeerConnection(connection, host);
  const current = peer;
  peer.addEventListener('open', () => {
    if (current !== peer) return;
    stop(); $('route-value').textContent = current.route;
    $('room-message').textContent = host ? 'Speler 2 is verbonden en kiest nu een eigen ROM.' : 'Verbonden. Wachten op de gamegegevens van de host.';
    updateActions();
    if (host) {
      try { current.send('control', createGameConfig(game)); }
      catch (error) { fatal(error); }
    }
  });
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
    if (!current.opened) { if (detail === 'failed' && !host) void invites.fallback(); return; }
    if (detail === 'disconnected' || detail === 'closed') {
      stop('De verbinding met de andere speler is weggevallen. Verlaat de kamer en verbind opnieuw.');
      remoteReady = false; updateActions();
    }
  });
  updateActions(); return peer;
}
function requireLocalRom(message) {
  if (isHost) throw new Error('Alleen de host kiest de game-instellingen.');
  const config = validateGameConfig(message);
  if (expectedGame) {
    if (JSON.stringify(config) !== JSON.stringify(expectedGame)) throw new Error('De game-instellingen zijn veranderd. Verbind opnieuw.');
    return;
  }
  expectedGame = config; game = null; core = null; localReady = false;
  $('guest-rom-file').value = '';
  $('game-title').textContent = config.name;
  $('console-badge').textContent = config.system.toUpperCase() + ' · MESEN · ALPHA';
  $('guest-rom-note').textContent = `Kies jouw ${config.system.toUpperCase()}-ROM voor ${config.name}. De versie, regio en eventuele hack moeten overeenkomen.`;
  $('guest-rom-status').textContent = 'Er wordt geen ROM van de host ontvangen. Jouw bestand blijft op dit apparaat.';
  $('room-message').textContent = 'Kies je eigen ROM. Daarna controleren we of jullie hetzelfde bestand gebruiken.';
  $('room-status').textContent = 'Eigen ROM kiezen';
  overlay('Kies je eigen ROM.', 'Selecteer hetzelfde bestand als de host onder ‘Jouw ROM’.');
  updateActions();
}
async function selectGuestRom(bytes, demo = false) {
  if (isHost || !expectedGame || !peer || guestLoading || localReady || ['online', 'paused'].includes(mode)) return;
  const current = peer, config = expectedGame;
  guestLoading = true; stop(); game = null; core = null; updateActions();
  $('guest-rom-status').textContent = 'Jouw lokale bestand controleren…';
  try {
    await verifyLocalRom(bytes, config);
    const isCurrent = () => current === peer && !current.closed && config === expectedGame && !isHost;
    if (!isCurrent()) return;
    if (!await loadGame(bytes, config.name, demo, config.system, config.overclock, isCurrent)) return;
    showRoom();
    $('guest-rom-status').textContent = 'Jouw ROM komt overeen met die van de host. Er is geen bestand verstuurd.';
    $('room-message').textContent = 'Je eigen ROM is gecontroleerd. Klik op ‘Ik ben klaar’.';
    overlay('Je eigen game staat klaar.', 'Klik op ‘Ik ben klaar’. De host start jullie game.');
    current.send('control', { type: 'game-matched', hash: game.hash, overclock: game.overclock });
  } catch (error) {
    if (current !== peer || config !== expectedGame) return;
    $('guest-rom-status').textContent = error.message;
    $('room-message').textContent = 'Kies een overeenkomende ROM om samen te kunnen starten.';
    report(error);
  } finally {
    if (current === peer) { guestLoading = false; updateActions(); }
  }
}
function handleControl(message) {
  if (!message || typeof message !== 'object') throw new Error('Ongeldig spelbericht.');
  if (message.type === 'ping' && typeof message.time === 'number') return peer.send('control', { type: 'pong', time: message.time });
  if (message.type === 'pong' && typeof message.time === 'number') {
    $('ping-value').textContent = Math.max(0, Math.round(performance.now() - message.time)) + ' ms'; return;
  }
  if (message.type === 'game') { requireLocalRom(message); return; }
  if (message.type === 'game-matched' && isHost) {
    checkGameSettings(message);
    if (message.hash !== game.hash) throw new Error('De ROMs komen niet overeen.');
    $('room-message').textContent = 'Speler 2 heeft dezelfde eigen ROM geladen. Wachten tot speler 2 klaar is.'; return;
  }
  if (message.type === 'ready' && isHost) {
    checkGameSettings(message);
    if (message.hash !== game.hash) throw new Error('De ROMs komen niet overeen.');
    remoteReady = true; $('room-message').textContent = 'Iedereen is klaar. Jij kunt de game starten.'; updateActions(); return;
  }
  if (message.type === 'start' && !isHost && localReady && game) {
    checkGameSettings(message);
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
function checkGameSettings(message) {
  if (message.overclock !== game?.overclock) throw new Error('Jullie CPU-overclock komt niet overeen. Verbind opnieuw met de kamer.');
}
function buttons(map, padIndex = 0, touch = false) {
  if (document.hidden) return 0;
  let bits = 0;
  for (const key of pressed) if (map[key] !== undefined) bits |= 1 << map[key];
  if (touch) for (const b of touched) bits |= 1 << b;
  const pad = [...(navigator.getGamepads?.() || [])].filter(Boolean)[padIndex];
  if (pad) {
    if (game?.system === 'snes') {
      for (const [button, bit] of [[1, 0], [0, 1], [3, 8], [2, 9], [4, 10], [5, 11]]) if (pad.buttons[button]?.pressed) bits |= 1 << bit;
    } else {
      if (pad.buttons[0]?.pressed) bits |= 1;
      if (pad.buttons[1]?.pressed || pad.buttons[2]?.pressed) bits |= 2;
    }
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
  return game?.system === 'snes' ? bits : bits & 255;
}
function loop(time) {
  if (!core || !['solo', 'online'].includes(mode)) { lastTime = time; return; }
  if (!lastTime) lastTime = time;
  accumulator = Math.min(accumulator + time - lastTime, 100); lastTime = time;
  try {
    let count = 0;
    while (accumulator >= 1000 / core.fps && count++ < 5) {
      let advanced = true;
      if (mode === 'online') advanced = session.tick(buttons(keyMap, 0, true));
      else core.run(buttons(keyMap, 0, true), buttons(secondKeys, 1));
      accumulator -= 1000 / core.fps;
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
const playbackClock = new PlaybackClock(loop);

function invitationUrl() {
  const url = new URL(location.href);
  url.hash = new URLSearchParams({ room: roomId, key: invites.secret }).toString();
  return url.href;
}
function connectionStatus(online) {
  $('connection-label').classList.toggle('offline', !online);
  $('connection-label').lastChild.textContent = online ? ' Uitnodigingsdienst verbonden' : ' Alleen via uitnodiging';
}
invites.addEventListener('online', () => connectionStatus(true));
invites.addEventListener('offline', () => {
  connectionStatus(false);
  if (roomId) toast('De uitnodigingsdienst is even weg. Een bestaande spelverbinding blijft actief.');
});
invites.addEventListener('fallback', ({ detail }) => {
  if ($('join-dialog').open) $('join-error').textContent = detail.message;
  if (roomId) { $('route-value').textContent = 'Fallback verbinden…'; $('room-message').textContent = detail.message; }
});
invites.addEventListener('relay-unavailable', () => {
  if (isHost && roomId) toast('Itty Sockets is niet bereikbaar. P2P blijft beschikbaar, maar de fallback werkt nu niet.');
});
invites.addEventListener('error', ({ detail }) => { resetPeer(); report(detail.message); });
invites.addEventListener('rejected', ({ detail }) => {
  stop(); resetPeer();
  if (!isHost) { roomId = null; invites.room = null; $('home').hidden = false; $('room-view').hidden = true; }
  else $('room-message').textContent = 'Verbinding mislukt. Je kunt de link opnieuw delen.';
  report(detail.message); updateActions();
});
invites.addEventListener('created', ({ detail }) => {
  roomId = detail.id; isHost = true;
  launchCommitted = true; setLaunchBusy(false); $('create-dialog').close();
  $('player-one').textContent = nickname; showRoom();
  $('room-message').textContent = 'Je privékamer staat klaar. Deel de uitnodigingslink en houd deze pagina open.';
  $('player-two').textContent = 'Nog een plekje vrij';
});
invites.addEventListener('negotiating', () => { isHost = false; $('join-error').textContent = 'Eerst rechtstreeks verbinden met de host…'; });
invites.addEventListener('joining', ({ detail }) => {
  isHost = false; game = null; roomId = null;
  $('join-error').textContent = 'Verbinding maken met de host…';
  setupPeer(detail.connection, false);
});
invites.addEventListener('joined', ({ detail }) => {
  roomId = detail.id;
  $('join-dialog').close(); $('home').hidden = true; $('room-view').hidden = false;
  $('game-title').textContent = detail.game; $('room-subtitle').textContent = detail.title;
  $('player-one').textContent = detail.host; $('player-two').textContent = nickname;
  $('guest-detail').textContent = 'Jij · controller 2'; $('invite-card').hidden = true;
  $('room-message').textContent = 'Verbonden. Wachten op de gamegegevens van de host.'; $('room-status').textContent = 'Eigen ROM nodig';
  $('solo-controls').hidden = true; $('solo-button').hidden = true;
  overlay('Schuif maar aan.', 'Je kiest zo je eigen ROM. Er worden geen ROM-bestanden gedeeld.');
  peer.approve(); updateActions(); window.scrollTo({ top: 0, behavior: 'instant' });
});
invites.addEventListener('guest-joined', ({ detail }) => {
  $('player-two').textContent = detail.name; $('guest-detail').textContent = 'Gast · controller 2';
  $('room-message').textContent = detail.name + ' schuift aan. Verbinding maken…';
  setupPeer(detail.connection, true);
});
invites.addEventListener('guest-left', () => {
  stop('Speler 2 heeft de kamer verlaten. Je kunt opnieuw iemand uitnodigen.'); resetPeer();
  $('player-two').textContent = 'Nog een plekje vrij'; $('guest-detail').textContent = 'Nodig iemand uit'; updateActions();
});
invites.addEventListener('room-closed', () => { leaveRoom(); toast('De host heeft de kamer gesloten. Vraag om een nieuwe uitnodiging.'); });

function setLaunchBusy(busy) {
  launchBusy = busy;
  for (const id of ['create-submit', 'rom-file', 'choose-demo', 'back-console-button', 'host-overclock']) $(id).disabled = busy;
}
function openCreate(current = false, type = 'room') {
  if (roomId) { toast('Verlaat eerst je huidige kamer.'); return; }
  if (mode === 'solo') pause();
  launchGeneration++; launchMode = type; selectedSystem = null; pickedGame = null;
  currentGameRequested = current && !!game; useCurrentGame = false; launchCommitted = false;
  $('console-picker').hidden = false; $('launch-fields').hidden = true;
  $('launch-eyebrow').textContent = type === 'solo' ? 'EEN POTJE VOOR JEZELF' : 'SAMEN AAN DE START';
  $('launch-heading').textContent = 'Kies je console.';
  $('launch-intro').textContent = type === 'solo' ? 'Speel solo met je eigen game. Waar gaan we op spelen?' : 'Maak een kamer voor twee spelers. Kies eerst je console.';
  $('host-overclock').value = String(currentGameRequested ? game.overclock : 100);
  $('host-name').value = nickname; $('create-error').textContent = ''; $('rom-file').value = '';
  $('room-fields').hidden = type === 'solo';
  $('host-name').required = $('room-title-input').required = type === 'room';
  $('create-submit').textContent = type === 'solo' ? 'Start solo →' : 'Maak een kamer →';
  $('launch-privacy-note').textContent = type === 'solo' ? 'Je speelt lokaal. Je ROM en savestates worden niet geüpload.' : 'Alleen mensen met je uitnodigingslink kunnen meedoen. Beide spelers kiezen hun eigen ROM.';
  setLaunchBusy(false); $('create-dialog').showModal();
}
function chooseConsole(system) {
  if (!['nes', 'snes'].includes(system) || launchBusy) return;
  launchGeneration++; selectedSystem = system; pickedGame = null; $('rom-file').value = '';
  useCurrentGame = currentGameRequested && game?.system === system;
  $('console-picker').hidden = true; $('launch-fields').hidden = false;
  $('launch-heading').textContent = launchMode === 'solo' ? 'Jouw game. Jouw tempo.' : 'Maak het gezellig.';
  $('launch-intro').textContent = `Je kiest ${system.toUpperCase()}. Laad je eigen ROM en stel de emulator in.`;
  $('launch-console').textContent = system === 'snes' ? 'SNES · BETA' : 'NES';
  $('rom-file').accept = system === 'nes' ? '.nes' : '.sfc,.smc';
  $('file-name').textContent = `Kies je ${system.toUpperCase()}-ROM`;
  $('rom-file-hint').textContent = (system === 'nes' ? '.nes' : '.sfc / .smc') + ' · maximaal 8 MB · blijft op jouw apparaat';
  $('choose-demo').hidden = system !== 'nes'; $('game-picker').hidden = useCurrentGame;
  $('current-game-note').hidden = !useCurrentGame; $('create-error').textContent = '';
}
$('solo-home-button').onclick = () => openCreate(false, 'solo');
document.querySelectorAll('[data-console]').forEach(button => button.onclick = () => chooseConsole(button.dataset.console));
$('back-console-button').onclick = () => {
  if (launchBusy) return;
  launchGeneration++; selectedSystem = null; pickedGame = null; useCurrentGame = false;
  $('console-picker').hidden = false; $('launch-fields').hidden = true;
  $('launch-heading').textContent = 'Kies je console.'; $('create-error').textContent = '';
};
$('create-dialog').addEventListener('close', () => {
  launchGeneration++;
  if (launchBusy && !launchCommitted) { invites.leave(); connectionStatus(false); }
  setLaunchBusy(false);
});
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
$('join-dialog').addEventListener('close', () => {
  if (!roomId && !isHost) { invites.leave(); resetPeer(); isHost = true; connectionStatus(false); }
});
$('publish-room-button').onclick = () => openCreate(true);
$('leave-button').onclick = leaveRoom;
$('about-button').onclick = () => $('about-dialog').showModal();
document.querySelectorAll('.brand, .topbar nav a').forEach(link => link.addEventListener('click', () => {
  if (!$('room-view').hidden) leaveRoom();
}));
$('connection-info-button').onclick = () => $('connection-dialog').showModal();
$('reconnect-button').onclick = () => invites.connect().then(() => toast('Uitnodigingsdienst verbonden.')).catch(report);
$('rom-file').onchange = async () => {
  try {
    const file = $('rom-file').files[0]; if (!file) return;
    if (file.size > 8 * 1024 * 1024) throw new Error('De ROM mag maximaal 8 MB zijn.');
    const generation = launchGeneration;
    const bytes = new Uint8Array(await file.arrayBuffer()); const system = cartridgeSystem(bytes, file.name);
    if (generation !== launchGeneration) return;
    if (system !== selectedSystem) throw new Error(`Dit is een ${system.toUpperCase()}-ROM. Kies een ${selectedSystem.toUpperCase()}-ROM of ga terug naar de consolekeuze.`);
    pickedGame = { bytes, name: file.name.replace(/\.(nes|sfc|smc)$/i, ''), demo: false, system };
    $('file-name').textContent = file.name; $('create-error').textContent = '';
  } catch (error) { pickedGame = null; report(error); }
};
$('guest-rom-file').onchange = async () => {
  try {
    const file = $('guest-rom-file').files[0]; if (!file) return;
    if (file.size > 8 * 1024 * 1024) throw new Error('De ROM mag maximaal 8 MB zijn.');
    await selectGuestRom(new Uint8Array(await file.arrayBuffer()));
  } catch (error) { $('guest-rom-status').textContent = error.message; report(error); }
};
$('guest-demo-button').onclick = async () => {
  try { const demo = await demoData(); await selectGuestRom(demo.bytes, true); }
  catch (error) { $('guest-rom-status').textContent = error.message; report(error); }
};
$('choose-demo').onclick = async () => {
  try { const generation = launchGeneration; const demo = await demoData(); if (generation !== launchGeneration || selectedSystem !== 'nes') return; pickedGame = demo; $('file-name').textContent = 'Room Rally · originele NES-demo'; $('rom-file').value = ''; $('create-error').textContent = ''; }
  catch (error) { report(error); }
};
$('create-form').onsubmit = async event => {
  event.preventDefault(); if (launchBusy) return;
  $('create-error').textContent = '';
  const generation = launchGeneration, type = launchMode;
  const isCurrent = () => generation === launchGeneration && $('create-dialog').open;
  try {
    if (!selectedSystem) throw new Error('Kies eerst NES of SNES.');
    if (!useCurrentGame && !pickedGame) throw new Error(`Kies eerst een ${selectedSystem.toUpperCase()}-ROM${selectedSystem === 'nes' ? ' of gebruik onze demo' : ''}.`);
    const values = new FormData(event.target), selected = useCurrentGame ? game : pickedGame;
    if (selected.system !== selectedSystem) throw new Error('De ROM hoort niet bij de gekozen console.');
    setLaunchBusy(true);
    if (type === 'solo') await enableAudio();
    if (!isCurrent()) return;
    if (type === 'room') { nickname = String(values.get('name')).trim(); saveSetting('name', nickname); }
    if (!await loadGame(selected.bytes, selected.name, selected.demo, selected.system, Number(values.get('overclock')), isCurrent)) return;
    if (type === 'solo') {
      isHost = true; roomId = null; launchCommitted = true; setLaunchBusy(false); $('create-dialog').close();
      showRoom(); await startSolo();
    } else await invites.create({ name: nickname, title: values.get('title'), game: game.name });
  } catch (error) { if (isCurrent()) { setLaunchBusy(false); report(error); } }
};
$('join-form').onsubmit = async event => {
  event.preventDefault(); $('join-error').textContent = '';
  try {
    const code = $('join-code').value.trim(); parseInvitation(code);
    nickname = $('guest-name').value.trim(); saveSetting('name', nickname);
    $('join-submit').disabled = true;
    await invites.join(code, nickname);
  } catch (error) { report(error); }
  finally { $('join-submit').disabled = false; }
};
$('demo-button').onclick = async () => {
  try {
    const demo = await demoData(); isHost = true; roomId = null;
    await loadGame(demo.bytes, demo.name, true); showRoom();
    $('room-message').textContent = 'Tik op A om te racen. Speel solo of maak een kamer om samen te testen.';
  } catch (error) { report(error); }
};
async function startSolo() {
  if (!core || !game || stateBusy) return;
  const currentCore = core, currentGame = game;
  await enableAudio();
  if (core !== currentCore || game !== currentGame) return;
  if (mode === 'paused' && pausedMode === 'solo') { resume(); return; }
  core.load(game.bytes, game.system, game); session = null; mode = 'solo'; accumulator = 0; lastTime = 0;
  fpsTime = performance.now(); fpsCount = 0;
  $('screen-overlay').hidden = true; $('pause-button').disabled = false;
  $('pause-button').textContent = 'Pauzeren'; $('room-status').textContent = 'Solo aan het spelen';
  $('game').focus(); $('play-mode').textContent = 'Lokaal · solo'; $('solo-controls').hidden = false; updateActions();
}
$('solo-button').onclick = () => startSolo().catch(fatal);
function canUseSavestates() { return !!core && !!game && isHost && !roomId && !peer && !invites.connection; }
$('export-state-button').onclick = async () => {
  if (!canUseSavestates() || stateBusy) return;
  stateBusy = true; if (mode === 'solo') pause(); updateActions();
  const currentGame = game;
  try {
    const bytes = await encodeSavestate(core.save(), currentGame, MESEN_BUILD);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = savestateFilename(currentGame.name);
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('savestate-status').textContent = 'Savestate gedownload. Bewaar ook je eigen ROM; die blijft nodig om verder te spelen.';
  } catch (error) { $('savestate-status').textContent = error.message; report(error); }
  finally { stateBusy = false; updateActions(); }
};
$('import-state-file').onchange = async () => {
  const file = $('import-state-file').files[0]; $('import-state-file').value = '';
  if (!file || !canUseSavestates() || stateBusy) return;
  const currentCore = core, currentGame = game;
  const isCurrent = () => core === currentCore && game === currentGame && canUseSavestates();
  stateBusy = true; if (mode === 'solo') pause(); updateActions();
  $('savestate-status').textContent = 'Savestate controleren…';
  try {
    if (file.size > MAX_SAVESTATE_FILE) throw new Error('Dit savestatebestand is te groot.');
    const { state } = await decodeSavestate(new Uint8Array(await file.arrayBuffer()), currentGame, MESEN_BUILD);
    if (!isCurrent()) return;
    // Restore into a separate instance. Invalid snapshots cannot damage the active game.
    let preview;
    const candidate = await MesenCore.create({ onFrame: (frame, width, height) => { preview = { frame: frame.slice(), width, height }; } });
    if (!isCurrent()) return;
    candidate.load(currentGame.bytes, currentGame.system, currentGame); candidate.restore(state); candidate.run(0, 0);
    if (!isCurrent()) return;
    candidate.onFrame = draw; candidate.onAudio = (l, r) => audio.push(l, r);
    stop(); core = candidate; session = null; checks.clear(); epoch = null;
    mode = 'paused'; pausedMode = 'solo'; accumulator = 0; lastTime = 0; pressed.clear(); touched.clear();
    draw(preview.frame, preview.width, preview.height);
    $('play-mode').textContent = 'Lokaal · solo'; $('room-status').textContent = 'Savestate geladen';
    $('pause-button').disabled = false; $('pause-button').textContent = 'Verder spelen';
    $('savestate-status').textContent = 'Je voortgang is geladen. Kies ‘Verder spelen’.';
    overlay('Weer waar je was.', 'Je savestate is geladen. Kies ‘Verder spelen’.');
  } catch (error) { if (isCurrent()) { $('savestate-status').textContent = error.message; report(error); } }
  finally { stateBusy = false; updateActions(); }
};
$('room-overclock').onchange = () => {
  if (!game || !isHost || peer || invites.connection || stateBusy) { updateActions(); return; }
  try {
    const overclock = validateOverclock(Number($('room-overclock').value));
    stop(); core.load(game.bytes, game.system, { overclock });
    game.overclock = overclock; localReady = remoteReady = false;
    overlay('CPU-overclock ingesteld.', `${overclock}% CPU-ruimte. Start de game opnieuw om te spelen.`);
    $('room-status').textContent = 'Klaar om te spelen';
    $('room-message').textContent = `CPU-overclock: ${overclock}%. Speler 2 krijgt automatisch dezelfde instelling.`;
    updateActions();
  } catch (error) { fatal(error); updateActions(); }
};
async function startTogether() {
  await enableAudio();
  if (!isHost) {
    localReady = true; peer.send('control', { type: 'ready', hash: game.hash, overclock: game.overclock });
    $('room-message').textContent = 'Je bent klaar. De host kan nu starten.'; updateActions(); return;
  }
  if (!remoteReady || !peer) throw new Error('Wacht tot speler 2 klaar is.');
  if (mode === 'paused' && session) { resume(); return; }
  const nextEpoch = crypto.randomUUID();
  peer.send('control', { type: 'start', epoch: nextEpoch, hash: game.hash, overclock: game.overclock, version: NETPLAY_VERSION });
  beginOnline(nextEpoch);
}
$('start-button').onclick = () => startTogether().catch(report);
$('restart-button').onclick = () => { stop(); startTogether().catch(report); };
$('pause-button').onclick = () => { if (stateBusy) return; try { mode === 'paused' ? resume() : pause(); } catch (error) { report(error); } };
$('audio-button').onclick = async () => { if (audio.enabled) { audio.mute(); updateAudio(); } else await enableAudio(); };
const playPanel = $('play-panel');
let fullscreenControlsTimer;
function applyScreenFit(value) {
  const fit = value === 'fill' ? 'fill' : 'contain';
  playPanel.dataset.screenFit = fit; $('screen-fit').value = fit;
  saveSetting('screen-fit', fit);
  if (fit === 'fill') { clearTimeout(fullscreenControlsTimer); playPanel.classList.remove('fullscreen-controls-visible'); }
  else revealFullscreenControls();
}
applyScreenFit(readSetting('screen-fit'));
$('screen-fit').onchange = event => applyScreenFit(event.target.value);
function revealFullscreenControls() {
  if (document.fullscreenElement !== playPanel || playPanel.dataset.screenFit === 'fill') return;
  playPanel.classList.add('fullscreen-controls-visible');
  clearTimeout(fullscreenControlsTimer);
  fullscreenControlsTimer = setTimeout(() => {
    if (!playPanel.querySelector('.screen-toolbar:focus-within, .game-bottom:focus-within, .touch-controls:focus-within')) {
      playPanel.classList.remove('fullscreen-controls-visible');
    }
  }, 2500);
}
for (const type of ['pointermove', 'pointerdown', 'keydown', 'focusin']) playPanel.addEventListener(type, revealFullscreenControls);
document.addEventListener('fullscreenchange', () => {
  const fullscreen = document.fullscreenElement === playPanel;
  const label = fullscreen ? 'Volledig scherm verlaten' : 'Volledig scherm';
  $('fullscreen-button').setAttribute('aria-label', label); $('fullscreen-button').title = label;
  clearTimeout(fullscreenControlsTimer); playPanel.classList.remove('fullscreen-controls-visible');
  if (fullscreen) { $('game').focus(); revealFullscreenControls(); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.fullscreenElement === playPanel) document.exitFullscreen().catch(() => {});
});
$('fullscreen-button').onclick = async () => {
  try { document.fullscreenElement ? await document.exitFullscreen() : await playPanel.requestFullscreen(); }
  catch { toast('Volledig scherm is hier niet beschikbaar.'); }
};
$('copy-button').onclick = async () => {
  const url = invitationUrl();
  try { await navigator.clipboard.writeText(url); toast('Kamerlink gekopieerd. Tijd om iemand uit te dagen.'); }
  catch { $('invite-link').focus(); $('invite-link').select(); toast('Selecteer en kopieer de link in het tekstvak.'); }
};
document.addEventListener('keydown', event => {
  if ($('room-view').hidden || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (keyMap[event.code] !== undefined || secondKeys[event.code] !== undefined) { event.preventDefault(); pressed.add(event.code); }
});
document.addEventListener('keyup', event => pressed.delete(event.code));
function releaseButtons() {
  pressed.clear(); touched.clear();
  document.querySelectorAll('[data-pad].pressed').forEach(button => button.classList.remove('pressed'));
}
window.addEventListener('blur', releaseButtons);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseButtons();
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
    if (peer.route === 'Itty Sockets') { $('route-value').textContent = 'Itty Sockets'; return; }
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

function init() {
  connectionStatus(false);
  const invitation = new URLSearchParams(location.hash.slice(1));
  if (invitation.get('room')) openJoin(location.href);
}
init();
