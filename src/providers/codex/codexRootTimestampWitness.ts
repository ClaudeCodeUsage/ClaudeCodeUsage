/** Metadata-only streaming JSON validation for an already oversized record.
 * No value text is retained except the bounded root timestamp. Root keys are
 * compared to one fixed literal; nested keys and all body strings are discarded. */
export class CodexRootTimestampWitness {
  private bad = false;
  private started = false;
  private done = false;
  private frames: Array<{ object: boolean; phase: number; timestamp: boolean }> = [];
  private mode: 'idle' | 'string' | 'number' | 'literal' = 'idle';
  private key = false;
  private keyMatches = false;
  private keyChars = 0;
  private keys = 0;
  private timestampKeys = 0;
  private captureTime = false;
  private timeText = '';
  private time?: number;
  private escape = false;
  private hexLeft = 0;
  private hexValue = 0;
  private utfLeft = 0;
  private utfMin = 0x80;
  private utfMax = 0xbf;
  private numberPhase = '';
  private literal = '';
  private literalAt = 0;

  feed(bytes: Uint8Array): void {
    if (this.bad) return;
    for (const byte of bytes) {
      this.byte(byte);
      if (this.bad) break;
    }
  }

  finish(): number | undefined {
    if (this.mode === 'number') {
      if (!['zero', 'digits', 'fraction', 'exponent'].includes(this.numberPhase)) this.bad = true;
      else { this.mode = 'idle'; this.valueComplete(); }
    }
    return !this.bad && this.done && this.mode === 'idle' && this.timestampKeys === 1 ? this.time : undefined;
  }

  private decoded(code: number): void {
    if (this.key) {
      if (this.keyChars >= 128) { this.bad = true; return; }
      if (this.keyChars >= 9 || code !== 'timestamp'.charCodeAt(this.keyChars)) this.keyMatches = false;
      this.keyChars += 1;
    }
    if (this.captureTime) {
      if (this.timeText.length >= 64 || code > 127) { this.bad = true; return; }
      this.timeText += String.fromCharCode(code);
    }
  }

  private stringByte(b: number): void {
    if (this.utfLeft > 0) {
      if (b < this.utfMin || b > this.utfMax) { this.bad = true; return; }
      this.utfLeft -= 1; this.utfMin = 0x80; this.utfMax = 0xbf;
      return;
    }
    if (this.hexLeft > 0) {
      const n = b >= 48 && b <= 57 ? b - 48 : b >= 65 && b <= 70 ? b - 55 : b >= 97 && b <= 102 ? b - 87 : -1;
      if (n < 0) { this.bad = true; return; }
      this.hexValue = this.hexValue * 16 + n;
      this.hexLeft -= 1;
      if (this.hexLeft === 0) this.decoded(this.hexValue);
      return;
    }
    if (this.escape) {
      this.escape = false;
      if (b === 117) { this.hexLeft = 4; this.hexValue = 0; return; }
      const decoded = b === 34 || b === 92 || b === 47 ? b : b === 98 ? 8 : b === 102 ? 12 :
        b === 110 ? 10 : b === 114 ? 13 : b === 116 ? 9 : -1;
      if (decoded < 0) this.bad = true;
      else this.decoded(decoded);
      return;
    }
    if (b === 92) { this.escape = true; return; }
    if (b === 34) {
      this.mode = 'idle';
      if (this.key) {
        const frame = this.frames[this.frames.length - 1];
        frame.timestamp = this.frames.length === 1 && this.keyMatches && this.keyChars === 9;
        if (frame.timestamp && ++this.timestampKeys > 1) this.bad = true;
        frame.phase = 2;
      } else {
        if (this.captureTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(this.timeText)) {
          const parsed = Date.parse(this.timeText);
          if (Number.isSafeInteger(parsed) && parsed > 0) this.time = parsed;
        }
        this.valueComplete();
      }
      this.timeText = ''; this.captureTime = false;
      return;
    }
    if (b < 0x20) { this.bad = true; return; }
    if (b >= 0x80) {
      if (b >= 0xc2 && b <= 0xdf) this.utfLeft = 1;
      else if (b >= 0xe0 && b <= 0xef) {
        this.utfLeft = 2;
        if (b === 0xe0) this.utfMin = 0xa0;
        if (b === 0xed) this.utfMax = 0x9f;
      } else if (b >= 0xf0 && b <= 0xf4) {
        this.utfLeft = 3;
        if (b === 0xf0) this.utfMin = 0x90;
        if (b === 0xf4) this.utfMax = 0x8f;
      } else { this.bad = true; return; }
      this.decoded(0x80);
    } else this.decoded(b);
  }

  private valueComplete(): void {
    const frame = this.frames[this.frames.length - 1];
    if (frame) frame.phase = 4;
    else this.done = true;
  }

  private startString(key: boolean): void {
    if (key && ++this.keys > 4096) { this.bad = true; return; }
    this.mode = 'string'; this.key = key; this.keyMatches = key; this.keyChars = 0;
    this.captureTime = !key && this.frames.length === 1 && this.frames[0].timestamp;
    this.timeText = ''; this.escape = false; this.hexLeft = 0; this.utfLeft = 0;
  }

  private value(b: number): void {
    if (b === 123 || b === 91) {
      if (this.frames.length >= 64) { this.bad = true; return; }
      this.frames.push({ object: b === 123, phase: 0, timestamp: false });
    } else if (b === 34) this.startString(false);
    else if (b === 45 || b >= 48 && b <= 57) {
      this.mode = 'number'; this.numberPhase = b === 45 ? 'minus' : b === 48 ? 'zero' : 'digits';
    } else if (b === 116 || b === 102 || b === 110) {
      this.mode = 'literal'; this.literal = b === 116 ? 'true' : b === 102 ? 'false' : 'null'; this.literalAt = 1;
    } else this.bad = true;
  }

  private byte(b: number): void {
    if (this.mode === 'string') { this.stringByte(b); return; }
    if (this.mode === 'literal') {
      if (b !== this.literal.charCodeAt(this.literalAt++)) { this.bad = true; return; }
      if (this.literalAt === this.literal.length) { this.mode = 'idle'; this.valueComplete(); }
      return;
    }
    if (this.mode === 'number') {
      const digit = b >= 48 && b <= 57;
      if (this.numberPhase === 'minus') {
        if (!digit) this.bad = true;
        else this.numberPhase = b === 48 ? 'zero' : 'digits';
        return;
      }
      if (this.numberPhase === 'dot') { if (!digit) this.bad = true; else this.numberPhase = 'fraction'; return; }
      if (this.numberPhase === 'e') {
        if (b === 43 || b === 45) this.numberPhase = 'esign';
        else if (digit) this.numberPhase = 'exponent'; else this.bad = true;
        return;
      }
      if (this.numberPhase === 'esign') { if (!digit) this.bad = true; else this.numberPhase = 'exponent'; return; }
      if (digit) { if (this.numberPhase === 'zero') this.bad = true; return; }
      if ((this.numberPhase === 'zero' || this.numberPhase === 'digits') && b === 46) { this.numberPhase = 'dot'; return; }
      if (this.numberPhase !== 'exponent' && (b === 69 || b === 101)) { this.numberPhase = 'e'; return; }
      this.mode = 'idle'; this.valueComplete();
    }
    if (b === 32 || b === 9 || b === 10 || b === 13) return;
    if (this.done) { this.bad = true; return; }
    if (!this.started) {
      if (b !== 123) { this.bad = true; return; }
      this.started = true; this.value(b); return;
    }
    const frame = this.frames[this.frames.length - 1];
    if (!frame) { this.bad = true; return; }
    if (frame.object && (frame.phase === 0 || frame.phase === 1)) {
      if (b === 125 && frame.phase === 0) { this.frames.pop(); this.valueComplete(); }
      else if (b === 34) this.startString(true); else this.bad = true;
    } else if (frame.object && frame.phase === 2) {
      if (b !== 58) this.bad = true; else frame.phase = 3;
    } else if (frame.phase === 4) {
      if (b === 44) frame.phase = frame.object ? 1 : 3;
      else if (b === (frame.object ? 125 : 93)) { this.frames.pop(); this.valueComplete(); }
      else this.bad = true;
    } else if (!frame.object && frame.phase === 0 && b === 93) { this.frames.pop(); this.valueComplete(); }
    else this.value(b);
  }
}
