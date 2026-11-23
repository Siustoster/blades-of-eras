/**
 * audio.ts — Web Audio synthesized SFX + generative per-era music + mute toggle (remembered in localStorage).
 * No audio asset files at all — everything is synthesized at runtime.
 */

import type { EraConfig } from "./config";

export type SfxId =
  | "whoosh"
  | "clang"
  | "thud"
  | "step"
  | "ui"
  | "win"
  | "lose"
  | "cue" // enemy windup warning glint
  | "count"
  | "spark";

const MUTE_KEY = "game.muted";

// localStorage can throw (storage disabled, private mode, third-party storage blocked
// inside a preview iframe) — a game must never fail to start because of that.
function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeMuted(v: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    // not persisted this session; the in-memory flag still works
  }
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private disposed = false;
  muted = false;

  // generative music state
  private musicTimer: number | null = null;
  private nextStep = 0;
  private stepIdx = 0;
  private eraMusic: EraConfig["music"] | null = null;
  private tension = 0;

  // browsers require a first user interaction before the AudioContext can start
  private readonly unlock = () => {
    this.ensureCtx();
    this.detachUnlock();
  };

  constructor() {
    this.muted = readMuted();
    window.addEventListener("pointerdown", this.unlock);
    window.addEventListener("keydown", this.unlock);
  }

  private detachUnlock(): void {
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
  }

  /**
   * Release everything: unlock listeners, the music scheduler and the AudioContext.
   * Call it from your teardown path (stopGame) next to input.dispose() — otherwise React
   * StrictMode's double mount / HMR leaks one AudioContext per mount, and Chrome caps a
   * page at about six of them.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachUnlock();
    this.stopMusic();
    this.master?.disconnect();
    this.master = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.musicFilter = this.ctx.createBiquadFilter();
      this.musicFilter.type = "lowpass";
      this.musicFilter.frequency.value = 900;
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.35;
      this.musicBus.connect(this.musicFilter).connect(this.master);
      // 1s of white noise, reused by every percussive sound
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    writeMuted(this.muted);
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  /** 0..1 — opens the music filter while the enemy winds up (tension). */
  setTension(v: number): void {
    this.tension = v;
    if (this.musicFilter && this.ctx) {
      const f = 900 + 2600 * v;
      this.musicFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
    }
  }

  /* --------------------------------- SFX --------------------------------- */

  private blip(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, when = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterFreq: number, type: BiquadFilterType = "bandpass", when = 0, q = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = filterFreq;
    flt.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt).connect(env).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  sfx(id: SfxId): void {
    if (this.disposed || this.muted) return; // muted: no context is created either
    this.ensureCtx();
    switch (id) {
      case "whoosh":
        this.noise(0.22, 0.22, 1400, "bandpass", 0, 2.5);
        break;
      case "clang": {
        // metallic: a few inharmonic partials + a short noise burst
        this.blip("sine", 1830, 1700, 0.5, 0.16);
        this.blip("sine", 2740, 2400, 0.4, 0.1);
        this.blip("sine", 3960, 3100, 0.28, 0.07);
        this.noise(0.06, 0.2, 5000, "highpass");
        break;
      }
      case "thud":
        this.blip("sine", 140, 45, 0.22, 0.4);
        this.noise(0.1, 0.22, 500, "lowpass");
        break;
      case "step":
        this.noise(0.05, 0.1, 400, "lowpass");
        break;
      case "ui":
        this.blip("sine", 440, 560, 0.06, 0.14);
        break;
      case "cue":
        // rising glint — enemy is about to strike
        this.blip("sine", 1200, 2600, 0.18, 0.12);
        this.blip("sine", 1800, 3600, 0.14, 0.06, 0.04);
        break;
      case "count":
        this.blip("triangle", 660, 660, 0.08, 0.16);
        break;
      case "spark":
        this.noise(0.08, 0.16, 6200, "highpass");
        break;
      case "win":
        this.blip("triangle", 523, 523, 0.16, 0.2);
        this.blip("triangle", 659, 659, 0.16, 0.2, 0.16);
        this.blip("triangle", 784, 784, 0.34, 0.22, 0.32);
        break;
      case "lose":
        this.blip("sawtooth", 220, 110, 0.5, 0.2);
        this.blip("sawtooth", 165, 82, 0.7, 0.16, 0.3);
        break;
    }
  }

  /* -------------------------------- music -------------------------------- */

  /** Generative per-era loop: bass pulse + scale arpeggio (+ percussion), 8th-note grid. */
  startMusic(music: EraConfig["music"]): void {
    if (this.disposed) return;
    this.ensureCtx();
    this.stopMusic();
    this.eraMusic = music;
    this.stepIdx = 0;
    const ctx = this.ctx!;
    this.nextStep = ctx.currentTime + 0.1;
    const stepDur = () => 60 / (this.eraMusic?.bpm ?? 100) / 2;
    const tick = () => {
      if (this.disposed || !this.eraMusic || !this.ctx || !this.musicBus || this.muted) return;
      const m = this.eraMusic;
      // lookahead scheduling: stay 0.15 s ahead of the clock
      while (this.nextStep < this.ctx.currentTime + 0.15) {
        const when = Math.max(0, this.nextStep - this.ctx.currentTime);
        this.scheduleStep(this.stepIdx, when, m);
        this.nextStep += stepDur();
        this.stepIdx++;
      }
    };
    this.musicTimer = window.setInterval(tick, 50);
    tick();
  }

  private note(freq: number, dur: number, gain: number, wave: OscillatorType, when: number, glide = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    if (glide > 0) osc.frequency.exponentialRampToValueAtTime(glide, t + dur);
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private scheduleStep(i: number, when: number, m: EraConfig["music"]): void {
    const root = 110; // A2
    const f = (semi: number) => root * Math.pow(2, semi / 12);
    // bass
    if (i % m.bassEvery === 0) {
      const bassWave: OscillatorType = m.percussive ? "sine" : m.wave;
      this.note(f(0) / 2, 0.5, 0.34, bassWave, when);
    }
    // arpeggio / melody: walk the scale with a slow sine drift so it does not sound like a loop
    const sc = m.scale;
    const idx = Math.abs(Math.floor(Math.sin(i * 0.7) * sc.length * 0.999) + i) % sc.length;
    const playMelody = m.percussive ? i % 2 === 0 : i % 4 === 2;
    if (playMelody) {
      this.note(f(sc[idx]) * 2, m.percussive ? 0.12 : 0.4, m.percussive ? 0.1 : 0.13, m.wave, when);
    }
    // percussion: taiko-ish thump / techno hat from shaped noise
    if (m.percussive && this.ctx && this.noiseBuf && this.musicBus) {
      if (i % 8 === 0) {
        this.note(70, 0.25, 0.4, "sine", when, 40); // taiko boom
      }
      if (i % 4 === 2) {
        const t = this.ctx.currentTime + when;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const env = this.ctx.createGain();
        const flt = this.ctx.createBiquadFilter();
        flt.type = "highpass";
        flt.frequency.value = 6000;
        env.gain.setValueAtTime(0.05 + this.tension * 0.05, t);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(flt).connect(env).connect(this.musicBus);
        src.start(t);
        src.stop(t + 0.08);
      }
    }
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.eraMusic = null;
    this.setTension(0);
  }
}
