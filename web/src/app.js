import {createGamePatcher} from './patcher.js';
import {defaultDosPolicy,validateDosPolicy,nextDosPolicy,canPassDosControl,validDosReturn,DosPolicyFilter} from './dos-policy.js';
import {createDosMenu} from './dos-menu.js';
import {createFullscreenKeyboard} from './fullscreen-keyboard.js';
import {DOS_KEYS} from './dos-input.js';
import {DosLockstepSession} from './dos-lockstep.js';
import {createDosControls} from './dos-controls.js';
import { romHash } from './emulator.js';
import { RollbackSession, NETPLAY_VERSION } from './rollback.js';
import { InviteConnection, PeerConnection, parseInvitation } from './connection.js';
import { AudioSink } from './audio.js';
import { MesenCore, MESEN_BUILD, cartridgeSystem, validateOverclock } from './mesen.js';
import { DosCore, DOS_BUILD, DOS_NETPLAY_AVAILABLE, MAX_DOS_FILE } from './dos.js';
import { encodeSavestate, decodeSavestate, savestateFilename, MAX_SAVESTATE_FILE } from './savestate.js';
import { createGameConfig, validateGameConfig, verifyLocalRom } from './protocol.js';
import { PlaybackClock } from './playback-clock.js';
import { GameStream } from './game-stream.js';
import { createControls } from './controls.js';
import { STREAM_VERSION, StreamInput, playMode as validatePlayMode } from './stream-protocol.js';

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
let playStyle = 'netplay', gameStream = null, streamInfo = null, streamReady = false;
let streamInput = null, streamSequence = 0;
let dosPolicyReceived=false;
let dosPolicy=defaultDosPolicy(),dosAppliedPolicy=dosPolicy,dosFilter=new DosPolicyFilter(dosPolicy);
let dosEscapeKey=readSetting('dos-escape-key')||'';
if(!DOS_KEYS[dosEscapeKey]||/^(Escape|Shift|Control|Alt|Meta|CapsLock|NumLock|ScrollLock)/.test(dosEscapeKey))dosEscapeKey='';
const streamVideo = $('stream-video');
const coreClass = system => system === 'dos' ? DosCore : MesenCore;
const coreBuild = system => system === 'dos' ? DOS_BUILD : MESEN_BUILD;
const consoleBadge = system => system === 'dos' ? 'DOS · DOSBOX PURE · BETA' : system.toUpperCase() + ' · MESEN · ALPHA';
streamVideo.volume = 0.65;
function isStreamGuest() { return playStyle === 'stream' && !isHost; }
function focusGame() { (isStreamGuest() ? streamVideo : $('game')).focus(); }
function closeGameStream() {
  gameStream?.close(); gameStream = null; audio.releaseCapture();
  streamInfo = null; streamReady = false; streamInput = null; streamSequence = 0;
  streamVideo.pause(); streamVideo.srcObject = null; streamVideo.muted = true;
  streamVideo.hidden = true; $('game').hidden = false;
}
const checks = new Map(), pressed = new Set(), touched = new Set();
const controls = createControls({ pressed, touched, release: releaseButtons,
  currentSystem: () => game?.system || selectedSystem || 'nes',
  localCoop: () => mode === 'solo'
});

const dosControls=createDosControls({
  enabled:()=>game?.system==='dos'&&!$('room-view').hidden&&['solo','online'].includes(mode),
  targets:()=>[$('game'),streamVideo],padInput:(player,bits)=>controls.dosPad(player,bits),requestFocus:focusGame,
  escapeKey:()=>dosEscapeKey,openMenu:()=>dosMenu.open()
});

const dosMenu=createDosMenu({
  context:()=>({policy:dosPolicy,applied:dosAppliedPolicy,host:isHost,solo:!roomId,connected:!!peer?.opened,playing:['online','paused','solo'].includes(mode),system:game?.system||expectedGame?.system}),
  change:changeDosPolicy,pass:passDosControl,
  release:()=>{releaseButtons();dosControls.unlock();},
  escape:()=>dosControls.tap('Escape'),exitFullscreen:()=>document.exitFullscreen?.().catch(report),
  escapeKey:()=>dosEscapeKey,setEscapeKey:code=>{dosEscapeKey=code;saveSetting('dos-escape-key',code);}
});
function applyDosPolicy(policy){
  const handoff=policy.mode!==dosAppliedPolicy.mode||policy.owner!==dosAppliedPolicy.owner;
  dosAppliedPolicy=validateDosPolicy(policy);
  if(dosAppliedPolicy.revision>dosPolicy.revision)dosPolicy=dosAppliedPolicy;
  if(handoff){releaseButtons();if(policy.mode==='turns'&&policy.owner!==(isHost?0:1))dosControls.unlock();}
  dosMenu.update();
}
function resetDosSharing(){
  let blocked=[];try{blocked=validateDosPolicy(defaultDosPolicy(JSON.parse(readSetting('dos-reserved-keys')||'[]'))).blocked;}catch{/* Ignore old/invalid preferences. */}
  dosPolicy=defaultDosPolicy(blocked);dosAppliedPolicy=dosPolicy;dosFilter=new DosPolicyFilter(dosPolicy);
  dosMenu.update();
}
function sendDosPolicy(){if(game?.system==='dos'&&isHost&&peer?.opened)peer.send('control',{type:'dos-policy',room:roomId,policy:dosPolicy});}
function changeDosPolicy(change){
  if(!isHost||game?.system!=='dos')return;
  const handoff=change.mode!==undefined&&change.mode!==dosPolicy.mode||change.owner!==undefined&&change.owner!==dosPolicy.owner;
  dosPolicy=nextDosPolicy(dosPolicy,change);saveSetting('dos-reserved-keys',JSON.stringify(dosPolicy.blocked));
  if(!(mode==='online'&&playStyle==='netplay')&&!['solo','online'].includes(mode))dosAppliedPolicy=dosPolicy;
  if(playStyle==='stream'&&handoff)streamInput?.dos.release();
  dosMenu.update();sendDosPolicy();
}
function passDosControl(){
  if(dosPolicy.mode!=='turns'||roomId&&!['online','paused'].includes(mode))return;
  if(!roomId||isHost&&canPassDosControl(dosPolicy,0))changeDosPolicy({owner:1-dosPolicy.owner});
  else if(!isHost&&canPassDosControl(dosPolicy,1))peer?.send('control',{type:'dos-pass',room:roomId,revision:dosPolicy.revision,epoch});
}
function dosFrames(inputs){
  const changed=dosFilter.policy.revision!==dosPolicy.revision;
  const frames=dosFilter.apply(inputs,dosPolicy);
  if(changed)applyDosPolicy(dosPolicy);
  return frames;
}

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
  releaseButtons();dosControls?.unlock();
  mode = 'idle'; session?.close?.();session = null; pausedMode = null; audio.clear();
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
  if (playStyle === 'stream') {
    closeGameStream(); remoteReady = localReady = false;
    $('stream-status').textContent = message; $('room-message').textContent = message; updateActions();
  }
  try { peer?.send('control', { type: 'interrupted', message, epoch }); } catch { /* Disconnected. */ }
}
function showRoom() {
  $('savestate-status').textContent = '';
  $('home').hidden = true; $('room-view').hidden = false;
  $('game-title').textContent = game.name;
  $('console-badge').textContent = consoleBadge(game.system);
  $('dos-controls-guide').hidden = game.system !== 'dos';
  $('game').setAttribute('aria-label', `${game.system.toUpperCase()}-gamescherm`);
  $('snes-touch').hidden = game.system !== 'snes';
  $('console-touch-controls').hidden=game.system==='dos';
  $('dos-session-controls').hidden=game.system!=='dos';
  $('play-panel').dataset.dos=String(game.system==='dos');
  document.querySelectorAll('[data-dos-menu]').forEach(button=>button.hidden=game.system!=='dos');
  controls.guide();
  $('player-one').textContent = isHost ? nickname || 'Jij' : $('player-one').textContent;
  $('solo-controls').hidden = !!roomId;
  $('room-subtitle').textContent = roomId ? 'PRIVÉKAMER · UITNODIGING' : 'SOLO · LOKAAL';
  $('invite-code').hidden = !roomId;
  $('room-code').textContent = roomId ? 'Alleen via jouw link' : '';
  $('invite-link').value = roomId ? invitationUrl() : '';
  $('invite-link').closest('label').hidden = !roomId;
  $('publish-room-button').hidden = !!roomId || !isHost;
  $('invite-card').hidden = !isHost;
  $('invite-description').textContent = roomId ? playStyle === 'stream' ? 'Deel je kamerlink. Je vriend ontvangt beeld en geluid; alleen jij hebt de ROM nodig.' : 'Deel je kamerlink. Je vriend kiest zelf dezelfde ROM op het eigen apparaat.' : 'Maak een kamer om een uitnodigingslink te delen.';
  $('room-status').textContent = 'Klaar om te spelen';
  $('solo-button').textContent = 'Speel solo';
  $('play-mode').textContent = roomId ? playStyle === 'stream' ? 'WebRTC · beeld en geluid' : 'Privékamer · twee spelers' : 'Lokaal · solo';
  $('stream-guest-card').hidden = !isStreamGuest();
  $('game').hidden = isStreamGuest(); streamVideo.hidden = !isStreamGuest();
  $('dos-mouse-button').hidden=game?.system!=='dos';
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
  gameStream?.captureFrame();
}
async function loadGame(bytes, name, demo = false, system = 'nes', overclock = 100, isCurrent = () => true) {
  validateOverclock(overclock);
  if (!['nes', 'snes', 'dos'].includes(system)) throw new Error('Dit systeem wordt nog niet ondersteund.');
  cartridgeSystem(bytes, system === 'dos' ? name : system === 'snes' ? 'game.sfc' : 'game.nes');
  const next = await coreClass(system).create({ onFrame: draw, onAudio: (l, r) => audio.push(l, r) });
  const hash = await romHash(bytes);
  if (!isCurrent()) { next.destroy?.(); return false; }
  next.load(bytes, system, { overclock, name });
  stop(); core?.destroy?.(); core = next;
  game = { bytes, name: String(name).slice(0, 80), demo, system, overclock, hash };
  if(isHost)resetDosSharing();
  audio.clear();
  for (let i = 0; i < 6; i++) core.run(0, 0);
  audio.clear(); core.load(bytes, system, { overclock, name });
  overlay('Klaar voor de start.', 'Start solo of nodig een vriend uit.');
  $('rollback-value').textContent = '0'; $('fps-value').textContent = '—';
  return true;
}
async function demoData(system = 'nes') {
  const response = await fetch(new URL(system === 'dos' ? '../assets/dos-duo.com' : '../assets/room-rally.nes', import.meta.url));
  if (!response.ok) throw new Error('De demo kon niet worden geladen.');
  return { bytes: new Uint8Array(await response.arrayBuffer()), name: system === 'dos' ? 'DOS Duo.com' : 'Room Rally', demo: true, system };
}
async function enableAudio() {
  try { await audio.enable(); updateAudio(); }
  catch { toast('Geluid is hier niet beschikbaar. Je kunt zonder geluid verder spelen.'); }
}
function updateAudio() {
  const enabled = isStreamGuest() ? !streamVideo.muted : audio.enabled;
  const text = enabled ? 'Geluid uitzetten' : 'Geluid aanzetten';
  $('audio-button').setAttribute('aria-label', text); $('audio-button').title = text;
  $('audio-button').textContent = enabled ? '♫' : '♪';
}
function updateActions() {
  dosMenu.update();
  $('overclock-description').textContent = game?.system === 'dos' ? 'DOS: 100% is 3000 CPU-cycles; 500% is 15000. Een hoger CPU-budget kan een DOS-game versnellen. Compatibiliteit verschilt per spel.' : 'Meer CPU-tijd per frame kan slowdown in ROM-hacks verminderen. De game blijft op normale snelheid. Hogere waarden vragen meer van je apparaat en kunnen gamebugs veroorzaken.';
  playbackClock.setRunning((!!core || isStreamGuest() && streamReady) && ['solo', 'online'].includes(mode));
  const connected = peer?.opened && peer?.control?.readyState === 'open';
  $('guest-rom-card').hidden = isHost || !expectedGame;
  $('guest-rom-file').disabled = guestLoading || localReady || mode === 'online' || mode === 'paused';
  $('guest-demo-button').hidden = !expectedGame?.demo;
  $('guest-demo-button').textContent = expectedGame?.system === 'dos' ? 'Gebruik DOS Duo-demo' : 'Gebruik Room Rally-demo';
  $('guest-demo-button').disabled = $('guest-rom-file').disabled;
  $('room-overclock').value = String(game?.overclock ?? expectedGame?.overclock ?? 100);
  $('room-overclock').disabled = !game || !isHost || !!peer || !!invites.connection || stateBusy;
  $('overclock-note').textContent = playStyle === 'stream' && roomId ? 'Deze CPU-instelling geldt voor de emulator bij de host. Speler 2 ontvangt de stream.' : !isHost ? 'De host kiest deze instelling. Jullie gebruiken allebei dezelfde waarde.' : peer || invites.connection ? 'Vastgezet zolang speler 2 verbonden is. Beide spelers gebruiken dezelfde waarde.' : 'Wijzigen begint de game opnieuw. Kies de waarde voordat speler 2 verbindt.';
  $('solo-button').hidden = !isHost || !!connected;
  $('solo-button').disabled = stateBusy;
  $('solo-button').textContent = mode === 'paused' && pausedMode === 'solo' ? 'Verder spelen' : mode === 'solo' ? 'Solo opnieuw beginnen' : 'Speel solo';
  $('pause-button').disabled = stateBusy || !(core || isStreamGuest() && streamReady) || !['solo', 'online', 'paused'].includes(mode);
  const canSave = canUseSavestates();
  $('export-state-button').disabled = $('import-state-file').disabled = !canSave || stateBusy;
  $('savestate-note').textContent = game?.system === 'dos' ? 'DOS-savestates en export van in-game saves zijn nog niet vrijgegeven. Je voortgang gaat verloren wanneer je de game sluit.' : roomId || peer ? 'Savestates zijn alleen beschikbaar bij solo spelen. Online starten beide spelers gelijk.' : 'Download je speltoestand en laad hem later met dezelfde ROM, emulatorversie en overclock. Bestanden blijven lokaal.';
  $('start-button').disabled = isHost ? !remoteReady || !connected || mode === 'online' : !game || !connected || localReady || isStreamGuest() && !streamReady;
  $('start-button').textContent = isHost ? (mode === 'online' ? 'Samen aan het spelen' : mode === 'paused' && (session || playStyle === 'stream') ? 'Verder spelen →' : 'Start samen →') : (mode === 'online' ? 'Samen aan het spelen' : localReady ? 'Wachten op de host…' : 'Ik ben klaar →');
  $('restart-button').hidden = !isHost || !connected || !remoteReady || !(mode === 'online' || mode === 'paused');
  $('guest-state').textContent = (isHost ? remoteReady : localReady) ? 'Klaar' : connected ? 'Verbonden' : '—';
}
function beginOnline(newEpoch) {
  core.load(game.bytes, game.system, game); audio.clear(); checks.clear(); lastHash = -1;
  dosAppliedPolicy=dosPolicy;
  epoch = newEpoch; mode = 'online'; pausedMode = null; accumulator = 0; lastTime = 0;
  fpsTime = performance.now(); fpsCount = 0;
  dosControls.reset();
  session = game.system==='dos'?new DosLockstepSession({core,player:isHost?0:1,policy:dosPolicy,getPolicy:()=>dosPolicy,onPolicy:applyDosPolicy,send:message=>peer.send('input',{...message,epoch})}):new RollbackSession(core, { player: isHost ? 1 : 2,
    send: message => peer.send('input', { ...message, epoch }) });
  $('screen-overlay').hidden = true; $('pause-button').disabled = false;
  $('pause-button').textContent = 'Pauzeren'; $('room-status').textContent = 'Samen aan het spelen';
  $('room-message').textContent = game.system==='dos'?'Experimenteel DOS: ieder emuleert lokaal met 6 frames invoerbuffer. Bij vertraging wacht het spel; er is geen rollback.':'Jullie spelen allebei lokaal. De verbinding houdt jullie game gelijk.';
  $('play-mode').textContent = game.system==='dos'?'Samen · DOS-invoerbuffer':'Samen · rollback'; $('solo-controls').hidden = true;
  $('game').focus(); updateActions();
}
function pause(send = true) {
  if (!['online', 'solo'].includes(mode)) return;
  pausedMode = mode; mode = 'paused'; audio.clear(); releaseButtons();dosControls.unlock();
  if (streamInput) { streamInput.buttons = 0; streamInput.received = -Infinity; }
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
  focusGame(); updateActions();
}
function resetPeer() {
  closeGameStream();
  expectedGame = null; guestLoading = false;
  peer?.close(); peer = null; remoteReady = false; localReady = false;
  $('guest-rom-card').hidden = true; $('guest-rom-file').value = ''; $('ping-value').textContent = '—';
  $('route-value').textContent = 'Niet verbonden';
}
function leaveRoom() {
  stop(); resetPeer(); invites.leave(); connectionStatus(false); playStyle = 'netplay';
  core?.destroy?.();
  $('stream-guest-card').hidden = true;
  roomId = null; game = null; core = null; pickedGame = null; isHost = true;
  pressed.clear(); touched.clear();dosControls?.release();
  $('dos-menu-dialog').close();resetDosSharing();fullscreenKeyboard.release();
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
      try {
        if (playStyle === 'stream') {
          streamInfo = { type: 'stream-game', version: STREAM_VERSION, token: crypto.randomUUID(), name: game.name, system: game.system, overclock: game.overclock };
          gameStream = makeGameStream(true, streamInfo.token);
          current.send('control', streamInfo);
          $('room-message').textContent = 'Speler 2 is verbonden. Beeld en geluid worden voorbereid; er is geen ROM nodig bij de gast.';
        } else current.send('control', createGameConfig(game));
        sendDosPolicy();
      }
      catch (error) { fatal(error); }
    }
  });
  peer.addEventListener('input', ({ detail }) => {
    if (current === peer && playStyle === 'stream' && isHost && detail?.type === 'stream-input' &&
        detail.token === streamInfo?.token && mode === 'online') { try{streamInput?.receive(detail);}catch(error){fatal(error);} return; }
    if (current !== peer || detail?.epoch !== epoch || !session || !['input','dos-input'].includes(detail.type)) return;
    if((game?.system==='dos')!==(detail.type==='dos-input'))return;
    try { session.receive(detail.frame, detail.type==='dos-input'?detail.dos:detail.buttons,detail.policy); } catch (error) { fatal(error); }
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
  if (config.system === 'dos' && !DOS_NETPLAY_AVAILABLE) throw new Error('Samen emuleren met DOS is nog niet vrijgegeven. Vraag de host om een DOS-streamkamer te maken.');
  if (expectedGame) {
    if (JSON.stringify(config) !== JSON.stringify(expectedGame)) throw new Error('De game-instellingen zijn veranderd. Verbind opnieuw.');
    return;
  }
  expectedGame = config; game = null; core = null; localReady = false;
  $('guest-rom-file').value = '';
  $('guest-rom-file').accept = config.system === 'dos' ? '.zip,.dosz,.com,.exe,.bat' : config.system === 'snes' ? '.sfc,.smc' : '.nes';
  $('guest-file-description').textContent = config.system === 'dos' ? '.zip / .dosz / .com / .exe / .bat · maximaal 32 MB · geen bestandsoverdracht' : config.system === 'snes' ? '.sfc / .smc · maximaal 8 MB · geen bestandsoverdracht' : '.nes · maximaal 8 MB · geen bestandsoverdracht';
  $('game-title').textContent = config.name;
  $('console-badge').textContent = consoleBadge(config.system);
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
function makeGameStream(host, token) {
  const media = new GameStream({ endpoint: invites.endpoint, connection: peer.connection, host, token });
  media.addEventListener('error', ({ detail }) => { if (gameStream === media) fatal(detail); });
  media.addEventListener('status', ({ detail }) => {
    if (gameStream === media && (!streamReady || detail.stage === 'recovering' || detail.stage === 'playing')) $('stream-status').textContent = detail.message;
  });
  media.addEventListener('stream', ({ detail }) => {
    if (gameStream !== media || !isStreamGuest()) return;
    streamVideo.srcObject = detail;
    streamVideo.hidden = false; $('game').hidden = true;
    const ready = () => {
      if (gameStream !== media || streamVideo.readyState < 2 || !detail.getVideoTracks().length || !detail.getAudioTracks().length || streamReady) return;
      streamReady = true; media.ready();
      $('stream-status').textContent = 'Beeld en geluid zijn verbonden. Kies ‘Ik ben klaar’ om je controller en geluid te activeren.';
      $('room-status').textContent = 'Stream verbonden';
      overlay('Je plek staat klaar.', 'Je hebt geen ROM nodig. Kies ‘Ik ben klaar’; de host start de game.');
      updateActions();
    };
    const events = ['loadeddata', 'loadedmetadata', 'canplay', 'playing'];
    events.forEach(event => streamVideo.addEventListener(event, ready)); detail.addEventListener('addtrack', ready);
    media.playbackCleanup = () => {
      events.forEach(event => streamVideo.removeEventListener(event, ready));
      detail.removeEventListener('addtrack', ready); streamVideo.onerror = null;
    };
    streamVideo.onerror = () => { if (gameStream === media) fatal('De browser kan deze videostream niet afspelen.'); };
    streamVideo.play().then(ready).catch(() => {
      if (gameStream === media) $('stream-status').textContent = 'Klik op het gamescherm om de stream te starten.';
    });
  });
  return media;
}
function requireStream(message) {
  if (!isStreamGuest() || !peer || peer.connection.relay) throw new Error('De stream hoort niet bij deze kamer.');
  if (streamInfo) {
    if (JSON.stringify(streamInfo) !== JSON.stringify(message)) throw new Error('De streaminstellingen zijn veranderd. Verbind opnieuw.');
    return;
  }
  streamInfo = message; core = null; expectedGame = null;
  game = { name: message.name, system: message.system, overclock: message.overclock, demo: false };
  gameStream = makeGameStream(false, message.token);
  showRoom(); updateAudio();
  $('room-status').textContent = 'Stream verbinden…';
  $('stream-status').textContent = 'Beeld en geluid verbinden via WebRTC…';
  $('room-message').textContent = 'De host draait de emulator. Jouw controller bedient speler 2.';
  overlay('Het beeld komt eraan.', 'Beeld en geluid komen rechtstreeks van de host. Je hoeft geen ROM te kiezen.');
  peer.send('control', { type: 'stream-watch', token: message.token });
}
async function sendGameStream() {
  const current = peer, media = gameStream;
  if (!isHost || playStyle !== 'stream' || !media || media.call) return;
  try {
    const sound = await audio.capture();
    if (current !== peer || media !== gameStream || media.closed) { if (!gameStream) audio.releaseCapture(); return; }
    if (!media.call) media.start($('game'), sound);
  } catch (error) { if (current === peer && media === gameStream) fatal(error); }
}
function beginStreaming(newEpoch) {
  epoch = newEpoch; session = null; streamSequence = 0;dosControls.reset();
  dosFilter=new DosPolicyFilter(dosPolicy);dosAppliedPolicy=dosPolicy;
  if (isHost) { core.load(game.bytes, game.system, game); audio.clear(); streamInput = new StreamInput(epoch); }
  mode = 'online'; pausedMode = null; accumulator = 0; lastTime = 0;
  fpsTime = performance.now(); fpsCount = 0;
  $('screen-overlay').hidden = true; $('pause-button').textContent = 'Pauzeren';
  $('room-status').textContent = 'Samen aan het spelen'; $('play-mode').textContent = 'WebRTC · beeld en geluid';
  $('room-message').textContent = isHost ? 'Jij draait de game. Speler 2 ontvangt jouw beeld en geluid en stuurt knoppen terug.' : 'Je bestuurt speler 2 op de emulator van de host. Er is geen ROM-bestand ontvangen.';
  if (isStreamGuest()) { $('stream-status').textContent = 'Je ontvangt live beeld en geluid. Je knoppen besturen speler 2.'; $('fps-value').textContent = 'Live video'; }
  focusGame(); updateActions();
}
invites.addEventListener('call', ({ detail }) => {
  if (!gameStream || !isStreamGuest()) detail.call.close();
  else gameStream.accept(detail.call);
});
streamVideo.onclick = () => { if (isStreamGuest()) streamVideo.play().catch(report); };
function handleControl(message) {
  if (!message || typeof message !== 'object') throw new Error('Ongeldig spelbericht.');
  if (message.type === 'ping' && typeof message.time === 'number') return peer.send('control', { type: 'pong', time: message.time });
  if (message.type === 'pong' && typeof message.time === 'number') {
    $('ping-value').textContent = Math.max(0, Math.round(performance.now() - message.time)) + ' ms'; return;
  }
  if(message.type==='dos-policy'){
    if(isHost||message.room!==roomId||!['dos'].includes(game?.system||expectedGame?.system))throw new Error('Deze DOS-toetsverdeling hoort niet bij de host.');
    const next=validateDosPolicy(message.policy);
    if(next.revision<dosPolicy.revision)return;
    if(next.revision===dosPolicy.revision&&JSON.stringify(next)!==JSON.stringify(dosPolicy)&&dosPolicyReceived)throw new Error('Tegenstrijdige DOS-toetsverdeling.');
    dosPolicy=next;dosPolicyReceived=true;
    if(playStyle==='stream'||!session)applyDosPolicy(dosPolicy);
    dosMenu.update();return;
  }
  if(message.type==='dos-pass'){
    if(!isHost||game?.system!=='dos'||message.room!==roomId)throw new Error('Ongeldige overdracht van DOS-besturing.');
    if(validDosReturn(dosPolicy,message,epoch)&&['online','paused'].includes(mode))changeDosPolicy({owner:0});
    return;
  }
  if (message.type === 'stream-game') { requireStream(message); return; }
  if (message.type.startsWith('stream-')) {
    if (playStyle !== 'stream' || message.token !== streamInfo?.token) throw new Error('De streamsessie komt niet overeen.');
    if (message.type === 'stream-watch' && isHost) { void sendGameStream(); return; }
    if (message.type === 'stream-ready' && isHost && gameStream?.call) {
      remoteReady = true; gameStream.ready(); $('room-message').textContent = 'Speler 2 ontvangt de stream en is klaar. Je kunt starten.'; updateActions(); return;
    }
    if (message.type === 'stream-start' && !isHost && localReady && streamReady) { beginStreaming(message.epoch); return; }
    throw new Error('Onverwacht streambericht.');
  }
  if (message.type === 'game') { if (playStyle !== 'netplay') throw new Error('Deze kamer gebruikt een stream.'); requireLocalRom(message); return; }
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
    if (playStyle === 'stream') {
      closeGameStream(); remoteReady = localReady = false;
      const message = 'De stream is onderbroken bij de andere speler. Verlaat de kamer en verbind opnieuw.';
      stop(message); $('stream-status').textContent = message; updateActions();
    } else stop('De game is onderbroken bij de andere speler. De host kan opnieuw starten.');
    return;
  }
}
function checkGameSettings(message) {
  if (message.overclock !== game?.overclock) throw new Error('Jullie CPU-overclock komt niet overeen. Verbind opnieuw met de kamer.');
}

function loop(time) {
  if (isStreamGuest()) {
    if (mode !== 'online' || !streamReady || !streamInfo) { lastTime = time; return; }
    if (time - lastTime < 1000 / 60) return;
    lastTime = time;
    try {const dos=game?.system==='dos',buttons=controls.buttons(0,true,!dos);peer.send('input',{type:'stream-input',token:streamInfo.token,epoch,sequence:streamSequence++,buttons,...(dos?{dos:dosControls.packet(0,buttons)}:{})});}
    catch (error) { fatal(error); }
    return;
  }
  if (!core || !['solo', 'online'].includes(mode)) { lastTime = time; return; }
  if (!lastTime) lastTime = time;
  accumulator = Math.min(accumulator + time - lastTime, 100); lastTime = time;
  try {
    let count = 0;
    while (accumulator >= 1000 / core.fps && count++ < 5) {
      let advanced = true;
      if (mode === 'online' && playStyle === 'stream') {const dos=game.system==='dos',p1=controls.buttons(0,true,!dos),p2=streamInput.current();if(dos)core.run(0,0,false,dosFrames([dosControls.frame(0,p1),streamInput.dosCurrent()]));else core.run(p1,p2);}
      else if (mode === 'online') advanced = game.system==='dos'?session.tick(()=>dosControls.frame(0,controls.buttons(0,true,false))):session.tick(controls.buttons(0, true));
      else {const dos=game.system==='dos',p1=controls.buttons(0,true,!dos),p2=controls.buttons(1,false,!dos);if(dos)core.run(0,0,false,dosFrames([dosControls.frame(0,p1),dosControls.frame(1,p2)]));else core.run(p1,p2);}
      accumulator -= 1000 / core.fps;
      if (advanced) fpsCount++;
      else { accumulator = 0; break; }
    }
    audio.flush();
    if (mode === 'online' && playStyle === 'netplay') {
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
  url.hash = new URLSearchParams({ room: roomId, key: invites.secret, mode: playStyle, ...(invites.relayRoom?.address ? { tc: invites.relayRoom.address } : {}), ...(game?.system === 'dos' ? { direct: '1' } : {}) }).toString();
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
  if (isHost && roomId) toast('Tailcat is niet bereikbaar. P2P blijft beschikbaar, maar de fallback werkt nu niet.');
});
invites.addEventListener('error', ({ detail }) => { resetPeer(); report(detail.message); });
invites.addEventListener('rejected', ({ detail }) => {
  stop(); resetPeer();
  if (!isHost) { roomId = null; invites.room = null; $('home').hidden = false; $('room-view').hidden = true; }
  else $('room-message').textContent = 'Verbinding mislukt. Je kunt de link opnieuw delen.';
  report(detail.message); updateActions();
});
invites.addEventListener('created', ({ detail }) => {
  roomId = detail.id; isHost = true; playStyle = detail.playMode;
  launchCommitted = true; setLaunchBusy(false); $('create-dialog').close();
  $('player-one').textContent = nickname; showRoom();
  $('room-message').textContent = 'Je privékamer staat klaar. Deel de uitnodigingslink en houd deze pagina open.' + (playStyle === 'netplay' && game?.system !== 'dos' && !invites.relayRoom ? ' Tailcat is nu niet bereikbaar; alleen rechtstreeks verbinden is beschikbaar.' : '');
  $('player-two').textContent = 'Nog een plekje vrij';
});
invites.addEventListener('negotiating', () => { isHost = false; $('join-error').textContent = 'Eerst rechtstreeks verbinden met de host…'; });
invites.addEventListener('joining', ({ detail }) => {
  isHost = false; game = null; roomId = null;dosPolicyReceived=false;dosPolicy=defaultDosPolicy();dosAppliedPolicy=dosPolicy;
  $('join-error').textContent = 'Verbinding maken met de host…';
  setupPeer(detail.connection, false);
});
invites.addEventListener('joined', ({ detail }) => {
  roomId = detail.id; playStyle = detail.playMode;
  $('join-dialog').close(); $('home').hidden = true; $('room-view').hidden = false;
  $('game-title').textContent = detail.game; $('room-subtitle').textContent = detail.title;
  $('player-one').textContent = detail.host; $('player-two').textContent = nickname;
  $('guest-detail').textContent = 'Jij · controller 2'; $('invite-card').hidden = true;
  $('room-message').textContent = 'Verbonden. Wachten op de gamegegevens van de host.'; $('room-status').textContent = playStyle === 'stream' ? 'Stream verbinden…' : 'Eigen ROM nodig';
  $('solo-controls').hidden = true; $('solo-button').hidden = true;
  overlay('Schuif maar aan.', playStyle === 'stream' ? 'De host streamt beeld en geluid. Je hebt geen ROM nodig.' : 'Je kiest zo je eigen ROM. Er worden geen ROM-bestanden gedeeld.');
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
  $('play-mode-settings-button').disabled = busy;
  document.querySelectorAll('input[name="playMode"]').forEach(input => input.disabled = busy || input.value === 'netplay' && selectedSystem === 'dos' && !DOS_NETPLAY_AVAILABLE && launchMode !== 'solo');
}
function selectedPlayMode() { return launchMode === 'solo' ? 'netplay' : validatePlayMode(document.querySelector('input[name="playMode"]:checked').value); }
function updatePlayModeChoice() {
  const unavailable = selectedSystem === 'dos' && !DOS_NETPLAY_AVAILABLE && launchMode !== 'solo';
  const netplayChoice = document.querySelector('input[name="playMode"][value="netplay"]');
  netplayChoice.disabled = unavailable;
  if (unavailable) document.querySelector('input[name="playMode"][value="stream"]').checked = true;
  const streaming = selectedPlayMode() === 'stream';
  $('play-mode-summary').textContent = streaming ? 'Beeld en geluid streamen · alleen de host heeft de ROM nodig' : selectedSystem==='dos'?'Experimenteel samen emuleren · 6 frames invoerbuffer · eigen gamebestanden':'Samen emuleren · ieder zijn eigen ROM';
  $('launch-privacy-note').textContent = launchMode === 'solo' ? 'Je speelt lokaal. Je ROM en savestates worden niet geüpload.' : streaming ? 'Alleen jij laadt de ROM. Je vriend ontvangt gamebeeld en gamegeluid en stuurt knoppen terug. Geen camera, microfoon of ROM-overdracht.' : 'Alleen mensen met je uitnodigingslink kunnen meedoen. Beide spelers kiezen hun eigen ROM.';
  $('dos-limit-note').hidden = selectedSystem !== 'dos';
}
$('play-mode-settings-button').onclick = () => {
  const visible = $('play-mode-settings').hidden;
  $('play-mode-settings').hidden = !visible; $('play-mode-settings-button').setAttribute('aria-expanded', String(visible));
};
document.querySelectorAll('input[name="playMode"]').forEach(input => input.onchange = updatePlayModeChoice);
function openCreate(current = false, type = 'room') {
  if (roomId) { toast('Verlaat eerst je huidige kamer.'); return; }
  if (mode === 'solo') pause();
  launchGeneration++; launchMode = type; selectedSystem = null; pickedGame = null;
  currentGameRequested = current && !!game; useCurrentGame = false; launchCommitted = false;
  $('console-picker').hidden = false; $('launch-fields').hidden = true;
  $('play-mode-settings-button').hidden = $('play-mode-summary').hidden = type === 'solo';
  $('play-mode-settings').hidden = true; $('play-mode-settings-button').setAttribute('aria-expanded', 'false');
  document.querySelector('input[name="playMode"][value="netplay"]').checked = true;
  $('launch-eyebrow').textContent = type === 'solo' ? 'EEN POTJE VOOR JEZELF' : 'SAMEN AAN DE START';
  $('launch-heading').textContent = 'Kies je console.';
  $('launch-intro').textContent = type === 'solo' ? 'Speel solo met je eigen game. Waar gaan we op spelen?' : 'Maak een kamer voor twee spelers. Kies eerst je console.';
  $('host-overclock').value = String(currentGameRequested ? game.overclock : 100);
  $('host-name').value = nickname; $('create-error').textContent = ''; $('rom-file').value = '';
  $('room-fields').hidden = type === 'solo';
  $('host-name').required = $('room-title-input').required = type === 'room';
  $('create-submit').textContent = type === 'solo' ? 'Start solo →' : 'Maak een kamer →';
  updatePlayModeChoice();
  setLaunchBusy(false); $('create-dialog').showModal();
}
function chooseConsole(system) {
  if (!['nes', 'snes', 'dos'].includes(system) || launchBusy) return;
  launchGeneration++; selectedSystem = system; pickedGame = null; $('rom-file').value = '';
  useCurrentGame = currentGameRequested && game?.system === system;
  if(system==='dos'&&launchMode!=='solo')document.querySelector('input[name="playMode"][value="stream"]').checked=true;
  $('console-picker').hidden = true; $('launch-fields').hidden = false;
  $('launch-heading').textContent = launchMode === 'solo' ? 'Jouw game. Jouw tempo.' : 'Maak het gezellig.';
  $('launch-intro').textContent = `Je kiest ${system.toUpperCase()}. Laad je eigen ${system === 'dos' ? 'gamebestanden' : 'ROM'} en stel de emulator in.`;
  $('host-overclock-note').textContent = system === 'dos' ? 'DOS gebruikt 3000 CPU-cycles bij 100%, tot 15000 bij 500%. De juiste snelheid verschilt per game; hoger kan het spel versnellen.' : '100% is standaard. Meer CPU-tijd kan slowdown verminderen en vraagt meer van je apparaat. Niet iedere game werkt goed met overclocking.';
  $('launch-console').textContent = system === 'dos' ? 'DOS · EXPERIMENTEEL' : system === 'snes' ? 'SNES · BETA' : 'NES';
  $('rom-file').accept = system === 'dos' ? '.zip,.dosz,.exe,.com,.bat' : system === 'nes' ? '.nes' : '.sfc,.smc';
  $('file-name').textContent = system === 'dos' ? 'Kies je DOS-game' : `Kies je ${system.toUpperCase()}-ROM`;
  $('rom-file-hint').textContent = system === 'dos' ? 'Complete game als ZIP, of .exe / .com / .bat · maximaal 32 MB · blijft lokaal' : (system === 'nes' ? '.nes' : '.sfc / .smc') + ' · maximaal 8 MB · blijft op jouw apparaat';
  updatePlayModeChoice();
  $('choose-demo').hidden = system === 'snes';
  $('choose-demo').textContent = system === 'dos' ? 'Of probeer DOS Duo, onze eigen DOS-demo ↗' : 'Of gebruik Room Rally, onze eigen demo ↗';
  $('game-picker').hidden = useCurrentGame;
  $('current-game-note').hidden = !useCurrentGame; $('create-error').textContent = '';
}
$('solo-home-button').onclick = () => openCreate(false, 'solo');
document.querySelectorAll('[data-console]').forEach(button => button.onclick = () => chooseConsole(button.dataset.console));
$('back-console-button').onclick = () => {
  if (launchBusy) return;
  launchGeneration++; selectedSystem = null; pickedGame = null; useCurrentGame = false;
  $('console-picker').hidden = false; $('launch-fields').hidden = true;
  $('launch-heading').textContent = 'Kies je console.'; $('create-error').textContent = '';
  updatePlayModeChoice();
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
    if (file.size > (selectedSystem === 'dos' ? MAX_DOS_FILE : 8 * 1024 * 1024)) throw new Error('Dit gamebestand is te groot. DOS: maximaal 32 MB; NES/SNES: maximaal 8 MB.');
    const generation = launchGeneration;
    const bytes = new Uint8Array(await file.arrayBuffer()); const system = cartridgeSystem(bytes, file.name);
    if (generation !== launchGeneration) return;
    if (system !== selectedSystem) throw new Error(`Dit is een ${system.toUpperCase()}-ROM. Kies een ${selectedSystem.toUpperCase()}-ROM of ga terug naar de consolekeuze.`);
    pickedGame = { bytes, name: file.name.replace(/\.(nes|sfc|smc)$/i, '').slice(0,80), demo: false, system };
    $('file-name').textContent = file.name; $('create-error').textContent = '';
  } catch (error) { pickedGame = null; report(error); }
};
$('guest-rom-file').onchange = async () => {
  try {
    const file = $('guest-rom-file').files[0]; if (!file) return;
    if (file.size > (expectedGame?.system === 'dos' ? MAX_DOS_FILE : 8 * 1024 * 1024)) throw new Error('Dit gamebestand is te groot.');
    await selectGuestRom(new Uint8Array(await file.arrayBuffer()));
  } catch (error) { $('guest-rom-status').textContent = error.message; report(error); }
};
$('guest-demo-button').onclick = async () => {
  try { const demo = await demoData(expectedGame?.system); await selectGuestRom(demo.bytes, true); }
  catch (error) { $('guest-rom-status').textContent = error.message; report(error); }
};
$('choose-demo').onclick = async () => {
  try { const generation = launchGeneration, system = selectedSystem; const demo = await demoData(system); if (generation !== launchGeneration || selectedSystem !== system) return; pickedGame = demo; $('file-name').textContent = system === 'dos' ? 'DOS Duo · originele DOS-demo' : 'Room Rally · originele NES-demo'; $('rom-file').value = ''; $('create-error').textContent = ''; }
  catch (error) { report(error); }
};
$('create-form').onsubmit = async event => {
  event.preventDefault(); if (launchBusy) return;
  $('create-error').textContent = '';
  const generation = launchGeneration, type = launchMode;
  const isCurrent = () => generation === launchGeneration && $('create-dialog').open;
  try {
    if (!selectedSystem) throw new Error('Kies eerst NES, SNES of DOS.');
    if (!useCurrentGame && !pickedGame) throw new Error(`Kies eerst een ${selectedSystem.toUpperCase()}-ROM${selectedSystem === 'nes' ? ' of gebruik onze demo' : ''}.`);
    const values = new FormData(event.target), selected = useCurrentGame ? game : pickedGame;
    if (selected.system !== selectedSystem) throw new Error('De ROM hoort niet bij de gekozen console.');
    setLaunchBusy(true);
    const chosenPlayMode = type === 'solo' ? 'netplay' : validatePlayMode(values.get('playMode'));
    if (type === 'room' && selectedSystem === 'dos' && chosenPlayMode === 'netplay' && !DOS_NETPLAY_AVAILABLE) throw new Error('DOS samen emuleren is nog niet beschikbaar. Kies beeld en geluid streamen.');
    if (chosenPlayMode === 'stream' && (typeof $('game').captureStream !== 'function' || typeof MediaStream === 'undefined' || typeof RTCPeerConnection === 'undefined')) {
      throw new Error('Deze browser ondersteunt het streamen van gamebeeld niet. Kies samen emuleren of gebruik een browser met WebRTC en canvas-capture.');
    }
    if (type === 'solo' || chosenPlayMode === 'stream') await enableAudio();
    if (!isCurrent()) return;
    if (type === 'room') { nickname = String(values.get('name')).trim(); saveSetting('name', nickname); }
    if (!await loadGame(selected.bytes, selected.name, selected.demo, selected.system, Number(values.get('overclock')), isCurrent)) return;
    playStyle = chosenPlayMode;
    if (type === 'solo') {
      isHost = true; roomId = null; launchCommitted = true; setLaunchBusy(false); $('create-dialog').close();
      showRoom(); await startSolo();
    } else await invites.create({ name: nickname, title: values.get('title'), game: game.name, playMode: chosenPlayMode, directOnly: game.system === 'dos' });
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
    const demo = await demoData(); isHost = true; roomId = null; playStyle = 'netplay';
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
  dosFilter=new DosPolicyFilter(dosPolicy);dosAppliedPolicy=dosPolicy;
  dosControls.reset();core.load(game.bytes, game.system, game); session = null; mode = 'solo'; accumulator = 0; lastTime = 0;
  fpsTime = performance.now(); fpsCount = 0;
  $('screen-overlay').hidden = true; $('pause-button').disabled = false;
  $('pause-button').textContent = 'Pauzeren'; $('room-status').textContent = 'Solo aan het spelen';
  $('game').focus(); $('play-mode').textContent = 'Lokaal · solo'; $('solo-controls').hidden = false; updateActions();
}
$('solo-button').onclick = () => startSolo().catch(fatal);
function canUseSavestates() { return !!core && !!game && game.system !== 'dos' && isHost && !roomId && !peer && !invites.connection; }
$('export-state-button').onclick = async () => {
  if (!canUseSavestates() || stateBusy) return;
  stateBusy = true; if (mode === 'solo') pause(); updateActions();
  const currentGame = game;
  try {
    const bytes = await encodeSavestate(core.save(), currentGame, coreBuild(currentGame.system));
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
    const { state } = await decodeSavestate(new Uint8Array(await file.arrayBuffer()), currentGame, coreBuild(currentGame.system));
    if (!isCurrent()) return;
    // Restore into a separate instance. Invalid snapshots cannot damage the active game.
    let preview;
    const candidate = await coreClass(currentGame.system).create({ onFrame: (frame, width, height) => { preview = { frame: frame.slice(), width, height }; } });
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
    stop(); core.load(game.bytes, game.system, { ...game, overclock });
    game.overclock = overclock; localReady = remoteReady = false;
    overlay('CPU-overclock ingesteld.', `${overclock}% CPU-ruimte. Start de game opnieuw om te spelen.`);
    $('room-status').textContent = 'Klaar om te spelen';
    $('room-message').textContent = `CPU-overclock: ${overclock}%. Speler 2 krijgt automatisch dezelfde instelling.`;
    updateActions();
  } catch (error) { fatal(error); updateActions(); }
};
async function startTogether() {
  if (playStyle === 'stream') {
    if (!streamInfo || !gameStream || !peer?.opened) throw new Error('Wacht tot de WebRTC-stream verbonden is.');
    if (!isHost) {
      if (!streamReady) throw new Error('Wacht tot beeld en geluid binnenkomen.');
      streamVideo.muted = false;
      try { await streamVideo.play(); } catch { streamVideo.muted = true; toast('Gebruik de geluidsknop om het geluid aan te zetten.'); }
      updateAudio(); localReady = true;
      peer.send('control', { type: 'stream-ready', token: streamInfo.token });
      $('stream-status').textContent = 'Beeld, geluid en controller zijn klaar. Wachten tot de host start.';
      $('room-message').textContent = 'Je controller is klaar. De host kan starten.'; updateActions(); return;
    }
    await enableAudio();
    if (!remoteReady) throw new Error('Wacht tot speler 2 de stream heeft geopend en klaar is.');
    if (mode === 'paused') { resume(); return; }
    const nextEpoch = crypto.randomUUID();
    peer.send('control', { type: 'stream-start', token: streamInfo.token, epoch: nextEpoch, version: STREAM_VERSION });
    beginStreaming(nextEpoch); return;
  }
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
$('audio-button').onclick = async () => {
  if (isStreamGuest()) {
    streamVideo.muted = !streamVideo.muted;
    try { await streamVideo.play(); } catch { streamVideo.muted = true; toast('Het streamgeluid kon niet worden gestart. Probeer opnieuw.'); }
    updateAudio(); return;
  }
  if (audio.enabled) { audio.mute(); updateAudio(); } else await enableAudio();
};
const playPanel = $('play-panel');
let fullscreenControlsTimer,dosMenuTimer;
const fullscreenKeyboard=createFullscreenKeyboard({keyboard:navigator.keyboard,active:()=>document.fullscreenElement===playPanel&&game?.system==='dos',onStatus:locked=>{
  $('dos-fullscreen-note').textContent=locked?'Korte Escape gaat naar DOS. Houd Escape circa twee seconden ingedrukt om de browservergrendeling te verlaten. DOS-menu: Alt+Shift+M of de bovenrand van het beeld.':'De browser kan Escape gebruiken om fullscreen te verlaten. Kies zo nodig een vervangende DOS-Escape-toets. DOS-menu: Alt+Shift+M of de bovenrand van het beeld.';
}});
playPanel.addEventListener('pointermove',event=>{
  if(document.fullscreenElement!==playPanel||game?.system!=='dos'||event.clientY>64)return;
  playPanel.classList.add('dos-menu-visible');clearTimeout(dosMenuTimer);dosMenuTimer=setTimeout(()=>playPanel.classList.remove('dos-menu-visible'),3000);
});
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
  dosMenu.update();
  if (fullscreen) { focusGame(); revealFullscreenControls(); }else{fullscreenKeyboard.release();playPanel.classList.remove('dos-menu-visible');}
});
$('fullscreen-button').onclick = async () => {
  try { if(document.fullscreenElement)await document.exitFullscreen();else{await playPanel.requestFullscreen();if(game?.system==='dos')await fullscreenKeyboard.acquire();} }
  catch { toast('Volledig scherm is hier niet beschikbaar.'); }
};
$('copy-button').onclick = async () => {
  const url = invitationUrl();
  try { await navigator.clipboard.writeText(url); toast('Kamerlink gekopieerd. Tijd om iemand uit te dagen.'); }
  catch { $('invite-link').focus(); $('invite-link').select(); toast('Selecteer en kopieer de link in het tekstvak.'); }
};
document.addEventListener('keydown', event => {
  if (game?.system==='dos' || $('room-view').hidden || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.isContentEditable) return;
  if (controls.hasKey(event.code)) { event.preventDefault(); pressed.add(event.code); }
});
document.addEventListener('keyup', event => pressed.delete(event.code));
function releaseButtons() {
  pressed.clear(); touched.clear();dosControls?.release();
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
    if (playStyle === 'stream') { $('route-value').textContent = 'WebRTC · stream'; return; }
    if (peer.route === 'Tailcat') { $('route-value').textContent = 'Tailcat'; return; }
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
createGamePatcher({onOpen:()=>{releaseButtons();dosControls.unlock();}});
