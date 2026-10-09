// Tiny binary writer and reader (big-endian). No Node-only APIs: works the same in the browser and on the server.

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class DecodeError extends Error {
  constructor(message: string) { super(message); this.name = 'DecodeError'; }
}

export class Writer {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  private len = 0;

  private need(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  private int(v: number, max: number, what: string): void {
    if (!Number.isInteger(v) || v < 0 || v > max) throw new RangeError(`${what} out of range: ${v}`);
  }
  u8(v: number): this { this.int(v, 0xff, 'u8'); this.need(1); this.view.setUint8(this.len, v); this.len += 1; return this; }
  u16(v: number): this { this.int(v, 0xffff, 'u16'); this.need(2); this.view.setUint16(this.len, v); this.len += 2; return this; }
  u32(v: number): this { this.int(v, 0xffffffff, 'u32'); this.need(4); this.view.setUint32(this.len, v); this.len += 4; return this; }
  f32(v: number): this { if (!Number.isFinite(v)) throw new RangeError('f32 must be finite'); this.need(4); this.view.setFloat32(this.len, v); this.len += 4; return this; }
  f64(v: number): this { if (!Number.isFinite(v)) throw new RangeError('f64 must be finite'); this.need(8); this.view.setFloat64(this.len, v); this.len += 8; return this; }
  /** A string: u16 byte length, then UTF-8. */
  str(s: string): this {
    const bytes = encoder.encode(s);
    if (bytes.length > 0xffff) throw new RangeError('string too long for the protocol');
    this.u16(bytes.length); this.need(bytes.length);
    this.buf.set(bytes, this.len); this.len += bytes.length;
    return this;
  }
  bytes(): Uint8Array { return this.buf.slice(0, this.len); }
}

export class Reader {
  private view: DataView;
  private pos = 0;
  constructor(private readonly buf: Uint8Array) { this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }

  private take(n: number): number {
    if (this.pos + n > this.buf.length) throw new DecodeError('message ended early');
    const at = this.pos; this.pos += n; return at;
  }
  u8(): number { return this.view.getUint8(this.take(1)); }
  u16(): number { return this.view.getUint16(this.take(2)); }
  u32(): number { return this.view.getUint32(this.take(4)); }
  f32(): number { const v = this.view.getFloat32(this.take(4)); if (!Number.isFinite(v)) throw new DecodeError('number is not finite'); return v; }
  f64(): number { const v = this.view.getFloat64(this.take(8)); if (!Number.isFinite(v)) throw new DecodeError('number is not finite'); return v; }
  str(): string {
    const n = this.u16(), at = this.take(n);
    try { return decoder.decode(this.buf.subarray(at, at + n)); } catch { throw new DecodeError('invalid text'); }
  }
  /** Bytes not read yet. */
  get remaining(): number { return this.buf.length - this.pos; }
}
