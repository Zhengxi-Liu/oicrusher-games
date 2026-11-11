/**
 * AudioSystem: every sound is synthesised with the Web Audio API (no asset files).
 * World sounds take a position and are panned / attenuated relative to the listener.
 * Two loops run underneath: rain on the rooftops and wind that rises with the runner's speed.
 */
export class AudioSystem {
  constructor() {
    this.ac = null;
    this.master = null;
    this.on = true;
    try { this.on = localStorage.getItem('rtSound') !== 'off'; } catch (e) {}
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.noiseBuf = null;
    this.slideGain = null;
  }

  unlock() {
    if (!this.on) return null;
    if (!this.ac) {
      try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      this.master = this.ac.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ac.destination);
      const len = this.ac.sampleRate * 2;
      this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startLoops();
    }
    if (this.ac.state === 'suspended') this.ac.resume();
    return this.ac;
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('rtSound', this.on ? 'on' : 'off'); } catch (e) {}
    if (this.on) this.unlock(); else if (this.ac) this.ac.suspend();
    return this.on;
  }

  /** A filtered-noise loop with its own gain (rain, wind, slide scrape). */
  loop(type, freq, q, vol) {
    const a = this.ac, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = this.noiseBuf; src.loop = true;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { f, g };
  }

  startLoops() {
    this.rain = this.loop('highpass', 2500, 0.3, 0.05);
    this.rainLow = this.loop('lowpass', 500, 0.5, 0.05);
    this.wind = this.loop('bandpass', 600, 0.7, 0);
    this.scrape = this.loop('bandpass', 1800, 1.2, 0);
  }

  /** Per frame: wind follows speed, the scrape follows sliding. */
  motion(speed, sliding, wallrun) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const w = Math.max(0, Math.min(1, (speed - 7) / 14));
    this.wind.g.gain.setTargetAtTime(w * 0.35, t, 0.15);
    this.wind.f.frequency.setTargetAtTime(400 + w * 900, t, 0.2);
    this.scrape.g.gain.setTargetAtTime(sliding ? 0.18 : wallrun ? 0.08 : 0, t, 0.05);
    this.scrape.f.frequency.setTargetAtTime(sliding ? 1200 + speed * 40 : 2600, t, 0.1);
  }

  setListener(x, y, z, yaw) { Object.assign(this.listener, { x, y, z, yaw }); }

  out(pos, vol = 1) {
    const a = this.unlock(); if (!a) return null;
    const g = a.createGain();
    let gain = vol;
    if (pos) {
      const L = this.listener, dx = pos[0] - L.x, dy = pos[1] - L.y, dz = pos[2] - L.z, d = Math.hypot(dx, dy, dz);
      gain *= 1 / (1 + d * 0.08);
      if (gain < 0.01) return null;
      const right = dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw);
      if (a.createStereoPanner) {
        const p = a.createStereoPanner(); p.pan.value = Math.max(-0.9, Math.min(0.9, right / (Math.abs(right) + 3)));
        p.connect(this.master); g.connect(p);
      } else g.connect(this.master);
    } else g.connect(this.master);
    g.gain.value = gain;
    return g;
  }

  noise(dest, dur, { freq = 1500, to = 0, q = 0.8, type = 'bandpass', vol = 1, delay = 0, attack = 0.002 } = {}) {
    if (!dest) return;
    const a = this.ac, t = a.currentTime + delay;
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = this.noiseBuf;
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  tone(dest, freq, dur, { type = 'sine', to = 0, vol = 1, delay = 0 } = {}) {
    if (!dest) return;
    const a = this.ac, t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------- actions
  tag(pos) { const o = this.out(pos, 0.8); if (!o) return; this.tone(o, 1400, 0.16, { type: 'sawtooth', to: 220, vol: 0.35 }); this.tone(o, 2800, 0.06, { type: 'square', vol: 0.12, to: 900 }); this.noise(o, 0.06, { freq: 5000, vol: 0.3 }); }
  hookFire() { const o = this.out(null, 0.6); if (!o) return; this.noise(o, 0.18, { freq: 900, to: 3600, vol: 0.5 }); this.tone(o, 300, 0.1, { type: 'square', vol: 0.12, to: 700 }); }
  hookLatch(pos) { const o = this.out(pos, 0.8); if (!o) return; this.tone(o, 180, 0.12, { type: 'square', vol: 0.3, to: 90 }); this.noise(o, 0.08, { freq: 3000, vol: 0.5 }); this.tone(o, 900, 0.5, { type: 'triangle', vol: 0.1, to: 1500 }); }
  hookMiss() { const o = this.out(null, 0.5); if (o) this.noise(o, 0.25, { freq: 2000, to: 600, vol: 0.3 }); }
  hookRelease() { const o = this.out(null, 0.4); if (o) this.noise(o, 0.12, { freq: 1500, to: 400, vol: 0.4 }); }
  pad(pos) { const o = this.out(pos, 1); if (!o) return; this.tone(o, 120, 0.45, { type: 'sine', to: 620, vol: 0.6 }); this.tone(o, 240, 0.3, { type: 'triangle', to: 1200, vol: 0.2 }); this.noise(o, 0.3, { freq: 600, to: 3000, vol: 0.3 }); }
  slide() { const o = this.out(null, 0.5); if (o) this.noise(o, 0.2, { freq: 900, to: 2400, vol: 0.4 }); }
  wallJump(pos) { const o = this.out(pos, 0.7); if (!o) return; this.noise(o, 0.1, { freq: 700, vol: 0.6, type: 'lowpass' }); this.tone(o, 420, 0.12, { type: 'triangle', vol: 0.2, to: 700 }); }
  jump() { const o = this.out(null, 0.35); if (o) this.noise(o, 0.08, { freq: 500, vol: 0.5, type: 'lowpass' }); }
  land(speed) { const o = this.out(null, Math.min(1, 0.2 + speed / 25)); if (o) { this.noise(o, 0.12, { freq: 260, vol: 0.9, type: 'lowpass' }); this.noise(o, 0.05, { freq: 2600, vol: 0.2 }); } }
  footstep(wet) { const o = this.out(null, 0.25); if (o) this.noise(o, 0.07, { freq: wet ? 1400 : 600, vol: 0.8, q: wet ? 1.5 : 0.7 }); }

  // ---------- feedback
  hitmarker() { const o = this.out(null, 0.5); if (o) this.tone(o, 1500, 0.07, { type: 'square', vol: 0.2 }); }
  hurt() { const o = this.out(null, 0.6); if (o) { this.tone(o, 160, 0.25, { type: 'sawtooth', vol: 0.25, to: 70 }); this.noise(o, 0.12, { freq: 400, vol: 0.4, type: 'lowpass' }); } }
  derez(pos) { const o = this.out(pos, 1); if (!o) return; this.tone(o, 900, 0.6, { type: 'sawtooth', vol: 0.2, to: 60 }); this.noise(o, 0.5, { freq: 4000, to: 300, vol: 0.4 }); }
  fall() { const o = this.out(null, 0.7); if (o) this.tone(o, 700, 1.2, { type: 'sine', vol: 0.3, to: 80 }); }
  frag() { const o = this.out(null, 0.5); if (o) { this.tone(o, 880, 0.1, { type: 'square', vol: 0.12 }); this.tone(o, 1320, 0.18, { type: 'square', vol: 0.12, delay: 0.09 }); } }
  spawn() { const o = this.out(null, 0.5); if (o) this.tone(o, 330, 0.35, { type: 'triangle', vol: 0.25, to: 990 }); }
  /** good = our team benefits (we took / captured / returned); bad = the enemy did. */
  flagAlert(good) {
    const o = this.out(null, 0.7); if (!o) return;
    const notes = good ? [660, 880, 1320] : [520, 390, 260];
    notes.forEach((f, i) => this.tone(o, f, 0.22, { type: 'square', vol: 0.12, delay: i * 0.1 }));
  }
  capture(good) {
    const o = this.out(null, 0.9); if (!o) return;
    const notes = good ? [523, 659, 784, 1047, 1319] : [392, 330, 262, 196];
    notes.forEach((f, i) => { this.tone(o, f, 0.35, { type: 'sawtooth', vol: 0.1, delay: i * 0.11 }); this.tone(o, f * 2, 0.3, { type: 'triangle', vol: 0.06, delay: i * 0.11 }); });
  }
}
