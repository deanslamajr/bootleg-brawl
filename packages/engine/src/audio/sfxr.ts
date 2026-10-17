// sfxr-style synthesis from JSON parameters. Pure: the build renders these to WAV, and the
// sandbox can render them live for tuning.

import type { SfxParams } from "@bb/schema";

export function renderSfx(p: SfxParams, sampleRate = 22050): Float32Array {
  const one = p.attack + p.sustain + p.decay;
  const total = Math.max(1, Math.round(one * p.repeat * sampleRate));
  const out = new Float32Array(total);
  let phase = 0;
  let freq = p.freq;
  let slide = p.freqEnd !== undefined ? (p.freqEnd - p.freq) / Math.max(1e-4, one) : 0;
  let duty = p.duty;
  let noiseVal = 0;
  let noiseTimer = 0;
  let lpState = 0;
  let hpState = 0;
  let hpPrev = 0;
  const crushLevels = p.crush >= 16 ? 0 : 2 ** p.crush;
  // A tiny deterministic noise generator so renders are reproducible.
  let seed = 0x1234567;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) / 0x800000 - 1;
  };
  const oneSamples = Math.max(1, Math.round(one * sampleRate));
  for (let i = 0; i < total; i++) {
    const local = i % oneSamples;
    if (local === 0) {
      freq = p.freq;
      slide = p.freqEnd !== undefined ? (p.freqEnd - p.freq) / Math.max(1e-4, one) : 0;
      duty = p.duty;
    }
    const t = local / sampleRate;
    let env: number;
    if (t < p.attack) env = t / Math.max(1e-4, p.attack);
    else if (t < p.attack + p.sustain)
      env = 1 + p.punch * (1 - (t - p.attack) / Math.max(1e-4, p.sustain));
    else env = Math.max(0, 1 - (t - p.attack - p.sustain) / Math.max(1e-4, p.decay));
    slide += (p.slideAccel / sampleRate) * (slide >= 0 ? 1 : -1);
    freq = Math.max(20, freq + slide / sampleRate);
    let f = freq;
    if (p.arpeggio && t >= one * p.arpeggioAt) f *= p.arpeggio;
    if (p.vibratoDepth) f *= 1 + p.vibratoDepth * 0.1 * Math.sin(2 * Math.PI * p.vibratoSpeed * t);
    duty = Math.min(0.95, Math.max(0.05, duty + p.dutySweep / sampleRate));
    phase += f / sampleRate;
    if (phase >= 1) phase -= Math.floor(phase);
    let s: number;
    switch (p.wave) {
      case "square":
        s = phase < duty ? 0.6 : -0.6;
        break;
      case "saw":
        s = (phase * 2 - 1) * 0.6;
        break;
      case "sine":
        s = Math.sin(phase * 2 * Math.PI) * 0.7;
        break;
      case "triangle":
        s = (phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4) * 0.7;
        break;
      case "noise":
        noiseTimer += f / sampleRate;
        if (noiseTimer >= 1 / 32) {
          noiseTimer = 0;
          noiseVal = rnd();
        }
        s = noiseVal * 0.6;
        break;
    }
    // One-pole filters.
    const lpa = p.lpf * p.lpf;
    lpState += lpa * (s - lpState);
    s = p.lpf < 1 ? lpState : s;
    if (p.hpf > 0) {
      hpState = (1 - p.hpf * 0.5) * (hpState + s - hpPrev);
      hpPrev = s;
      s = hpState;
    }
    s *= env * p.volume;
    if (crushLevels) s = Math.round(s * crushLevels) / crushLevels;
    out[i] = Math.max(-1, Math.min(1, s));
  }
  return out;
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate = 22050): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    v.setInt16(44 + i * 2, Math.round(samples[i]! * 32767), true);
  return new Uint8Array(buf);
}
