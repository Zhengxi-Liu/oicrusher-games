/**
 * AudioSystem - every sound is synthesised with the Web Audio API.
 *   engine: two detuned sawtooth oscillators (cylinder firing) through a low-pass, plus propeller
 *           "beat" (noise amplitude-modulated at the blade-pass frequency); pitch follows RPM,
 *           which follows the throttle and windmills with airspeed
 *   wind:   filtered noise rising with airspeed (and with sideslip / high alpha buffet)
 *   one-shots: stall horn, tyre chirps, runway rumble, ring chime, flap motor, crash
 *   weapons: cannon, hits, missile launch roar, warhead boom (distance-delayed), flares,
 *            the AIM-9 seeker tone (a low growl while searching, a high steady tone when locked), missile warning
 */
export class AudioSystem {
  constructor() {
    this.ac = null;
    this.on = true;
    try { this.on = localStorage.getItem('fsSound') !== 'off'; } catch (e) {}
    this.cockpit = false;
  }

  unlock() {
    if (!this.on) return null;
    if (!this.ac) {
      try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      const a = this.ac;
      this.master = a.createGain(); this.master.gain.value = 0.55; this.master.connect(a.destination);
      const len = a.sampleRate * 2;
      this.noise = a.createBuffer(1, len, a.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // engine
      this.engGain = a.createGain(); this.engGain.gain.value = 0;
      this.engFilter = a.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600; this.engFilter.Q.value = 2;
      this.osc1 = a.createOscillator(); this.osc1.type = 'sawtooth';
      this.osc2 = a.createOscillator(); this.osc2.type = 'square';
      const o2g = a.createGain(); o2g.gain.value = 0.35;
      this.osc1.connect(this.engFilter); this.osc2.connect(o2g).connect(this.engFilter);
      this.engFilter.connect(this.engGain).connect(this.master);
      this.osc1.start(); this.osc2.start();
      // propeller beat: noise * LFO
      const pn = a.createBufferSource(); pn.buffer = this.noise; pn.loop = true;
      const pf = a.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = 300; pf.Q.value = 0.6;
      this.propAmp = a.createGain(); this.propAmp.gain.value = 0;
      this.lfo = a.createOscillator(); this.lfo.frequency.value = 20;
      this.lfoDepth = a.createGain(); this.lfoDepth.gain.value = 0;
      this.lfo.connect(this.lfoDepth).connect(this.propAmp.gain);
      pn.connect(pf).connect(this.propAmp).connect(this.master);
      pn.start(); this.lfo.start();
      // wind
      const wn = a.createBufferSource(); wn.buffer = this.noise; wn.loop = true;
      this.windFilter = a.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.5;
      this.windGain = a.createGain(); this.windGain.gain.value = 0;
      wn.connect(this.windFilter).connect(this.windGain).connect(this.master); wn.start();
      // ground rumble
      const rn = a.createBufferSource(); rn.buffer = this.noise; rn.loop = true;
      const rf = a.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 140;
      this.rumble = a.createGain(); this.rumble.gain.value = 0;
      rn.connect(rf).connect(this.rumble).connect(this.master); rn.start();
      // stall horn
      this.horn = a.createOscillator(); this.horn.type = 'square'; this.horn.frequency.value = 520;
      this.hornGain = a.createGain(); this.hornGain.gain.value = 0;
      const hf = a.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1400;
      this.horn.connect(hf).connect(this.hornGain).connect(this.master); this.horn.start();
    }
    if (this.ac.state === 'suspended') this.ac.resume();
    return this.ac;
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('fsSound', this.on ? 'on' : 'off'); } catch (e) {}
    if (this.on) this.unlock(); else if (this.ac) this.ac.suspend();
    return this.on;
  }

  /** Per frame. engine 0..1 (spooled throttle), ias m/s, stall 0..1, rolling speed on the ground (0 = airborne). */
  update({ engine, ias, stall, warn, rolling, crashed, alpha, jet = false, fan = false, afterburner = false }) {
    if (!this.ac || !this.on) return;
    const t = this.ac.currentTime, k = 0.08;
    const rpm = crashed ? 0 : Math.max(0.12 + 0.88 * engine, Math.min(0.6, ias / 120));       // windmilling
    // a turbine whines high and roars; a piston engine thrums low
    const f = jet ? (fan ? 150 + rpm * 330 : 180 + rpm * 520) : 32 + rpm * 78;
    this.osc1.frequency.setTargetAtTime(f, t, k); this.osc2.frequency.setTargetAtTime(f * 1.505, t, k);
    this.engFilter.frequency.setTargetAtTime(jet ? (fan ? 900 + rpm * 1700 : 1200 + rpm * 2500) : 300 + rpm * 1500 + engine * 600, t, k);
    const cockpitMul = this.cockpit ? 1.25 : 0.9;
    this.engGain.gain.setTargetAtTime(crashed ? 0 : (jet ? 0.03 + engine * 0.05 : 0.07 + engine * 0.16) * cockpitMul, t, k);
    this.lfo.frequency.setTargetAtTime(f * 2 / 3, t, k);
    this.propAmp.gain.setTargetAtTime(crashed ? 0 : jet ? 0.06 + engine * 0.12 + (afterburner ? 0.18 : 0) : 0.03 + engine * 0.07, t, k);
    this.lfoDepth.gain.setTargetAtTime(crashed || jet ? 0 : 0.03 + engine * 0.06, t, k);
    const w = Math.min(1, ias / 85);
    this.windGain.gain.setTargetAtTime(crashed ? 0 : w * w * (this.cockpit ? 0.18 : 0.3) + stall * 0.12, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + w * 1400 + Math.abs(alpha || 0) * 800, t, 0.2);
    this.rumble.gain.setTargetAtTime(rolling > 0.5 ? Math.min(0.5, rolling / 40) : 0, t, 0.05);
    const hornOn = warn && !crashed && Math.sin(t * Math.PI * 6) > -0.2;
    this.hornGain.gain.setTargetAtTime(hornOn ? 0.07 : 0, t, 0.01);
  }

  burst(dur, { freq = 1000, to = 0, q = 1, type = 'bandpass', vol = 1, delay = 0 } = {}) {
    if (!this.unlock()) return;
    const a = this.ac, t0 = a.currentTime + delay, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = this.noise; f.type = type; f.frequency.setValueAtTime(freq, t0); if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur); f.Q.value = q;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
  }
  tone(freq, dur, { type = 'sine', to = 0, vol = 0.3, delay = 0 } = {}) {
    if (!this.unlock()) return;
    const a = this.ac, t0 = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  touchdown(vs) { const v = Math.min(1, 0.25 + vs / 3); this.burst(0.25, { freq: 2400, to: 900, q: 2, vol: v * 0.6 }); this.burst(0.15, { freq: 180, type: 'lowpass', vol: v }); }
  ring() { [880, 1320, 1760].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.16, delay: i * 0.06 })); }
  finish() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.4, { type: 'triangle', vol: 0.18, delay: i * 0.11 })); }
  miss() { this.tone(330, 0.3, { type: 'square', vol: 0.08, to: 200 }); }
  flaps() { this.tone(220, 0.9, { type: 'sawtooth', vol: 0.025, to: 260 }); }
  crash() {                                                    // impact crunch, the boom, then the fire crackling
    this.burst(0.35, { freq: 3500, to: 600, q: 0.8, vol: 0.7 });
    this.burst(3.2, { freq: 1400, to: 40, type: 'lowpass', vol: 1.6, delay: 0.03 });
    this.tone(55, 1.8, { vol: 0.7, to: 22, delay: 0.03 });
    for (let i = 0; i < 14; i++) this.burst(0.05 + Math.random() * 0.08, { freq: 1500 + Math.random() * 3000, q: 2, vol: 0.12 + Math.random() * 0.15, delay: 0.5 + Math.random() * 3 });
  }
  gun() {                                                      // one round of the cannon's rip
    if (!this.ac || !this.on) return;
    this.burst(0.05, { freq: 1600, to: 300, q: 0.7, vol: 0.32 }); this.tone(90 + Math.random() * 30, 0.04, { type: 'square', vol: 0.06 });
  }
  hit() { this.burst(0.12, { freq: 2600, to: 900, q: 2, vol: 0.5 }); this.burst(0.2, { freq: 300, type: 'lowpass', vol: 0.6 }); }
  gear() { this.tone(160, 2.5, { type: 'sawtooth', vol: 0.03, to: 210 }); this.burst(0.15, { freq: 500, type: 'lowpass', vol: 0.3, delay: 2.4 }); }
  pop() { this.burst(0.09, { freq: 2200, to: 500, q: 0.9, vol: 0.9 }); this.tone(260, 0.12, { type: 'triangle', vol: 0.12, to: 120 }); }
  hoop(i, n) { const f = 523 * Math.pow(2, (i - 1) / 8); (i >= n ? [f, f * 1.25, f * 1.5, f * 2] : [f, f * 1.5]).forEach((x, k) => this.tone(x, 0.25, { type: 'triangle', vol: 0.15, delay: k * 0.07 })); }
  missileLaunch(dist = 0) {                                     // the motor lighting off the rail: a roar and a long hiss
    const v = Math.min(1, 300 / Math.max(300, dist)), d = Math.min(3, dist / 340);
    if (v < 0.03) return;
    this.burst(0.25, { freq: 2600, to: 700, q: 0.7, vol: 0.7 * v, delay: d });
    this.burst(2.2, { freq: 900, to: 160, type: 'lowpass', vol: 0.9 * v, delay: d + 0.05 });
    this.burst(1.6, { freq: 4500, to: 2000, q: 0.6, vol: 0.15 * v, delay: d + 0.05 });
  }
  boom(dist = 0) {                                             // a warhead: sound arrives at 340 m/s, a low rumble far away
    const v = Math.min(1, 400 / Math.max(400, dist)), d = Math.min(6, dist / 340);
    if (v < 0.02) return;
    this.burst(0.18, { freq: 3000, to: 500, q: 0.7, vol: 0.9 * v * Math.min(1, 800 / Math.max(1, dist)), delay: d });
    this.burst(2.0, { freq: 700, to: 35, type: 'lowpass', vol: 1.4 * v, delay: d + 0.02 });
    this.tone(48, 1.2, { vol: 0.5 * v, to: 25, delay: d });
  }
  flare() { this.burst(0.07, { freq: 1800, to: 600, q: 1, vol: 0.35 }); this.burst(0.5, { freq: 5000, to: 2500, q: 0.8, vol: 0.06, delay: 0.03 }); }
  /** The seeker tone: 0 off, 1 searching (low growl), 2 seeing a target (louder, higher), 3 locked (high steady tone). */
  growl(level) {
    if (!this.ac || !this.on) return;
    const a = this.ac, t = a.currentTime;
    if (!this.seeker) {
      const o = a.createOscillator(), lfo = a.createOscillator(), lg = a.createGain(), g = a.createGain();
      o.type = 'triangle'; lfo.type = 'square'; lfo.frequency.value = 17; lg.gain.value = 0;
      lfo.connect(lg).connect(g.gain); o.connect(g).connect(this.master); g.gain.value = 0;
      o.start(); lfo.start();
      this.seeker = { o, lfo, lg, g, level: -1 };
    }
    const S = this.seeker;
    if (S.level === level) return;
    S.level = level;
    const [f, vol, warble] = [[400, 0, 0], [390, 0.018, 0.012], [720, 0.05, 0.03], [1240, 0.06, 0]][level] || [400, 0, 0];
    S.o.frequency.setTargetAtTime(f, t, 0.03); S.g.gain.setTargetAtTime(vol, t, 0.03); S.lg.gain.setTargetAtTime(warble, t, 0.03);
  }
  mslWarn() { this.tone(1150, 0.09, { type: 'square', vol: 0.07 }); this.tone(1150, 0.09, { type: 'square', vol: 0.07, delay: 0.12 }); }
  click() { this.tone(1200, 0.04, { type: 'square', vol: 0.05 }); }
  aerobatic(fresh) { (fresh ? [523, 784, 1047, 1568] : [660, 990]).forEach((f, i) => this.tone(f, fresh ? 0.35 : 0.2, { type: 'triangle', vol: 0.12, delay: i * 0.09 })); }
}
