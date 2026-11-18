// Phone audio helpers: G.711 μ-law (what Twilio/Exotel send), 16-bit PCM and WAV.

/** μ-law byte → 16-bit sample. */
export function ulawToPcm(u8: Uint8Array): Int16Array {
  const out = new Int16Array(u8.length);
  for (let i = 0; i < u8.length; i++) {
    const u = ~u8[i] & 0xff;
    const sign = u & 0x80, exp = (u >> 4) & 0x07, man = u & 0x0f;
    let s = ((man << 3) + 0x84) << exp;
    s -= 0x84;
    out[i] = sign ? -s : s;
  }
  return out;
}

/** 16-bit sample → μ-law byte. */
export function pcmToUlaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let s = pcm[i];
    const sign = s < 0 ? 0x80 : 0;
    if (sign) s = -s;
    if (s > 32635) s = 32635;
    s += 0x84;
    let exp = 7;
    for (let mask = 0x4000; (s & mask) === 0 && exp > 0; mask >>= 1) exp--;
    const man = (s >> (exp + 3)) & 0x0f;
    out[i] = ~(sign | (exp << 4) | man) & 0xff;
  }
  return out;
}

/** 16-bit mono PCM → WAV file bytes. */
export function pcmToWav(pcm: Int16Array, sampleRate = 8000): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Stereo WAV (left = caller, right = agent) for call recordings. */
export function stereoWav(left: Int16Array, right: Int16Array, sampleRate = 8000): Buffer {
  const n = Math.max(left.length, right.length);
  const inter = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) { inter[2 * i] = left[i] ?? 0; inter[2 * i + 1] = right[i] ?? 0; }
  const data = Buffer.from(inter.buffer);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** WAV (or raw 16-bit) bytes → samples and rate; resamples to 8 kHz if needed. */
export function wavToPcm8k(buf: Buffer): Int16Array {
  let rate = 8000, offset = 0, channels = 1;
  if (buf.subarray(0, 4).toString() === "RIFF") {
    let p = 12;
    while (p + 8 <= buf.length) {
      const id = buf.subarray(p, p + 4).toString();
      const size = buf.readUInt32LE(p + 4);
      if (id === "fmt ") { channels = buf.readUInt16LE(p + 10); rate = buf.readUInt32LE(p + 12); }
      if (id === "data") { offset = p + 8; break; }
      p += 8 + size + (size % 2);
    }
  }
  const body = buf.subarray(offset, buf.length - ((buf.length - offset) % (2 * channels)));
  const all = new Int16Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  const mono = channels === 1 ? all : Int16Array.from({ length: all.length / channels }, (_, i) => all[i * channels]);
  if (rate === 8000) return mono;
  const ratio = rate / 8000;
  return Int16Array.from({ length: Math.floor(mono.length / ratio) }, (_, i) => mono[Math.floor(i * ratio)]);
}

export const rms = (pcm: Int16Array) => { let s = 0; for (const v of pcm) s += v * v; return Math.sqrt(s / Math.max(1, pcm.length)); };
