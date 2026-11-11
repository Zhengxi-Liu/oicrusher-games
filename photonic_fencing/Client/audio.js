/** Synthesised sound effects (Web Audio, no assets). */
(function () {
  'use strict';
  let ac = null, master = null, on = true;
  try { on = localStorage.getItem('fencingSound') !== 'off'; } catch (e) {}

  function ready() {
    if (!on) return null;
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      master = ac.createGain(); master.gain.value = 0.6; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone(freq, dur, { type = 'sine', vol = 0.2, to = 0, delay = 0 } = {}) {
    const a = ready(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, { vol = 0.25, type = 'bandpass', freq = 2000, to = 0, q = 1 } = {}) {
    const a = ready(); if (!a) return;
    const len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime;
    src.buffer = buf; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.value = vol;
    src.connect(f).connect(g).connect(master); src.start();
  }

  window.FencingAudio = {
    get on() { return on; },
    toggle() { on = !on; try { localStorage.setItem('fencingSound', on ? 'on' : 'off'); } catch (e) {} if (on) ready(); return on; },
    unlock: ready,
    lunge() { noise(0.22, { freq: 600, to: 4000, vol: 0.3 }); },
    dodge() { noise(0.18, { freq: 2500, to: 500, vol: 0.18 }); },
    whiff() { tone(320, 0.12, { type: 'triangle', vol: 0.06, to: 200 }); },
    parry() {
      tone(1760, 0.9, { type: 'triangle', vol: 0.25 });
      tone(2637, 0.7, { type: 'sine', vol: 0.15 });
      tone(110, 0.6, { type: 'sine', vol: 0.4, to: 40 });
      noise(0.3, { freq: 5000, vol: 0.3, q: 4 });
    },
    clash() { noise(0.25, { freq: 3200, vol: 0.35, q: 6 }); tone(1300, 0.3, { type: 'square', vol: 0.06 }); },
    hit() { tone(900, 0.35, { type: 'sawtooth', vol: 0.15, to: 90 }); tone(70, 0.4, { vol: 0.5, to: 35 }); noise(0.2, { freq: 900, vol: 0.3 }); },
    beep() { tone(660, 0.1, { type: 'square', vol: 0.06 }); },
    allez() { tone(880, 0.25, { type: 'square', vol: 0.07 }); tone(1320, 0.35, { type: 'triangle', vol: 0.06, delay: 0.05 }); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.1, delay: i * 0.12 })); },
    lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.08, delay: i * 0.15 })); },
    invite() { tone(988, 0.12, { type: 'square', vol: 0.06 }); tone(1319, 0.2, { type: 'square', vol: 0.06, delay: 0.12 }); },
  };
})();
