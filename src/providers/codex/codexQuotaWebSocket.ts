import { createHash, randomBytes } from 'node:crypto';
import { TextDecoder } from 'node:util';

export const CODEX_QUOTA_WS_HEADER_LIMIT = 16 * 1024;
export const CODEX_QUOTA_WS_MESSAGE_LIMIT = 256 * 1024;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
interface Callbacks {
  onOpen(): void;
  onText(text: string): void;
  onSend(bytes: Buffer): void;
  onFailure(): void;
}

/** RFC 6455 over an already owned proxy pipe; no sockets, extensions or logging. */
export class CodexQuotaWebSocket {
  readonly request: Buffer;
  #accept: string;
  #buffer: Buffer = Buffer.alloc(0);
  #fragments: Buffer[] = [];
  #fragmentBytes = 0;
  #fragmented = false;
  #opened = false;
  #stopped = false;
  #frames = 0;

  constructor(private readonly callbacks: Callbacks) {
    const key = randomBytes(16).toString('base64');
    this.#accept = createHash('sha1').update(key + GUID).digest('base64');
    this.request = Buffer.from('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n' +
      'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ' + key + '\r\n\r\n');
  }

  dispose(): void {
    this.#stopped = true;
    this.#buffer = Buffer.alloc(0);
    this.#fragments = [];
    this.#fragmentBytes = 0;
  }
  #fail(): void {
    if (this.#stopped) return;
    this.dispose();
    this.callbacks.onFailure();
  }

  #send(payload: Buffer, opcode: 1 | 10): void {
    if (this.#stopped || !this.#opened || payload.length > CODEX_QUOTA_WS_MESSAGE_LIMIT ||
        (opcode === 10 && payload.length > 125)) throw new Error('codex-quota-websocket:invalid-send');
    const offset = payload.length < 126 ? 2 : payload.length < 65536 ? 4 : 10;
    const bytes = Buffer.alloc(offset + 4 + payload.length);
    bytes[0] = 0x80 | opcode;
    if (offset === 2) bytes[1] = 0x80 | payload.length;
    else if (offset === 4) { bytes[1] = 0xfe; bytes.writeUInt16BE(payload.length, 2); }
    else { bytes[1] = 0xff; bytes.writeBigUInt64BE(BigInt(payload.length), 2); }
    const mask = randomBytes(4);
    mask.copy(bytes, offset);
    for (let i = 0; i < payload.length; i++) bytes[offset + 4 + i] = payload[i] ^ mask[i % 4];
    this.callbacks.onSend(bytes);
  }
  sendText(text: string): void {
    if (Buffer.byteLength(text) > CODEX_QUOTA_WS_MESSAGE_LIMIT) throw new Error('codex-quota-websocket:message-limit');
    this.#send(Buffer.from(text), 1);
  }

  #upgrade(): boolean {
    const end = this.#buffer.indexOf('\r\n\r\n');
    if (end < 0) {
      if (this.#buffer.length > CODEX_QUOTA_WS_HEADER_LIMIT) this.#fail();
      return false;
    }
    if (end + 4 > CODEX_QUOTA_WS_HEADER_LIMIT) { this.#fail(); return false; }
    const lines = this.#buffer.subarray(0, end).toString('latin1').split('\r\n');
    if (!/^HTTP\/1\.1 101(?: [\x20-\x7e]*)?$/.test(lines.shift()!)) { this.#fail(); return false; }
    const headers = new Map<string, string>();
    for (const line of lines) {
      const match = /^([!#$%&'*+.^_`|~0-9a-z-]+):[\t ]*([\t\x20-\x7e]*)$/i.exec(line);
      if (!match || headers.has(match[1].toLowerCase())) { this.#fail(); return false; }
      headers.set(match[1].toLowerCase(), match[2].trim());
    }
    if (headers.get('upgrade')?.toLowerCase() !== 'websocket' ||
        !headers.get('connection')?.toLowerCase().split(',').some(token => token.trim() === 'upgrade') ||
        headers.get('sec-websocket-accept') !== this.#accept ||
        ['sec-websocket-extensions', 'sec-websocket-protocol', 'transfer-encoding', 'content-length']
          .some(key => headers.has(key))) { this.#fail(); return false; }
    this.#buffer = this.#buffer.subarray(end + 4);
    this.#opened = true;
    this.callbacks.onOpen();
    return !this.#stopped;
  }

  push(chunk: Buffer): void {
    if (this.#stopped) return;
    try {
      if (!Buffer.isBuffer(chunk) || chunk.length + this.#buffer.length >
          CODEX_QUOTA_WS_MESSAGE_LIMIT + CODEX_QUOTA_WS_HEADER_LIMIT + 10) { this.#fail(); return; }
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      if (!this.#opened && !this.#upgrade()) return;
      while (!this.#stopped && this.#buffer.length >= 2) {
        const first = this.#buffer[0], second = this.#buffer[1];
        const fin = (first & 0x80) !== 0, opcode = first & 15;
        let length = second & 127, offset = 2;
        if ((first & 0x70) || (second & 0x80) || ![0, 1, 8, 9, 10].includes(opcode) ||
            (opcode >= 8 && (!fin || length > 125)) ||
            (opcode === 0 && !this.#fragmented) || (opcode === 1 && this.#fragmented)) {
          this.#fail(); return;
        }
        if (length === 126) {
          if (this.#buffer.length < 4) return;
          length = this.#buffer.readUInt16BE(2); offset = 4;
          if (length < 126) { this.#fail(); return; }
        } else if (length === 127) {
          if (this.#buffer.length < 10) return;
          const big = this.#buffer.readBigUInt64BE(2);
          if (big < 65536n || big > BigInt(CODEX_QUOTA_WS_MESSAGE_LIMIT)) { this.#fail(); return; }
          length = Number(big); offset = 10;
        }
        if (length > CODEX_QUOTA_WS_MESSAGE_LIMIT ||
            (opcode < 8 && this.#fragmentBytes + length > CODEX_QUOTA_WS_MESSAGE_LIMIT)) {
          this.#fail(); return;
        }
        if (this.#buffer.length < offset + length) return;
        if (++this.#frames > 4096) { this.#fail(); return; }
        const payload = this.#buffer.subarray(offset, offset + length);
        this.#buffer = this.#buffer.subarray(offset + length);
        if (opcode === 8) { this.#fail(); return; }
        if (opcode === 9) { this.#send(payload, 10); continue; }
        if (opcode === 10) continue;
        this.#fragments.push(Buffer.from(payload));
        this.#fragmentBytes += length;
        this.#fragmented = !fin;
        if (fin) {
          const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
            .decode(Buffer.concat(this.#fragments, this.#fragmentBytes));
          this.#fragments = []; this.#fragmentBytes = 0;
          this.callbacks.onText(text);
        }
      }
    } catch { this.#fail(); }
  }
}
