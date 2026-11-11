/**
 * AudioSystem: every sound is synthesised with the Web Audio API (no asset files).
 * World sounds take a position and are panned / attenuated relative to the listener.
 */
export class AudioSystem {
  constructor() {
    this.ac = null;
    this.master = null;
    this.on = true;
    try { this.on = localStorage.getItem('hldmSound') !== 'off'; } catch (e) {}
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.noiseBuf = null;
  }

  unlock() {
    if (!this.on) return null;
    if (!this.ac) {
      try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      this.master = this.ac.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ac.destination);
      const len = this.ac.sampleRate * 1.5;
      this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ac.state === 'suspended') this.ac.resume();
    return this.ac;
  }

  toggle() { this.on = !this.on; try { localStorage.setItem('hldmSound', this.on ? 'on' : 'off'); } catch (e) {} if (this.on) this.unlock(); return this.on; }

  setListener(x, y, z, yaw) { Object.assign(this.listener, { x, y, z, yaw }); }

  /** Output node for a sound: gain + stereo pan from its world position (or centred). */
  out(pos, vol = 1) {
    const a = this.unlock(); if (!a) return null;
    const g = a.createGain();
    let gain = vol;
    if (pos) {
      const L = this.listener, dx = pos[0] - L.x, dy = pos[1] - L.y, dz = pos[2] - L.z, d = Math.hypot(dx, dy, dz);
      gain *= 1 / (1 + d * 0.09);
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
    src.buffer = this.noiseBuf; src.playbackRate.value = 0.9 + Math.random() * 0.2;
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

  // ---------- weapons
  gun(w, pos, vol = 1) {
    const o = this.out(pos, vol); if (!o) return;
    switch (w) {
      case 1: this.noise(o, 0.18, { freq: 900, to: 2600, vol: 0.5 }); break;                                        // crowbar swing
      case 2: case 12: this.noise(o, 0.13, { freq: 2200, to: 600, vol: 0.9 }); this.tone(o, 180, 0.08, { vol: 0.5, to: 60 }); break;
      case 3: this.noise(o, 0.5, { freq: 1100, to: 200, vol: 1.3, type: 'lowpass' }); this.tone(o, 90, 0.35, { vol: 0.9, to: 35 }); break;
      case 4: this.noise(o, 0.09, { freq: 2600, to: 900, vol: 0.75 }); this.tone(o, 140, 0.06, { vol: 0.4, to: 60 }); break;
      case 40: this.tone(o, 160, 0.25, { vol: 0.8, to: 50 }); this.noise(o, 0.15, { freq: 500, vol: 0.5, type: 'lowpass' }); break;  // grenade launcher
      case 5: case 15: this.noise(o, w === 15 ? 0.7 : 0.5, { freq: 900, to: 150, vol: w === 15 ? 1.6 : 1.2, type: 'lowpass' }); this.tone(o, 70, 0.4, { vol: 1, to: 30 });
        this.noise(o, 0.06, { freq: 3000, vol: 0.3, delay: 0.45 }); this.noise(o, 0.06, { freq: 2500, vol: 0.3, delay: 0.58 }); break;   // pump
      case 6: this.tone(o, 520, 0.22, { type: 'triangle', vol: 0.5, to: 120 }); this.noise(o, 0.08, { freq: 3500, vol: 0.3 }); break;
      case 7: this.noise(o, 0.9, { freq: 300, to: 2400, vol: 0.9 }); this.tone(o, 110, 0.3, { vol: 0.6, to: 50 }); break;
      case 9: this.noise(o, 0.16, { freq: 1700, to: 500, vol: 1.15 }); this.tone(o, 110, 0.12, { vol: 0.7, to: 45 }); this.noise(o, 0.35, { freq: 500, to: 150, vol: 0.35, type: 'lowpass', delay: 0.03 }); break;   // AK-47: heavy crack
      case 10: this.noise(o, 0.11, { freq: 2600, to: 800, vol: 0.85 }); this.tone(o, 150, 0.08, { vol: 0.45, to: 60 }); this.noise(o, 0.2, { freq: 900, to: 250, vol: 0.2, type: 'lowpass', delay: 0.02 }); break;   // M4A1: sharper, tighter
      case 11: this.noise(o, 0.25, { freq: 600, to: 1800, vol: 0.35 }); this.noise(o, 0.04, { freq: 4000, vol: 0.3 }); break;   // grenade: pin + throw whoosh
      case 8:                                                                                                   // AWP: crack, echo, bolt
        this.noise(o, 0.12, { freq: 3500, to: 900, vol: 1.6 }); this.tone(o, 75, 0.6, { vol: 1.2, to: 30 });
        this.noise(o, 1.4, { freq: 700, to: 120, vol: 0.5, type: 'lowpass', delay: 0.05 });
        this.noise(o, 0.07, { freq: 2600, vol: 0.4, delay: 0.55 }); this.noise(o, 0.07, { freq: 1900, vol: 0.4, delay: 0.75 }); break;
    }
  }
  bounce(pos) { const o = this.out(pos, 0.8); if (o) { this.tone(o, 900 + Math.random() * 300, 0.08, { type: 'triangle', vol: 0.25 }); this.noise(o, 0.05, { freq: 2500, vol: 0.3 }); } }
  drop(pos) { const o = this.out(pos, 0.6); if (o) { this.noise(o, 0.08, { freq: 1400, vol: 0.5 }); this.tone(o, 320, 0.12, { type: 'triangle', vol: 0.15, delay: 0.25 }); this.noise(o, 0.06, { freq: 800, vol: 0.4, delay: 0.25 }); } }
  melee(kind, pos) {
    const o = this.out(pos, 1); if (!o) return;
    if (kind === 2) { this.noise(o, 0.12, { freq: 400, vol: 1, type: 'lowpass' }); this.tone(o, 90, 0.12, { vol: 0.6 }); }
    else if (kind === 1) { for (const f of [1180, 1720, 2630]) this.tone(o, f, 0.35, { type: 'triangle', vol: 0.25 }); }
  }
  explosion(pos) {
    const o = this.out(pos, 2.2); if (!o) return;
    this.noise(o, 1.6, { freq: 900, to: 80, vol: 1.6, type: 'lowpass', attack: 0.005 });
    this.tone(o, 60, 1.0, { vol: 1.2, to: 25 });
  }
  boltHit(pos) { const o = this.out(pos, 1); if (o) { this.noise(o, 0.08, { freq: 1500, vol: 0.7 }); this.tone(o, 300, 0.1, { type: 'square', vol: 0.15, to: 120 }); } }
  reload(w) { const o = this.out(null, 0.6); if (!o) return; this.noise(o, 0.05, { freq: 2600, vol: 0.6 }); this.noise(o, 0.05, { freq: 1800, vol: 0.6, delay: w === 5 ? 0.5 : 0.35 }); this.noise(o, 0.06, { freq: 3000, vol: 0.5, delay: w === 5 ? 1.1 : 0.7 }); }
  empty() { const o = this.out(null, 0.5); if (o) this.noise(o, 0.04, { freq: 4000, vol: 0.6 }); }
  switchWeapon() { const o = this.out(null, 0.4); if (o) { this.noise(o, 0.05, { freq: 2200, vol: 0.5 }); this.noise(o, 0.05, { freq: 1600, vol: 0.5, delay: 0.12 }); } }

  // ---------- player feedback
  footstep(pos, metal) { const o = this.out(pos, 0.35); if (o) this.noise(o, 0.09, { freq: metal ? 1800 : 500, vol: 0.9, type: metal ? 'bandpass' : 'lowpass', q: metal ? 2 : 0.7 }); }
  hitmarker(head) { const o = this.out(null, 0.5); if (o) this.tone(o, head ? 1900 : 1300, head ? 0.18 : 0.06, { type: head ? 'triangle' : 'square', vol: head ? 0.5 : 0.25 }); }
  hurt() { const o = this.out(null, 0.7); if (o) { this.tone(o, 150, 0.25, { type: 'sawtooth', vol: 0.3, to: 70 }); this.noise(o, 0.12, { freq: 400, vol: 0.5, type: 'lowpass' }); } }
  death() { const o = this.out(null, 0.8); if (o) { this.tone(o, 330, 0.9, { type: 'sawtooth', vol: 0.25, to: 55 }); this.noise(o, 0.5, { freq: 300, vol: 0.5, type: 'lowpass' }); } }
  frag() { const o = this.out(null, 0.6); if (o) { this.tone(o, 880, 0.12, { type: 'square', vol: 0.15 }); this.tone(o, 1320, 0.2, { type: 'square', vol: 0.15, delay: 0.1 }); } }
  pickup(kind) {
    const o = this.out(null, 0.6); if (!o) return;
    if (kind === 'weapon' || kind === 'ammo') { this.noise(o, 0.06, { freq: 1800, vol: 0.6 }); this.noise(o, 0.08, { freq: 900, vol: 0.6, delay: 0.1 }); }
    else this.tone(o, kind === 'battery' ? 600 : 520, 0.25, { type: 'triangle', vol: 0.35, to: kind === 'battery' ? 1200 : 880 });
  }
  spawn() { const o = this.out(null, 0.5); if (o) this.tone(o, 440, 0.3, { type: 'triangle', vol: 0.3, to: 880 }); }
}
