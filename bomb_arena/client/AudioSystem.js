/**
 * Bomb Arena 3D - every sound is synthesized with the Web Audio API: bomb drops, the fuse hiss,
 * big explosions (noise burst + falling sub thump), crates splintering, power-up jingles, kicks,
 * knock-outs, countdown beeps, round / match fanfares and the sudden-death siren.
 */
export class AudioSystem {
  constructor() { this.ctx = null; try { this.on = localStorage.getItem('baSound') !== '0'; } catch (e) { this.on = true; } }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.on ? 0.55 : 0; this.master.connect(c.destination);
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }
  toggle() { this.on = !this.on; try { localStorage.setItem('baSound', this.on ? '1' : '0'); } catch (e) {} if (this.master) this.master.gain.value = this.on ? 0.55 : 0; return this.on; }
  tone(freq, dur, type = 'square', vol = 0.12, when = 0, slide = 0) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol = 0.2, freq = 1000, when = 0, type = 'lowpass') {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime + when, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  drop() { this.tone(180, 0.12, 'triangle', 0.18, 0, 0.6); this.noise(0.05, 0.08, 3000); }
  boom(near) { const v = near ? 0.55 : 0.25; this.noise(0.9, v, 900); this.tone(110, 0.7, 'sine', v * 0.8, 0, 0.3); this.noise(0.25, v * 0.5, 4000, 0, 'highpass'); }
  crate() { this.noise(0.18, 0.15, 1800); this.tone(260, 0.08, 'square', 0.05, 0, 0.6); }
  pickup() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.09, 'square', 0.07, i * 0.05)); }
  kick() { this.tone(140, 0.1, 'square', 0.12, 0, 2); this.noise(0.06, 0.1, 2500); }
  die() { this.tone(660, 0.6, 'square', 0.1, 0, 0.2); this.noise(0.4, 0.15, 1500); }
  beep(go) { this.tone(go ? 1046 : 523, go ? 0.45 : 0.18, 'square', 0.11); }
  win() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'square', 0.09, i * 0.13)); }
  lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.1, i * 0.18)); }
  siren() { for (let i = 0; i < 4; i++) { this.tone(600, 0.25, 'sawtooth', 0.06, i * 0.5, 1.6); this.tone(960, 0.25, 'sawtooth', 0.06, i * 0.5 + 0.25, 0.62); } }
  thud() { this.noise(0.15, 0.12, 400); }
}
