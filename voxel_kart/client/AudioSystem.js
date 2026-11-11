/**
 * Voxel Kart Racing - every sound is synthesized with the Web Audio API (no audio files):
 * an engine whose pitch follows the speed, a tyre screech while drifting, boost whooshes,
 * item-box chimes and the roulette ticker, shells, bananas, lightning, bumps, laps, countdown
 * beeps and a little finish fanfare.
 */
export class AudioSystem {
  constructor() {
    this.ctx = null;
    try { this.on = localStorage.getItem('vkSound') !== '0'; } catch (e) { this.on = true; }
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.on ? 0.5 : 0; this.master.connect(c.destination);
    // engine: two detuned square waves through a low-pass
    this.eng = c.createGain(); this.eng.gain.value = 0;
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 900;
    this.o1 = c.createOscillator(); this.o1.type = 'square';
    this.o2 = c.createOscillator(); this.o2.type = 'sawtooth'; this.o2.detune.value = 9;
    this.o1.connect(this.engF); this.o2.connect(this.engF); this.engF.connect(this.eng); this.eng.connect(this.master);
    this.o1.start(); this.o2.start();
    // screech: band-passed noise
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const n = c.createBufferSource(); n.buffer = buf; n.loop = true;
    this.scrF = c.createBiquadFilter(); this.scrF.type = 'bandpass'; this.scrF.frequency.value = 2200; this.scrF.Q.value = 3;
    this.scr = c.createGain(); this.scr.gain.value = 0;
    n.connect(this.scrF); this.scrF.connect(this.scr); this.scr.connect(this.master); n.start();
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('vkSound', this.on ? '1' : '0'); } catch (e) {}
    if (this.master) this.master.gain.value = this.on ? 0.5 : 0;
    return this.on;
  }

  /** Continuous sounds, every frame: speed (m/s), drift tier (-1 none), boosting, running at all. */
  motion(speed, drift, boost, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = Math.min(1.3, speed / 26);
    this.o1.frequency.setTargetAtTime(48 + k * 120 + (boost ? 30 : 0), t, 0.05);
    this.o2.frequency.setTargetAtTime(49 + k * 122 + (boost ? 30 : 0), t, 0.05);
    this.engF.frequency.setTargetAtTime(500 + k * 1600, t, 0.08);
    this.eng.gain.setTargetAtTime(active ? 0.05 + k * 0.05 : 0, t, 0.1);
    this.scr.gain.setTargetAtTime(drift >= 0 && active ? 0.05 + drift * 0.02 : 0, t, 0.04);
    this.scrF.frequency.setTargetAtTime(1800 + Math.max(0, drift) * 500, t, 0.05);
  }

  tone(freq, dur, type = 'square', vol = 0.15, when = 0, slide = 0) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol = 0.2, freq = 800, when = 0) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  box() { [660, 880, 1320].forEach((f, i) => this.tone(f, 0.12, 'square', 0.08, i * 0.05)); }
  roulette() { this.tone(1200 + Math.random() * 400, 0.03, 'square', 0.04); }
  itemReady() { this.tone(988, 0.08, 'square', 0.08); this.tone(1318, 0.14, 'square', 0.08, 0.07); }
  turbo(tier) { this.noise(0.35 + tier * 0.1, 0.15, 2500); this.tone(200, 0.4, 'sawtooth', 0.06, 0, 3); }
  hop() { this.tone(300, 0.08, 'square', 0.05, 0, 1.8); }
  boost() { this.noise(0.6, 0.2, 3000); this.tone(150, 0.6, 'sawtooth', 0.07, 0, 4); }
  shell() { this.tone(500, 0.15, 'square', 0.08, 0, 0.5); }
  banana() { this.tone(400, 0.12, 'triangle', 0.1, 0, 0.6); }
  hit() { this.noise(0.4, 0.3, 1200); this.tone(220, 0.5, 'square', 0.1, 0, 0.3); }
  slip() { this.tone(900, 0.4, 'triangle', 0.1, 0, 0.3); }
  bump() { this.noise(0.12, 0.2, 500); }
  bonk() { this.noise(0.15, 0.25, 400); this.tone(90, 0.15, 'square', 0.08); }
  lightning() { this.noise(0.9, 0.35, 5000); this.tone(1600, 0.6, 'sawtooth', 0.08, 0, 0.1); }
  shrink() { this.tone(900, 0.5, 'square', 0.07, 0, 0.3); }
  lap(final) { (final ? [523, 659, 784, 1046] : [784, 988]).forEach((f, i) => this.tone(f, 0.15, 'square', 0.09, i * 0.1)); }
  beep(go) { this.tone(go ? 1046 : 523, go ? 0.5 : 0.22, 'square', 0.12); }
  finish(place) {
    const good = place <= 3;
    const notes = good ? [523, 659, 784, 1046, 784, 1046] : [392, 330, 294, 262];
    notes.forEach((f, i) => this.tone(f, 0.2, 'square', 0.1, i * 0.14));
  }
  rescue() { this.tone(700, 0.5, 'sine', 0.08, 0, 0.5); }
}
