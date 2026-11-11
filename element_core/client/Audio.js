/** Synthesised sound effects (Web Audio, no asset files). */
(function () {
  'use strict';
  let ac = null, master = null, on = true;
  try { on = localStorage.getItem('elementSound') !== 'off'; } catch (e) {}

  function ready() {
    if (!on) return null;
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(freq, dur, { type = 'sine', vol = 0.15, to = 0, delay = 0 } = {}) {
    const a = ready(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, { vol = 0.2, freq = 1500, to = 0, q = 1, type = 'bandpass' } = {}) {
    const a = ready(); if (!a) return;
    const len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime;
    src.buffer = buf; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.value = vol; src.connect(f).connect(g).connect(master); src.start();
  }
  let lastShot = 0;
  window.ElementAudio = {
    get on() { return on; },
    toggle() { on = !on; try { localStorage.setItem('elementSound', on ? 'on' : 'off'); } catch (e) {} if (on) ready(); return on; },
    unlock: ready,
    shoot() { const n = performance.now(); if (n - lastShot < 60) return; lastShot = n; tone(880, 0.08, { type: 'triangle', vol: 0.05, to: 1500 }); },
    dash() { noise(0.2, { freq: 600, to: 3000, vol: 0.18 }); },
    hurt() { tone(160, 0.2, { type: 'sawtooth', vol: 0.12, to: 70 }); noise(0.12, { freq: 500, vol: 0.2 }); },
    hit() { tone(1320, 0.07, { type: 'square', vol: 0.04 }); },
    block() { noise(0.05, { freq: 2500, vol: 0.06, q: 3 }); },
    crumble() { noise(0.6, { freq: 300, to: 120, vol: 0.35, type: 'lowpass' }); },
    zap() { noise(0.18, { freq: 4000, vol: 0.18, q: 2 }); tone(1800, 0.12, { type: 'sawtooth', vol: 0.05, to: 600 }); },
    kill() { tone(90, 0.8, { vol: 0.45, to: 35 }); noise(0.6, { freq: 900, to: 200, vol: 0.4 }); tone(1200, 0.5, { type: 'triangle', vol: 0.1, to: 300 }); },
    beep() { tone(660, 0.09, { type: 'square', vol: 0.05 }); },
    fight() { tone(880, 0.25, { type: 'square', vol: 0.06 }); tone(1320, 0.3, { type: 'triangle', vol: 0.05, delay: 0.06 }); },
    draft() { [523, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.07, delay: i * 0.08 })); },
    pick() { tone(1047, 0.12, { type: 'triangle', vol: 0.08 }); },
    invite() { tone(988, 0.12, { type: 'square', vol: 0.06 }); tone(1319, 0.2, { type: 'square', vol: 0.06, delay: 0.12 }); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.09, delay: i * 0.12 })); },
    lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.07, delay: i * 0.15 })); },
  };
})();
