import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const load = (): typeof import('../providers/codex/codexQuotaWebSocket') => require('../providers/codex/codexQuotaWebSocket');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export function serverFrame(payload: Buffer | string, opcode = 1, fin = true): Buffer {
  const bytes = typeof payload === 'string' ? Buffer.from(payload) : payload;
  const header = Buffer.alloc(bytes.length < 126 ? 2 : bytes.length < 65536 ? 4 : 10);
  header[0] = (fin ? 128 : 0) | opcode;
  if (header.length === 2) header[1] = bytes.length;
  else if (header.length === 4) { header[1] = 126; header.writeUInt16BE(bytes.length, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(bytes.length), 2); }
  return Buffer.concat([header, bytes]);
}
export function upgrade(request: Buffer, extra = ''): Buffer {
  const key = /Sec-WebSocket-Key: ([^\r]+)\r\n/.exec(request.toString('ascii'))![1];
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  return Buffer.from(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${extra}\r\n`);
}
function fixture() {
  const sent: Buffer[] = [], messages: string[] = [];
  let opened = 0, failed = 0;
  const socket = new (load().CodexQuotaWebSocket)({
    onOpen: () => opened++, onText: text => messages.push(text),
    onSend: bytes => sent.push(bytes), onFailure: () => failed++,
  });
  return { socket, sent, messages, opened: () => opened, failed: () => failed };
}

test('WebSocket handshake validates nonce accept and supports arbitrary header chunking', () => {
  const f = fixture();
  assert.match(f.socket.request.toString(), /^GET \/ HTTP\/1\.1\r\n/);
  assert.doesNotMatch(f.socket.request.toString(), /Extensions|Protocol:/);
  const bytes = Buffer.concat([upgrade(f.socket.request), serverFrame('hello')]);
  for (const byte of bytes) f.socket.push(Buffer.from([byte]));
  assert.equal(f.opened(), 1); assert.equal(f.failed(), 0);
  assert.deepEqual(f.messages, ['hello']);
});

test('WebSocket rejects bad accept/status, duplicate headers, extensions, protocols and oversized headers', () => {
  for (const mutate of [
    (b: Buffer) => Buffer.from(b.toString().replace('101', '200')),
    (b: Buffer) => Buffer.from(b.toString().replace(/Sec-WebSocket-Accept: .+\r\n/, 'Sec-WebSocket-Accept: bad\r\n')),
    (_b: Buffer, request: Buffer) => upgrade(request, 'Sec-WebSocket-Extensions: permessage-deflate\r\n'),
    (_b: Buffer, request: Buffer) => upgrade(request, 'Sec-WebSocket-Protocol: unsolicited\r\n'),
    (_b: Buffer, request: Buffer) => upgrade(request, 'Upgrade: websocket\r\n'),
    (_b: Buffer) => Buffer.alloc(16 * 1024 + 1, 65),
  ]) {
    const f = fixture(); f.socket.push(mutate(upgrade(f.socket.request), f.socket.request));
    assert.equal(f.failed(), 1); assert.equal(f.opened(), 0);
    f.socket.push(serverFrame('late')); assert.deepEqual(f.messages, []);
  }
});

test('fragmented UTF-8 text allows interleaved ping and sends a masked pong with identical bytes', () => {
  const f = fixture(); f.socket.push(upgrade(f.socket.request));
  const bytes = Buffer.from('账户');
  f.socket.push(serverFrame(bytes.subarray(0, 1), 1, false));
  f.socket.push(serverFrame('ping', 9));
  f.socket.push(serverFrame(bytes.subarray(1), 0));
  assert.deepEqual(f.messages, ['账户']); assert.equal(f.failed(), 0);
  const pong = f.sent[0]; assert.equal(pong[0], 0x8a); assert.equal(pong[1], 0x84);
  const payload = Buffer.from(pong.subarray(6));
  for (let i = 0; i < payload.length; i++) payload[i] ^= pong[2 + i % 4];
  assert.equal(payload.toString(), 'ping');
});

test('client text uses fresh masks and canonical 7/16/64-bit lengths without newline', () => {
  const f = fixture(); f.socket.push(upgrade(f.socket.request));
  for (const length of [5, 126, 65536]) {
    f.socket.sendText('x'.repeat(length));
    const frame = f.sent[f.sent.length - 1];
    assert.equal(frame[0], 0x81); assert.ok(frame[1] & 128);
    const offset = length < 126 ? 2 : length < 65536 ? 4 : 10;
    assert.equal(frame.length, offset + 4 + length);
    const payload = Buffer.from(frame.subarray(offset + 4));
    for (let i = 0; i < payload.length; i++) payload[i] ^= frame[offset + i % 4];
    assert.equal(payload.toString(), 'x'.repeat(length));
  }
  f.socket.sendText('same'); f.socket.sendText('same');
  assert.notDeepEqual(f.sent[3].subarray(2, 6), f.sent[4].subarray(2, 6));
});

test('server frames reject RSV, masks, binary/unknown opcodes, invalid continuation and control fragmentation', () => {
  const bad = [Buffer.from([0xc1, 0]), Buffer.from([0x81, 0x80]), serverFrame('', 2),
    serverFrame('', 3), serverFrame('', 0), serverFrame('', 9, false), serverFrame('x'.repeat(126), 9),
    serverFrame('', 8), Buffer.from([0x81, 126, 0, 1, 65]),
    Buffer.from([0x81, 127, 0x80, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.from([0x81, 127, 0, 0, 0, 0, 0, 0, 0, 1]),
    serverFrame(Buffer.from([0xc3, 0x28])),
    Buffer.concat([serverFrame('a', 1, false), serverFrame('b', 1)]),
  ];
  for (const bytes of bad) {
    const f = fixture(); f.socket.push(upgrade(f.socket.request)); f.socket.push(bytes);
    assert.equal(f.failed(), 1); assert.deepEqual(f.messages, []);
  }
});

test('large declared lengths and fragmented messages fail before exceeding bounded message storage', () => {
  const f = fixture(); f.socket.push(upgrade(f.socket.request));
  const header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(262145n, 2);
  f.socket.push(header); assert.equal(f.failed(), 1);
  const g = fixture(); g.socket.push(upgrade(g.socket.request));
  g.socket.push(serverFrame(Buffer.alloc(200_000), 1, false));
  g.socket.push(serverFrame(Buffer.alloc(100_000), 0));
  assert.equal(g.failed(), 1); assert.deepEqual(g.messages, []);
  const h = fixture(); h.socket.push(upgrade(h.socket.request));
  h.socket.push(serverFrame('x'.repeat(65536))); assert.equal(h.messages[0].length, 65536);
});

test('header cap accepts exactly 16 KiB and rejects a complete header one byte beyond it', () => {
  for (const excess of [0, 1]) {
    const f = fixture();
    const padding = 16 * 1024 - upgrade(f.socket.request).length - Buffer.byteLength('X-Pad: \r\n') + excess;
    const response = upgrade(f.socket.request, 'X-Pad: ' + 'x'.repeat(padding) + '\r\n');
    assert.equal(response.length, 16 * 1024 + excess);
    f.socket.push(response);
    assert.equal(f.opened(), excess === 0 ? 1 : 0);
    assert.equal(f.failed(), excess);
  }
});

test('exact 256 KiB message and 125-byte control limits work; disposal ignores later input', () => {
  const f = fixture();
  f.socket.push(Buffer.concat([upgrade(f.socket.request), serverFrame('x'.repeat(256 * 1024))]));
  assert.equal(f.messages[0].length, 256 * 1024);
  f.socket.push(serverFrame(Buffer.alloc(125, 65), 9));
  assert.equal(f.sent[0][0], 0x8a);
  assert.equal(f.sent[0][1], 0xfd);
  f.socket.push(serverFrame('', 10));
  assert.equal(f.failed(), 0);
  f.socket.dispose();
  f.socket.push(serverFrame('late'));
  assert.equal(f.messages.length, 1);
  assert.throws(() => f.socket.sendText('late'), /invalid-send/);
});

test('fatal UTF-8 rejects overlong encodings, surrogates and incomplete fragmented messages', () => {
  for (const bytes of [Buffer.from([0xc0, 0xaf]), Buffer.from([0xed, 0xa0, 0x80]),
    Buffer.from([0xf4, 0x90, 0x80, 0x80]), Buffer.from([0xf0, 0x9f])]) {
    const f = fixture(); f.socket.push(upgrade(f.socket.request));
    f.socket.push(serverFrame(bytes.subarray(0, 1), 1, false));
    f.socket.push(serverFrame(bytes.subarray(1), 0));
    assert.equal(f.failed(), 1); assert.deepEqual(f.messages, []);
  }
});

test('control-frame flood reaches the frame count cap without retaining messages', () => {
  const f = fixture(); f.socket.push(upgrade(f.socket.request));
  f.socket.push(Buffer.concat(Array.from({ length: 4096 }, () => serverFrame('', 10))));
  assert.equal(f.failed(), 0); assert.deepEqual(f.messages, []);
  f.socket.push(serverFrame('', 10));
  assert.equal(f.failed(), 1);
});
