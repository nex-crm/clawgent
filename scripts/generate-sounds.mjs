#!/usr/bin/env node
/**
 * CLAWGENT — Arcade Sound WAV Generator
 *
 * Synthesizes all 16 arcade sound effects as 16-bit PCM mono WAV files
 * using pure Node.js math (no browser APIs). Drop-in replacement for
 * the Web Audio API synthesis that was causing perceivable lag.
 *
 * Usage:  node scripts/generate-sounds.mjs
 * Output: app/public/sounds/*.wav
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "app", "public", "sounds");

const SAMPLE_RATE = 44100;
const TWO_PI = 2 * Math.PI;

// ─── Waveform generators (return -1..1) ─────────────────────────────

function squareWave(phase) {
  return phase % TWO_PI < Math.PI ? 1 : -1;
}

function sawtoothWave(phase) {
  const t = (phase % TWO_PI) / TWO_PI;
  return 2 * t - 1;
}

function sineWave(phase) {
  return Math.sin(phase);
}

function triangleWave(phase) {
  const t = (phase % TWO_PI) / TWO_PI;
  return t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
}

function whiteNoise() {
  return Math.random() * 2 - 1;
}

function getWaveformFn(type) {
  switch (type) {
    case "square":
      return squareWave;
    case "sawtooth":
      return sawtoothWave;
    case "sine":
      return sineWave;
    case "triangle":
      return triangleWave;
    default:
      return squareWave;
  }
}

// ─── ADSR envelope ──────────────────────────────────────────────────

/**
 * Compute ADSR gain at time t within a note of given duration.
 * @param {number} t     - time in seconds from note start
 * @param {number} dur   - total note duration in seconds
 * @param {object} opts  - { attack, decay, sustain, release, peak }
 * @returns {number} gain 0..peak
 */
function adsr(t, dur, opts = {}) {
  const {
    attack = 0.005,
    decay = 0.05,
    sustain = 0.6,
    release = 0.05,
    peak = 1,
  } = opts;

  if (t < 0 || t > dur) return 0;

  const releaseStart = dur - release;

  if (t < attack) {
    // Attack: 0 -> peak
    return peak * (t / attack);
  } else if (t < attack + decay) {
    // Decay: peak -> peak*sustain
    const frac = (t - attack) / decay;
    return peak * (1 - frac * (1 - sustain));
  } else if (t < releaseStart) {
    // Sustain
    return peak * sustain;
  } else {
    // Release: peak*sustain -> 0
    const frac = (t - releaseStart) / release;
    return peak * sustain * (1 - frac);
  }
}

// ─── Tone generator (fixed frequency) ───────────────────────────────

/**
 * Generate a fixed-frequency tone into a Float64Array buffer.
 * @param {Float64Array} buf    - output buffer (added, not replaced)
 * @param {number}       freq   - frequency in Hz
 * @param {number}       start  - start time in seconds
 * @param {number}       dur    - duration in seconds
 * @param {string}       type   - waveform type
 * @param {number}       vol    - peak volume
 * @param {object}       env    - ADSR envelope opts
 */
function addTone(buf, freq, start, dur, type = "square", vol = 0.5, env = {}) {
  const waveFn = getWaveformFn(type);
  const startSample = Math.floor(start * SAMPLE_RATE);
  const numSamples = Math.ceil(dur * SAMPLE_RATE);
  let phase = 0;
  const phaseInc = (TWO_PI * freq) / SAMPLE_RATE;

  for (let i = 0; i < numSamples; i++) {
    const idx = startSample + i;
    if (idx >= buf.length) break;
    const t = i / SAMPLE_RATE;
    const gain = adsr(t, dur, { peak: vol, ...env });
    buf[idx] += waveFn(phase) * gain;
    phase += phaseInc;
  }
}

// ─── Sweep generator (exponential frequency ramp) ───────────────────

function addSweep(
  buf,
  freqStart,
  freqEnd,
  start,
  dur,
  type = "sawtooth",
  vol = 0.4,
  env = {}
) {
  const waveFn = getWaveformFn(type);
  const startSample = Math.floor(start * SAMPLE_RATE);
  const numSamples = Math.ceil(dur * SAMPLE_RATE);
  let phase = 0;

  // Ensure freqEnd is at least 20Hz to avoid log(0) issues
  const fEnd = Math.max(freqEnd, 20);
  const logStart = Math.log(freqStart);
  const logEnd = Math.log(fEnd);

  for (let i = 0; i < numSamples; i++) {
    const idx = startSample + i;
    if (idx >= buf.length) break;
    const t = i / SAMPLE_RATE;
    const frac = t / dur;
    // Exponential interpolation in log-frequency space
    const freq = Math.exp(logStart + (logEnd - logStart) * frac);
    const gain = adsr(t, dur, { peak: vol, ...env });
    buf[idx] += waveFn(phase) * gain;
    phase += (TWO_PI * freq) / SAMPLE_RATE;
  }
}

// ─── Noise generator ────────────────────────────────────────────────

function addNoise(buf, start, dur, vol = 0.3, env = {}) {
  const startSample = Math.floor(start * SAMPLE_RATE);
  const numSamples = Math.ceil(dur * SAMPLE_RATE);

  for (let i = 0; i < numSamples; i++) {
    const idx = startSample + i;
    if (idx >= buf.length) break;
    const t = i / SAMPLE_RATE;
    const gain = adsr(t, dur, { peak: vol, ...env });
    buf[idx] += whiteNoise() * gain;
  }
}

// ─── Simple IIR filters ─────────────────────────────────────────────

/**
 * Apply a single-pole highpass filter in-place.
 * cutoff in Hz, approximate via: alpha = 1 / (1 + 2*pi*cutoff/sampleRate)
 */
function applyHighpass(buf, cutoff, startSample = 0, numSamples = buf.length) {
  const RC = 1 / (TWO_PI * cutoff);
  const dt = 1 / SAMPLE_RATE;
  const alpha = RC / (RC + dt);
  let prev = 0;
  let prevOut = 0;

  const end = Math.min(startSample + numSamples, buf.length);
  for (let i = startSample; i < end; i++) {
    const x = buf[i];
    prevOut = alpha * (prevOut + x - prev);
    prev = x;
    buf[i] = prevOut;
  }
}

/**
 * Apply a resonant bandpass filter (biquad approximation).
 * centerFreq in Hz, Q is resonance.
 */
function applyBandpass(
  buf,
  centerFreq,
  Q = 2,
  startSample = 0,
  numSamples = buf.length
) {
  const w0 = (TWO_PI * centerFreq) / SAMPLE_RATE;
  const sinW0 = Math.sin(w0);
  const cosW0 = Math.cos(w0);
  const alpha = sinW0 / (2 * Q);

  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  // Normalize
  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  const end = Math.min(startSample + numSamples, buf.length);
  for (let i = startSample; i < end; i++) {
    const x0 = buf[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    buf[i] = y0;
  }
}

/**
 * Apply a sweeping bandpass filter (center frequency ramps exponentially).
 * Process block-by-block with updated filter coefficients.
 */
function applyBandpassSweep(
  buf,
  freqStart,
  freqEnd,
  Q = 3,
  startSample = 0,
  numSamples = buf.length
) {
  const logStart = Math.log(freqStart);
  const logEnd = Math.log(Math.max(freqEnd, 20));
  const end = Math.min(startSample + numSamples, buf.length);
  const totalSamples = end - startSample;

  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;

  for (let i = startSample; i < end; i++) {
    const frac = (i - startSample) / totalSamples;
    const freq = Math.exp(logStart + (logEnd - logStart) * frac);

    const w0 = (TWO_PI * freq) / SAMPLE_RATE;
    const sinW0 = Math.sin(w0);
    const cosW0 = Math.cos(w0);
    const alpha = sinW0 / (2 * Q);

    const a0 = 1 + alpha;
    const nb0 = alpha / a0;
    const nb2 = -alpha / a0;
    const na1 = (-2 * cosW0) / a0;
    const na2 = (1 - alpha) / a0;

    const x0 = buf[i];
    const y0 = nb0 * x0 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    buf[i] = y0;
  }
}

// ─── WAV writer ─────────────────────────────────────────────────────

/**
 * Write a Float64Array as 16-bit PCM mono WAV file.
 * Clamps values to -1..1 before quantizing.
 */
function writeWav(filePath, buf) {
  const numSamples = buf.length;
  const bitsPerSample = 16;
  const byteRate = (SAMPLE_RATE * bitsPerSample) / 8;
  const blockAlign = bitsPerSample / 8;
  const dataSize = numSamples * blockAlign;
  const fileSize = 44 + dataSize;

  const out = Buffer.alloc(fileSize);

  // RIFF header
  out.write("RIFF", 0);
  out.writeUInt32LE(fileSize - 8, 4);
  out.write("WAVE", 8);

  // fmt chunk
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16); // chunk size
  out.writeUInt16LE(1, 20); // PCM format
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(SAMPLE_RATE, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  out.write("data", 36);
  out.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    let sample = buf[i];
    // Clamp to -1..1
    if (sample > 1) sample = 1;
    if (sample < -1) sample = -1;
    // Convert to 16-bit signed integer
    const int16 = Math.round(sample * 32767);
    out.writeInt16LE(int16, 44 + i * 2);
  }

  writeFileSync(filePath, out);
}

// ─── Buffer allocation helper ───────────────────────────────────────

function createBuffer(durationSeconds) {
  const numSamples = Math.ceil(SAMPLE_RATE * durationSeconds);
  return new Float64Array(numSamples);
}

// ─── Sound definitions ──────────────────────────────────────────────

function genCursorMove() {
  // 1200Hz square, 30ms, vol 0.2, attack=0.002 decay=0.015 sustain=0.2 release=0.01
  const dur = 0.03;
  const buf = createBuffer(dur + 0.02);
  addTone(buf, 1200, 0, dur, "square", 0.2, {
    attack: 0.002,
    decay: 0.015,
    sustain: 0.2,
    release: 0.01,
  });
  return buf;
}

function genSelect() {
  // Two tones: 800Hz square 60ms then 1200Hz square 80ms at t=70ms
  const totalDur = 0.07 + 0.08 + 0.05;
  const buf = createBuffer(totalDur);
  addTone(buf, 800, 0, 0.06, "square", 0.3, {
    attack: 0.003,
    decay: 0.02,
    sustain: 0.5,
    release: 0.01,
  });
  addTone(buf, 1200, 0.07, 0.08, "square", 0.35, {
    attack: 0.003,
    decay: 0.03,
    sustain: 0.4,
    release: 0.02,
  });
  return buf;
}

function genBack() {
  // Two tones: 800Hz square 50ms then 500Hz square 70ms at t=60ms
  const totalDur = 0.06 + 0.07 + 0.05;
  const buf = createBuffer(totalDur);
  addTone(buf, 800, 0, 0.05, "square", 0.25, {
    attack: 0.003,
    decay: 0.02,
    sustain: 0.4,
    release: 0.01,
  });
  addTone(buf, 500, 0.06, 0.07, "square", 0.2, {
    attack: 0.003,
    decay: 0.03,
    sustain: 0.3,
    release: 0.02,
  });
  return buf;
}

function genScreenTransition() {
  // Bandpass noise sweep 200->2000Hz, 200ms, vol 0.15
  const dur = 0.2;
  const buf = createBuffer(dur + 0.05);

  // Generate white noise with envelope
  addNoise(buf, 0, dur, 0.15, {
    attack: 0.005,
    release: 0.03,
  });

  // Apply sweeping bandpass filter
  applyBandpassSweep(buf, 200, 2000, 3, 0, buf.length);

  // Boost the signal since bandpass attenuates significantly
  for (let i = 0; i < buf.length; i++) {
    buf[i] *= 4;
  }

  return buf;
}

function genDeployStart() {
  // Sawtooth sweep 80->800Hz 500ms + highpass noise burst 150ms
  const dur = 0.5 + 0.05;
  const buf = createBuffer(dur);

  addSweep(buf, 80, 800, 0, 0.5, "sawtooth", 0.3, {
    attack: 0.01,
    decay: 0.1,
    sustain: 0.6,
    release: 0.1,
  });

  // Noise burst with highpass filter - generate into separate buffer then mix
  const noiseBuf = createBuffer(dur);
  addNoise(noiseBuf, 0, 0.15, 0.1, {
    attack: 0.005,
    release: 0.02,
  });
  applyHighpass(noiseBuf, 1500, 0, noiseBuf.length);

  // Boost highpassed noise (filter attenuates)
  for (let i = 0; i < noiseBuf.length; i++) {
    buf[i] += noiseBuf[i] * 3;
  }

  return buf;
}

function genDeployProgress() {
  // 600Hz square 25ms, vol 0.1, very short tick
  const dur = 0.025;
  const buf = createBuffer(dur + 0.02);
  addTone(buf, 600, 0, dur, "square", 0.1, {
    attack: 0.002,
    decay: 0.01,
    sustain: 0.2,
    release: 0.005,
  });
  return buf;
}

function genDeploySuccess() {
  // Arpeggio C5(523) E5(659) G5(784) C6(1047) at 120ms each, square
  // + final sustained 1047Hz triangle 400ms
  const noteLen = 0.12;
  const notes = [523, 659, 784, 1047];
  const totalDur = notes.length * noteLen + 0.4 + 0.05;
  const buf = createBuffer(totalDur);

  notes.forEach((freq, i) => {
    addTone(buf, freq, i * noteLen, noteLen, "square", 0.3, {
      attack: 0.003,
      decay: noteLen * 0.3,
      sustain: 0.4,
      release: noteLen * 0.2,
    });
  });

  // Final sustained note
  addTone(buf, 1047, 0.48, 0.4, "triangle", 0.2, {
    attack: 0.01,
    decay: 0.15,
    sustain: 0.3,
    release: 0.2,
  });

  return buf;
}

function genDeployError() {
  // Arpeggio Bb4(466) A4(440) Ab4(415) G4(392) at 150ms each, sawtooth
  // + low 100Hz buzz at 600ms
  const noteLen = 0.15;
  const notes = [466, 440, 415, 392];
  const totalDur = 0.6 + 0.3 + 0.15;
  const buf = createBuffer(totalDur);

  notes.forEach((freq, i) => {
    addTone(buf, freq, i * noteLen, noteLen, "sawtooth", 0.25, {
      attack: 0.003,
      decay: noteLen * 0.3,
      sustain: 0.4,
      release: noteLen * 0.2,
    });
  });

  // Low buzz
  addTone(buf, 100, 0.6, 0.3, "sawtooth", 0.15, {
    attack: 0.01,
    decay: 0.1,
    sustain: 0.5,
    release: 0.1,
  });

  return buf;
}

function genButtonHover() {
  // 2400Hz sine 15ms, vol 0.08
  const dur = 0.015;
  const buf = createBuffer(dur + 0.02);
  addTone(buf, 2400, 0, dur, "sine", 0.08, {
    attack: 0.001,
    decay: 0.005,
    sustain: 0.1,
    release: 0.005,
  });
  return buf;
}

function genButtonClick() {
  // 900Hz square 40ms, vol 0.25
  const dur = 0.04;
  const buf = createBuffer(dur + 0.02);
  addTone(buf, 900, 0, dur, "square", 0.25, {
    attack: 0.002,
    decay: 0.015,
    sustain: 0.3,
    release: 0.01,
  });
  return buf;
}

function genDestroy() {
  // White noise 200ms + sawtooth sweep 500->50Hz 350ms + triangle 60Hz at 150ms
  const totalDur = 0.35 + 0.15;
  const buf = createBuffer(totalDur);

  // White noise burst
  addNoise(buf, 0, 0.2, 0.35, {
    attack: 0.005,
    release: 0.02,
  });

  // Descending sawtooth sweep
  addSweep(buf, 500, 50, 0, 0.35, "sawtooth", 0.3, {
    attack: 0.005,
    decay: 0.05,
    sustain: 0.6,
    release: 0.1,
  });

  // Low rumble
  addTone(buf, 60, 0.15, 0.2, "triangle", 0.2, {
    attack: 0.01,
    decay: 0.05,
    sustain: 0.5,
    release: 0.1,
  });

  return buf;
}

function genTtlWarning() {
  // Two 440Hz square beeps: 80ms each at t=0 and t=200ms
  const totalDur = 0.2 + 0.08 + 0.05;
  const buf = createBuffer(totalDur);

  addTone(buf, 440, 0, 0.08, "square", 0.2, {
    attack: 0.003,
    decay: 0.02,
    sustain: 0.5,
    release: 0.02,
  });
  addTone(buf, 440, 0.2, 0.08, "square", 0.2, {
    attack: 0.003,
    decay: 0.02,
    sustain: 0.5,
    release: 0.02,
  });

  return buf;
}

function genTtlExpired() {
  // Square sweep 800->100Hz over 600ms
  const dur = 0.6;
  const buf = createBuffer(dur + 0.05);
  addSweep(buf, 800, 100, 0, dur, "square", 0.3, {
    attack: 0.005,
    decay: 0.1,
    sustain: 0.4,
    release: 0.15,
  });
  return buf;
}

function genSignIn() {
  // Coin insert:
  // 1800Hz blip 30ms
  // square sweep 2000->800Hz at 40ms
  // square sweep 600->1400Hz at 150ms
  // sine 1400Hz at 280ms
  const totalDur = 0.28 + 0.1 + 0.05;
  const buf = createBuffer(totalDur);

  // Initial coin clunk: short high blip
  addTone(buf, 1800, 0, 0.03, "square", 0.3, {
    attack: 0.001,
    decay: 0.01,
    sustain: 0.2,
    release: 0.01,
  });

  // Descending coin tumble
  addSweep(buf, 2000, 800, 0.04, 0.08, "square", 0.25, {
    attack: 0.002,
    decay: 0.02,
    sustain: 0.4,
    release: 0.02,
  });

  // Ascending confirmation ding
  addSweep(buf, 600, 1400, 0.15, 0.12, "square", 0.3, {
    attack: 0.003,
    decay: 0.03,
    sustain: 0.5,
    release: 0.03,
  });

  // Final bright ping
  addTone(buf, 1400, 0.28, 0.1, "sine", 0.2, {
    attack: 0.003,
    decay: 0.03,
    sustain: 0.3,
    release: 0.04,
  });

  return buf;
}

function genSignOut() {
  // Square sweep 600->80Hz over 400ms
  const dur = 0.4;
  const buf = createBuffer(dur + 0.05);
  addSweep(buf, 600, 80, 0, dur, "square", 0.2, {
    attack: 0.005,
    decay: 0.1,
    sustain: 0.3,
    release: 0.15,
  });
  return buf;
}

function genKo() {
  // Noise burst 80ms + 150Hz square 150ms + sawtooth sweep 200->1000Hz at 100ms + 1200Hz square at 250ms
  const totalDur = 0.25 + 0.15 + 0.05;
  const buf = createBuffer(totalDur);

  // Impact noise burst
  addNoise(buf, 0, 0.08, 0.35, {
    attack: 0.002,
    release: 0.01,
  });

  // Low thud
  addTone(buf, 150, 0, 0.15, "square", 0.35, {
    attack: 0.002,
    decay: 0.03,
    sustain: 0.6,
    release: 0.05,
  });

  // Ascending triumph sweep
  addSweep(buf, 200, 1000, 0.1, 0.2, "sawtooth", 0.25, {
    attack: 0.005,
    decay: 0.05,
    sustain: 0.5,
    release: 0.05,
  });

  // High sting
  addTone(buf, 1200, 0.25, 0.15, "square", 0.2, {
    attack: 0.005,
    decay: 0.05,
    sustain: 0.3,
    release: 0.05,
  });

  return buf;
}

// ─── Main ───────────────────────────────────────────────────────────

const SOUNDS = [
  { name: "cursor-move", gen: genCursorMove },
  { name: "select", gen: genSelect },
  { name: "back", gen: genBack },
  { name: "screen-transition", gen: genScreenTransition },
  { name: "deploy-start", gen: genDeployStart },
  { name: "deploy-progress", gen: genDeployProgress },
  { name: "deploy-success", gen: genDeploySuccess },
  { name: "deploy-error", gen: genDeployError },
  { name: "button-hover", gen: genButtonHover },
  { name: "button-click", gen: genButtonClick },
  { name: "destroy", gen: genDestroy },
  { name: "ttl-warning", gen: genTtlWarning },
  { name: "ttl-expired", gen: genTtlExpired },
  { name: "sign-in", gen: genSignIn },
  { name: "sign-out", gen: genSignOut },
  { name: "ko", gen: genKo },
];

mkdirSync(OUT_DIR, { recursive: true });

console.log(`Generating ${SOUNDS.length} arcade sound effects...`);
console.log(`Output: ${OUT_DIR}\n`);

for (const { name, gen } of SOUNDS) {
  const buf = gen();
  const filePath = join(OUT_DIR, `${name}.wav`);
  writeWav(filePath, buf);
  const sizeKB = (buf.length * 2 + 44) / 1024;
  const durMs = Math.round((buf.length / SAMPLE_RATE) * 1000);
  console.log(
    `  ${name}.wav  ${durMs}ms  ${sizeKB.toFixed(1)}KB`
  );
}

console.log("\nDone.");
