export const STREAM_VERSION = 'retroroom-stream-1';
export const PLAY_MODES = Object.freeze(['netplay', 'stream']);
export function playMode(value = 'netplay') {
  if (!PLAY_MODES.includes(value)) throw new Error('Onbekende speelwijze. Vraag om een nieuwe uitnodigingslink.');
  return value;
}
const tokenPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function streamToken(value) {
  if (typeof value !== 'string' || !tokenPattern.test(value)) throw new Error('Ongeldige streamsessie.');
  return value;
}
export function streamMessage(channel, data) {
  const token = streamToken(data.token);
  if (channel === 'control' && data.type === 'stream-game') {
    if (data.version !== STREAM_VERSION || !['nes', 'snes', 'dos'].includes(data.system) ||
        typeof data.name !== 'string' || !data.name.length || data.name.length > 80 ||
        ![100,200,300,400,500].includes(data.overclock)) throw new Error('Ongeldige streamgegevens.');
    return { type: data.type, version: STREAM_VERSION, token, name: data.name, system: data.system, overclock: data.overclock };
  }
  if (channel === 'control' && ['stream-watch', 'stream-ready'].includes(data.type)) return { type: data.type, token };
  if (channel === 'control' && data.type === 'stream-start') {
    if (data.version !== STREAM_VERSION) throw new Error('De streamversies komen niet overeen.');
    return { type: data.type, token, epoch: streamToken(data.epoch), version: STREAM_VERSION };
  }
  if (channel === 'input' && data.type === 'stream-input' && Number.isSafeInteger(data.sequence) && data.sequence >= 0 &&
      Number.isInteger(data.buttons) && data.buttons >= 0 && data.buttons <= 4095) {
    return { type: data.type, token, epoch: streamToken(data.epoch), sequence: data.sequence, buttons: data.buttons };
  }
  throw new Error('Onbekend streambericht.');
}

// Unlike rollback, streaming applies the most recent controller state. Release
// stale input so a lost connection or hidden guest cannot leave a button held.
export class StreamInput {
  constructor(epoch, { now = () => performance.now(), timeout = 250 } = {}) {
    this.epoch = epoch; this.now = now; this.timeout = timeout; this.clear();
  }
  clear() { this.sequence = -1; this.buttons = 0; this.received = -Infinity; }
  receive(packet) {
    if (packet.epoch !== this.epoch || packet.sequence <= this.sequence) return;
    this.sequence = packet.sequence; this.buttons = packet.buttons; this.received = this.now();
  }
  current() { return this.now() - this.received <= this.timeout ? this.buttons : 0; }
}
