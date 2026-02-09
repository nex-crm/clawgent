/**
 * CLAWGENT — Retro Arcade Sound Engine
 *
 * All sounds synthesized via the Web Audio API. No external audio files.
 * Inspired by SF2/CPS-1/SNK cabinet bleeps, bloops, and fanfares.
 *
 * Usage:
 *   import { ArcadeSounds } from '@/lib/sounds';
 *   ArcadeSounds.initAudio();      // call on first user interaction
 *   ArcadeSounds.cursorMove();      // play a sound
 *   ArcadeSounds.toggleMute();      // toggle mute
 *   ArcadeSounds.isMuted();         // check mute state
 */

// ─── Singleton AudioContext ──────────────────────────────────────────

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;

const MASTER_VOLUME = 0.25; // moderate global volume
const STORAGE_KEY = "clawgent-sound-muted";

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    // Lazy-init on first sound call (must be inside a user gesture)
    ArcadeSounds.initAudio();
  }
  if (ctx && ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

function getMaster(): GainNode | null {
  if (!masterGain) return null;
  return masterGain;
}

// ─── Envelope Helper ─────────────────────────────────────────────────

interface EnvelopeOpts {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  peak?: number;
}

function applyEnvelope(
  gainNode: GainNode,
  startTime: number,
  duration: number,
  opts: EnvelopeOpts = {}
): void {
  const {
    attack = 0.005,
    decay = 0.05,
    sustain = 0.6,
    release = 0.05,
    peak = 1,
  } = opts;

  const g = gainNode.gain;
  g.setValueAtTime(0, startTime);
  g.linearRampToValueAtTime(peak, startTime + attack);
  g.linearRampToValueAtTime(peak * sustain, startTime + attack + decay);
  g.setValueAtTime(peak * sustain, startTime + duration - release);
  g.linearRampToValueAtTime(0, startTime + duration);
}

// ─── Oscillator Helpers ──────────────────────────────────────────────

function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = "square",
  volume: number = 0.5,
  envelope?: EnvelopeOpts
): void {
  const c = ensureCtx();
  const m = getMaster();
  if (!c || !m) return;

  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);

  gain.gain.setValueAtTime(0, c.currentTime);
  osc.connect(gain);
  gain.connect(m);

  applyEnvelope(gain, c.currentTime, duration, {
    peak: volume,
    ...envelope,
  });

  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration + 0.05);
}

function playSweep(
  freqStart: number,
  freqEnd: number,
  duration: number,
  type: OscillatorType = "sawtooth",
  volume: number = 0.4,
  envelope?: EnvelopeOpts
): void {
  const c = ensureCtx();
  const m = getMaster();
  if (!c || !m) return;

  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(freqEnd, 20),
    c.currentTime + duration
  );

  gain.gain.setValueAtTime(0, c.currentTime);
  osc.connect(gain);
  gain.connect(m);

  applyEnvelope(gain, c.currentTime, duration, {
    peak: volume,
    ...envelope,
  });

  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration + 0.05);
}

function playNoise(
  duration: number,
  volume: number = 0.3,
  filterFreq?: number,
  filterType: BiquadFilterType = "bandpass"
): void {
  const c = ensureCtx();
  const m = getMaster();
  if (!c || !m) return;

  const bufferSize = c.sampleRate * duration;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = c.createBufferSource();
  source.buffer = buffer;

  const gain = c.createGain();
  applyEnvelope(gain, c.currentTime, duration, {
    peak: volume,
    attack: 0.005,
    release: 0.02,
  });

  if (filterFreq) {
    const filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, c.currentTime);
    filter.Q.setValueAtTime(2, c.currentTime);
    source.connect(filter);
    filter.connect(gain);
  } else {
    source.connect(gain);
  }

  gain.connect(m);
  source.start(c.currentTime);
  source.stop(c.currentTime + duration + 0.05);
}

function playNoiseSweep(
  duration: number,
  freqStart: number,
  freqEnd: number,
  volume: number = 0.3
): void {
  const c = ensureCtx();
  const m = getMaster();
  if (!c || !m) return;

  const bufferSize = c.sampleRate * duration;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = c.createBufferSource();
  source.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.setValueAtTime(3, c.currentTime);
  filter.frequency.setValueAtTime(freqStart, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(freqEnd, 20),
    c.currentTime + duration
  );

  const gain = c.createGain();
  applyEnvelope(gain, c.currentTime, duration, {
    peak: volume,
    attack: 0.005,
    release: 0.03,
  });

  source.connect(filter);
  filter.connect(gain);
  gain.connect(m);

  source.start(c.currentTime);
  source.stop(c.currentTime + duration + 0.05);
}

// ─── Arpeggio Helper ─────────────────────────────────────────────────

function playArpeggio(
  notes: number[],
  noteLength: number,
  type: OscillatorType = "square",
  volume: number = 0.35
): void {
  const c = ensureCtx();
  const m = getMaster();
  if (!c || !m) return;

  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);

    const startTime = c.currentTime + i * noteLength;
    gain.gain.setValueAtTime(0, startTime);
    applyEnvelope(gain, startTime, noteLength, {
      peak: volume,
      attack: 0.003,
      decay: noteLength * 0.3,
      sustain: 0.4,
      release: noteLength * 0.2,
    });

    osc.connect(gain);
    gain.connect(m);

    osc.start(startTime);
    osc.stop(startTime + noteLength + 0.05);
  });
}

// ─── Public API ──────────────────────────────────────────────────────

export const ArcadeSounds = {
  /**
   * Initialize AudioContext. Must be called from a user interaction
   * event handler (click/keydown) to satisfy browser autoplay policy.
   */
  initAudio(): void {
    if (typeof window === "undefined") return;
    if (ctx) {
      // Resume if suspended (happens after tab switch)
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      return;
    }

    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(MASTER_VOLUME, ctx.currentTime);
    masterGain.connect(ctx.destination);

    // Restore mute preference from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "true") {
        muted = true;
        masterGain.gain.setValueAtTime(0, ctx.currentTime);
      }
    } catch {
      // localStorage unavailable
    }
  },

  /** Toggle mute on/off. Returns new muted state. */
  toggleMute(): boolean {
    muted = !muted;
    const m = getMaster();
    const c = ensureCtx();
    if (m && c) {
      m.gain.setValueAtTime(muted ? 0 : MASTER_VOLUME, c.currentTime);
    }
    try {
      localStorage.setItem(STORAGE_KEY, String(muted));
    } catch {
      // localStorage unavailable
    }
    return muted;
  },

  /** Check current mute state. */
  isMuted(): boolean {
    return muted;
  },

  // ─── Navigation ──────────────────────────────────────────────

  /** Short blip when hovering/selecting persona grid items (SF2 cursor move). */
  cursorMove(): void {
    // 1200Hz square wave, 30ms, quick decay
    playTone(1200, 0.03, "square", 0.2, {
      attack: 0.002,
      decay: 0.015,
      sustain: 0.2,
      release: 0.01,
    });
  },

  /** Confirmation beep when selecting a persona — two-tone ascending. */
  select(): void {
    const c = ensureCtx();
    if (!c) return;
    // 800Hz -> 1200Hz, two quick tones
    playTone(800, 0.06, "square", 0.3, {
      attack: 0.003,
      decay: 0.02,
      sustain: 0.5,
      release: 0.01,
    });
    setTimeout(() => {
      playTone(1200, 0.08, "square", 0.35, {
        attack: 0.003,
        decay: 0.03,
        sustain: 0.4,
        release: 0.02,
      });
    }, 70);
  },

  /** Lower-pitched blip for going back. */
  back(): void {
    // Descending two-tone: 800Hz -> 500Hz
    playTone(800, 0.05, "square", 0.25, {
      attack: 0.003,
      decay: 0.02,
      sustain: 0.4,
      release: 0.01,
    });
    setTimeout(() => {
      playTone(500, 0.07, "square", 0.2, {
        attack: 0.003,
        decay: 0.03,
        sustain: 0.3,
        release: 0.02,
      });
    }, 60);
  },

  // ─── Screen transitions ──────────────────────────────────────

  /** Whoosh/sweep sound for screen changes — bandpass-filtered noise sweep. */
  screenTransition(): void {
    playNoiseSweep(0.2, 200, 2000, 0.15);
  },

  // ─── Deploy sequence ─────────────────────────────────────────

  /** Engine rev / power-up sound when deploy begins. */
  deployStart(): void {
    // Ascending sawtooth sweep + noise burst
    playSweep(80, 800, 0.5, "sawtooth", 0.3, {
      attack: 0.01,
      decay: 0.1,
      sustain: 0.6,
      release: 0.1,
    });
    playNoise(0.15, 0.1, 1500, "highpass");
  },

  /** Subtle tick/pulse for each log line during deploy. */
  deployProgress(): void {
    playTone(600, 0.025, "square", 0.1, {
      attack: 0.002,
      decay: 0.01,
      sustain: 0.2,
      release: 0.005,
    });
  },

  /**
   * Victory fanfare — C major arpeggio (C5->E5->G5->C6).
   * SF2 "YOU WIN" energy, kept short at ~1.2s.
   */
  deploySuccess(): void {
    // C5=523, E5=659, G5=784, C6=1047
    playArpeggio([523, 659, 784, 1047], 0.12, "square", 0.3);
    // Add a sustained final note with triangle for warmth
    setTimeout(() => {
      playTone(1047, 0.4, "triangle", 0.2, {
        attack: 0.01,
        decay: 0.15,
        sustain: 0.3,
        release: 0.2,
      });
    }, 480);
  },

  /** Sad trombone / error buzz — descending minor sequence. */
  deployError(): void {
    // Bb4=466, A4=440, Ab4=415, G4=392 — descending chromatic sadness
    playArpeggio([466, 440, 415, 392], 0.15, "sawtooth", 0.25);
    // Add a low buzz
    setTimeout(() => {
      playTone(100, 0.3, "sawtooth", 0.15, {
        attack: 0.01,
        decay: 0.1,
        sustain: 0.5,
        release: 0.1,
      });
    }, 600);
  },

  // ─── Actions ─────────────────────────────────────────────────

  /** Very subtle high-frequency tick on button hover. */
  buttonHover(): void {
    playTone(2400, 0.015, "sine", 0.08, {
      attack: 0.001,
      decay: 0.005,
      sustain: 0.1,
      release: 0.005,
    });
  },

  /** Satisfying click/confirm. */
  buttonClick(): void {
    playTone(900, 0.04, "square", 0.25, {
      attack: 0.002,
      decay: 0.015,
      sustain: 0.3,
      release: 0.01,
    });
  },

  /** Explosion/power-down sound for destroying an instance. */
  destroy(): void {
    // White noise burst
    playNoise(0.2, 0.35, undefined);
    // Descending sawtooth sweep (500Hz -> 50Hz over 300ms)
    playSweep(500, 50, 0.35, "sawtooth", 0.3, {
      attack: 0.005,
      decay: 0.05,
      sustain: 0.6,
      release: 0.1,
    });
    // Low rumble
    setTimeout(() => {
      playTone(60, 0.2, "triangle", 0.2, {
        attack: 0.01,
        decay: 0.05,
        sustain: 0.5,
        release: 0.1,
      });
    }, 150);
  },

  // ─── TTL warnings ────────────────────────────────────────────

  /** Urgent beep — SF2 low-health warning, 440Hz square beeping. */
  ttlWarning(): void {
    playTone(440, 0.08, "square", 0.2, {
      attack: 0.003,
      decay: 0.02,
      sustain: 0.5,
      release: 0.02,
    });
    setTimeout(() => {
      playTone(440, 0.08, "square", 0.2, {
        attack: 0.003,
        decay: 0.02,
        sustain: 0.5,
        release: 0.02,
      });
    }, 200);
  },

  /** "TIME OVER" sound — descending tone. */
  ttlExpired(): void {
    playSweep(800, 100, 0.6, "square", 0.3, {
      attack: 0.005,
      decay: 0.1,
      sustain: 0.4,
      release: 0.15,
    });
  },

  // ─── Auth ────────────────────────────────────────────────────

  /**
   * Coin insert sound — classic arcade coin-op feel.
   * Descending chirp then ascending bright confirmation.
   */
  signIn(): void {
    // Initial coin clunk: short high blip
    playTone(1800, 0.03, "square", 0.3, {
      attack: 0.001,
      decay: 0.01,
      sustain: 0.2,
      release: 0.01,
    });
    // Descending coin tumble
    setTimeout(() => {
      playSweep(2000, 800, 0.08, "square", 0.25, {
        attack: 0.002,
        decay: 0.02,
        sustain: 0.4,
        release: 0.02,
      });
    }, 40);
    // Ascending confirmation ding
    setTimeout(() => {
      playSweep(600, 1400, 0.12, "square", 0.3, {
        attack: 0.003,
        decay: 0.03,
        sustain: 0.5,
        release: 0.03,
      });
    }, 150);
    // Final bright ping
    setTimeout(() => {
      playTone(1400, 0.1, "sine", 0.2, {
        attack: 0.003,
        decay: 0.03,
        sustain: 0.3,
        release: 0.04,
      });
    }, 280);
  },

  /** Power down — descending sweep with decay. */
  signOut(): void {
    playSweep(600, 80, 0.4, "square", 0.2, {
      attack: 0.005,
      decay: 0.1,
      sustain: 0.3,
      release: 0.15,
    });
  },

  // ─── Fun ─────────────────────────────────────────────────────

  /** Classic KO impact for when "IT'S ALIVE" shows. */
  koSound(): void {
    // Impact hit: noise burst + low thud
    playNoise(0.08, 0.35);
    playTone(150, 0.15, "square", 0.35, {
      attack: 0.002,
      decay: 0.03,
      sustain: 0.6,
      release: 0.05,
    });
    // Ascending triumph sweep
    setTimeout(() => {
      playSweep(200, 1000, 0.2, "sawtooth", 0.25, {
        attack: 0.005,
        decay: 0.05,
        sustain: 0.5,
        release: 0.05,
      });
    }, 100);
    // High sting
    setTimeout(() => {
      playTone(1200, 0.15, "square", 0.2, {
        attack: 0.005,
        decay: 0.05,
        sustain: 0.3,
        release: 0.05,
      });
    }, 250);
  },
};
