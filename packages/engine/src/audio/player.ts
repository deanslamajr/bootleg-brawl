// Web Audio: three buses (music, sfx, announcer) into a limiter. SFX are decoded WAVs with a
// voice cap so four players mashing cannot drown the hit sounds. Music is synthesized from the
// tracker JSON with a lookahead scheduler; it is cosmetic, so the audio clock is fine here.
// Beat-synced gameplay must derive beats from the sim tick, never from this file.

import type { TrackFile } from "@bb/schema";

const NOTE: Record<string, number> = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
};

export function noteFreq(note: string): number | null {
  const m = /^([A-G]#?)(-?\d)$/.exec(note);
  if (!m) return null;
  const n = NOTE[m[1]!]! + (Number(m[2]) + 1) * 12;
  return 440 * Math.pow(2, (n - 69) / 12);
}

interface Voice {
  node: AudioScheduledSourceNode;
  started: number;
  id: string;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private annBus!: GainNode;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pending = new Map<string, ArrayBuffer>();
  private voices: Voice[] = [];
  private noise: AudioBuffer | null = null;
  private music: {
    track: TrackFile;
    row: number;
    next: number;
    timer: number;
    gain: GainNode;
  } | null = null;
  private stingerTimer = 0;
  private duckUntil = 0;
  musicVolume = 0.7;
  sfxVolume = 0.9;
  readonly maxVoices = 14;

  /** Must be called from a user gesture (browsers keep contexts suspended until then). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(limiter).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.annBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.annBus.connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      d[i] = (seed / 0xffffffff) * 2 - 1;
    }
    for (const [id, bytes] of this.pending) void this.decode(id, bytes);
    this.pending.clear();
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (!this.ctx) return;
    this.musicBus.gain.value = music;
    this.sfxBus.gain.value = sfx;
  }

  addSfx(id: string, bytes: ArrayBuffer): void {
    if (this.buffers.has(id)) return;
    if (!this.ctx) {
      this.pending.set(id, bytes);
      return;
    }
    void this.decode(id, bytes);
  }

  private async decode(id: string, bytes: ArrayBuffer): Promise<void> {
    try {
      this.buffers.set(id, await this.ctx!.decodeAudioData(bytes.slice(0)));
    } catch {
      // A broken sound is not worth stopping the game for.
    }
  }

  play(id: string, pan = 0, bus: "sfx" | "announcer" = "sfx"): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !buf) return;
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => now - v.started < 1.5);
    // Same sound twice within 30 ms is one sound.
    if (this.voices.some((v) => v.id === id && now - v.started < 0.03)) return;
    if (this.voices.length >= this.maxVoices) {
      const oldest = this.voices.shift();
      try {
        oldest?.node.stop();
      } catch {
        /* already stopped */
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(p).connect(bus === "sfx" ? this.sfxBus : this.annBus);
    src.start();
    this.voices.push({ node: src, started: now, id });
    if (bus === "announcer") this.duck(0.6);
  }

  /** Lowers music under the announcer and boss cards. */
  duck(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.duckUntil = ctx.currentTime + seconds;
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.35, ctx.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicVolume, this.duckUntil, 0.2);
  }

  // ------------------------------------------------------------------ music

  playMusic(track: TrackFile | undefined): void {
    if (!this.ctx || !track) return;
    if (this.music?.track.id === track.id) return;
    this.stopMusic();
    const gain = this.ctx.createGain();
    gain.connect(this.musicBus);
    this.music = { track, row: 0, next: this.ctx.currentTime + 0.05, timer: 0, gain };
    this.music.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stopMusic(fade = 0.15): void {
    const m = this.music;
    if (!m || !this.ctx) return;
    window.clearInterval(m.timer);
    m.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    const g = m.gain;
    window.setTimeout(() => g.disconnect(), fade * 1000 + 200);
    this.music = null;
  }

  /** Plays a non-looping stinger over silence, then resumes `after` if given. */
  stinger(track: TrackFile | undefined, after?: TrackFile): void {
    if (!this.ctx || !track) return;
    this.stopMusic(0.05);
    this.playMusic(track);
    window.clearTimeout(this.stingerTimer);
    if (after) {
      const rows = rowsOf(track);
      const secs = (rows * 60) / (track.bpm * track.rowsPerBeat) + 0.3;
      this.stingerTimer = window.setTimeout(() => {
        this.stopMusic(0.05);
        this.playMusic(after);
      }, secs * 1000);
    }
  }

  private schedule(): void {
    const ctx = this.ctx;
    const m = this.music;
    if (!ctx || !m) return;
    const t = m.track;
    const rowDur = 60 / (t.bpm * t.rowsPerBeat);
    const steps = expand(t);
    while (m.next < ctx.currentTime + 0.12) {
      if (m.row >= steps.length) {
        if (!t.loop) {
          this.stopMusic(0.3);
          return;
        }
        m.row = t.loopRow;
      }
      const row = steps[m.row]!;
      for (const [inst, note, holdRows] of row)
        this.voice(t, inst, note, m.next, holdRows * rowDur, m.gain);
      m.row++;
      m.next += rowDur;
    }
  }

  private voice(
    t: TrackFile,
    instId: string,
    note: string,
    at: number,
    dur: number,
    out: AudioNode,
  ): void {
    const ctx = this.ctx!;
    const inst = t.instruments[instId];
    if (!inst) return;
    const g = ctx.createGain();
    g.connect(out);
    const peak = inst.volume;
    const env = (len: number) => {
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + inst.attack);
      g.gain.linearRampToValueAtTime(peak * inst.sustain, at + inst.attack + inst.decay);
      g.gain.setValueAtTime(peak * inst.sustain, at + Math.max(inst.attack + inst.decay, len));
      g.gain.linearRampToValueAtTime(
        0,
        at + Math.max(inst.attack + inst.decay, len) + inst.release,
      );
    };
    if (inst.kind === "kick" || inst.kind === "snare" || inst.kind === "hat") {
      if (inst.kind === "kick") {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(150, at);
        o.frequency.exponentialRampToValueAtTime(40, at + 0.12);
        g.gain.setValueAtTime(peak, at);
        g.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
        o.connect(g);
        o.start(at);
        o.stop(at + 0.2);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = inst.kind === "hat" ? "highpass" : "bandpass";
      f.frequency.value = inst.kind === "hat" ? 7000 : 1800;
      const len = inst.kind === "hat" ? 0.04 : 0.12;
      g.gain.setValueAtTime(peak, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + len);
      src.connect(f).connect(g);
      src.start(at, Math.random() * 0.5);
      src.stop(at + len + 0.02);
      return;
    }
    const freq = noteFreq(note);
    if (!freq) return;
    env(dur);
    const end = at + Math.max(inst.attack + inst.decay, dur) + inst.release + 0.05;
    if (inst.kind === "fm") {
      const car = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const mg = ctx.createGain();
      car.frequency.value = freq;
      mod.frequency.value = freq * inst.ratio;
      mg.gain.setValueAtTime(freq * inst.index, at);
      mg.gain.exponentialRampToValueAtTime(
        Math.max(1, freq * inst.index * 0.2),
        at + Math.max(0.05, dur),
      );
      mod.connect(mg).connect(car.frequency);
      car.connect(g);
      car.start(at);
      mod.start(at);
      car.stop(end);
      mod.stop(end);
      return;
    }
    const o = ctx.createOscillator();
    if (inst.kind === "square" && Math.abs(inst.duty - 0.5) > 0.01)
      o.setPeriodicWave(pulseWave(ctx, inst.duty));
    else o.type = inst.kind === "noise" ? "square" : (inst.kind as OscillatorType);
    o.frequency.value = freq;
    o.detune.value = inst.detune;
    o.connect(g);
    o.start(at);
    o.stop(end);
  }
}

const waveCache = new Map<number, PeriodicWave>();
function pulseWave(ctx: AudioContext, duty: number): PeriodicWave {
  const key = Math.round(duty * 100);
  let w = waveCache.get(key);
  if (w) return w;
  const n = 32;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 1; i < n; i++) imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
  w = ctx.createPeriodicWave(real, imag);
  waveCache.set(key, w);
  return w;
}

type Step = [instrument: string, note: string, holdRows: number][];
const expandCache = new WeakMap<TrackFile, Step[]>();

function rowsOf(t: TrackFile): number {
  return expand(t).length;
}

/** Flattens patterns in order into rows of [instrument, note, holdRows]. */
function expand(t: TrackFile): Step[] {
  const cached = expandCache.get(t);
  if (cached) return cached;
  const rows: Step[] = [];
  for (const name of t.order) {
    const pat = t.patterns[name] ?? {};
    const chans = Object.entries(pat).map(([inst, s]) => [inst, s.trim().split(/\s+/)] as const);
    const len = Math.max(0, ...chans.map(([, toks]) => toks.length));
    for (let r = 0; r < len; r++) {
      const step: Step = [];
      for (const [inst, toks] of chans) {
        const tok = toks[r];
        if (!tok || tok === "." || tok === "-") continue;
        let hold = 1;
        while (toks[r + hold] === "-") hold++;
        step.push([inst, tok, hold]);
      }
      rows.push(step);
    }
  }
  expandCache.set(t, rows);
  return rows;
}
