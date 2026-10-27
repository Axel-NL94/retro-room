import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRetroServer } from '../server/index.js';

async function client(url) {
  const ws = new WebSocket(url);
  const messages = [], waiters = [];
  ws.on('message', data => {
    const message = JSON.parse(data);
    const index = waiters.findIndex(w => w.match(message));
    if (index >= 0) { const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timeout); waiter.resolve(message); }
    else messages.push(message);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, send: data => ws.send(JSON.stringify(data)),
    next: (type, extra = () => true) => new Promise((resolve, reject) => {
      const match = m => m.type === type && extra(m);
      const index = messages.findIndex(match);
      if (index >= 0) return resolve(messages.splice(index, 1)[0]);
      const waiter = { match, resolve, timeout: setTimeout(() => {
        const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1);
        reject(new Error(`Timed out waiting for ${type}`));
      }, 3000) };
      waiters.push(waiter);
    }) };
}

test('real lobby creates, lists, joins, limits capacity and relays only between room members', async () => {
  const app = createRetroServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = `ws://127.0.0.1:${app.server.address().port}/ws`;
  try {
    const host = await client(address), guest = await client(address), outsider = await client(address);
    host.send({ type: 'create', public: true, name: 'Axel', title: 'Testavond', game: 'Room Rally' });
    const { id } = await host.next('created');
    const list = await outsider.next('rooms', m => m.rooms.length === 1);
    assert.equal(list.rooms[0].game, 'Room Rally'); assert.equal(list.rooms[0].host, 'Axel');
    guest.send({ type: 'join', id, name: 'Speler twee' });
    assert.equal((await guest.next('joined')).id, id);
    assert.equal((await host.next('guest-joined')).name, 'Speler twee');
    outsider.send({ type: 'join', id });
    assert.match((await outsider.next('error')).message, /vol/);
    guest.send({ type: 'status', status: 'playing' });
    await guest.next('error'); assert.equal(app.rooms.get(id).status, 'waiting');
    host.send({ type: 'status', status: 'playing' });
    await outsider.next('rooms', m => m.rooms[0]?.status === 'playing');
    host.send({ type: 'signal', data: { type: 'offer', sdp: 'test-sdp' } });
    assert.equal((await guest.next('signal')).data.sdp, 'test-sdp');
    outsider.send({ type: 'signal', data: { type: 'offer', sdp: 'not-a-member' } });
    await outsider.next('error');
    host.ws.send(Buffer.from([0x4e, 0x45, 0x53]));
    assert.match((await host.next('error')).message, /verbindingsgegevens/);
    guest.send({ type: 'leave' }); await host.next('guest-left');
    assert.equal(app.rooms.get(id).guest, null);
    host.send({ type: 'leave' }); await host.next('left');
    assert.equal(app.rooms.size, 0);
  } finally { await app.close(); }
});

test('private rooms are absent from the lobby and disappear when the host disconnects', async () => {
  const app = createRetroServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = `ws://127.0.0.1:${app.server.address().port}/ws`;
  try {
    const host = await client(address), guest = await client(address);
    host.send({ type: 'create', public: false, game: 'Private' });
    const { id } = await host.next('created');
    guest.send({ type: 'list' });
    assert.equal((await guest.next('rooms')).rooms.length, 0);
    guest.send({ type: 'join', id }); await guest.next('joined');
    host.ws.close(); await guest.next('room-closed');
    assert.equal(app.rooms.size, 0);
  } finally { await app.close(); }
});

test('origin allowlist rejects an unrelated website', async () => {
  const app = createRetroServer({ allowedOrigins: ['https://axel-nl94.github.io'] });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${app.server.address().port}/ws`, { origin: 'https://unrelated.example' });
    const error = await new Promise(resolve => ws.once('error', resolve));
    assert.match(error.message, /403/);
  } finally { await app.close(); }
});
