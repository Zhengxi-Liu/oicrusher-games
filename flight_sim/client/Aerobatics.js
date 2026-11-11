/**
 * Aerobatics - recognises manoeuvres from the aircraft's motion (free flight).
 *
 * Fed once per 1/60 s frame with the flight state; returns the names of manoeuvres just completed.
 * It looks at body rates (pitch q, roll r, yaw), attitude, speed, alpha and the stall factor:
 *   rolls       a roll "segment" (roll rate above 50 deg/s) of >= 330 deg -> Aileron / Barrel / Point / Snap roll
 *   looping     a pitch segment (body pitch rate) of >= 340 deg -> Loop; half loops + half rolls -> Immelmann,
 *               Split-S, Half Cuban / Cuban Eight
 *   verticals   up-line -> yaw pivot -> down-line = Stall Turn (Hammerhead)
 *   holds       Knife-Edge (wings vertical, level), Hover (nose up, standing still), Torque Roll (rolling
 *               while hovering), Harrier (nose high, slower than the stall speed, level)
 *   Blender     a fast roll on a vertical down-line, then a flat (high alpha) spin
 *
 * Works in Node (scripted test pilots) and the browser (global FSAerobatics).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FSAerobatics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DEG = Math.PI / 180;

  // the checklist (in rough order of difficulty); extras are announced but not listed
  const MANEUVERS = [
    { id: 'loop', name: 'Loop', how: 'Full power, ~120 kt, pull steadily through 360°.' },
    { id: 'aileron', name: 'Aileron Roll', how: 'Nose slightly up, full aileron through 360°.' },
    { id: 'immelmann', name: 'Immelmann Turn', how: 'Half loop up, then half roll to upright at the top.' },
    { id: 'splits', name: 'Split-S', how: 'Half roll to inverted, then pull through a half loop down.' },
    { id: 'hammerhead', name: 'Stall Turn (Hammerhead)', how: 'Pull vertical, as the speed dies kick full rudder, pivot and dive straight down.' },
    { id: 'cuban', name: 'Cuban Eight', how: '5/8 loop, half roll on the 45° down-line - twice.' },
    { id: 'point', name: 'Point Roll', how: 'Roll in steps: stop briefly every 90° (or 180°).' },
    { id: 'knife', name: 'Knife-Edge Flight', how: 'Roll 90°, hold the nose up with top rudder, full power, 3 s.' },
    { id: 'snap', name: 'Snap Roll (Flick Roll)', how: 'At ~80 kt: full back stick + full rudder (same-side aileron).' },
    { id: 'hover', name: 'Hover', how: 'S-1: pull vertical, let it slow, hang on the prop (~80% power), 3 s.' },
    { id: 'torque', name: 'Torque Roll', how: 'S-1: while hovering, let it rotate (add left aileron) a full turn.' },
    { id: 'harrier', name: 'Harrier', how: 'S-1: nose ~45° up below stall speed, hold height with power, 4 s.' },
    { id: 'blender', name: 'Blender', how: 'Roll fast on a vertical down-line, then full back stick + rudder into a flat spin.' },
  ];
  const NAMES = Object.fromEntries(MANEUVERS.map(m => [m.id, m.name]));

  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const reversed = (h0, h1) => Math.abs(wrap(h1 - h0)) > 130 * DEG;

  class Recognizer {
    constructor() { this.reset(); }

    reset() {
      this.t = 0;
      this.cool = {};
      this.rollSeg = null;          // current roll segment
      this.pitchSeg = null;         // current pitch segment
      this.lastPitch = null;        // the last finished pitch segment
      this.vertUp = null;           // up-line seen (hammerhead)
      this.downRoll = null;         // fast roll on a down-line (blender)
      this.halfCuban = null;        // first half of a Cuban Eight
      this.pending = [];            // [{name, at}] announced later unless cancelled
      this.knife = 0; this.knifeDone = false;
      this.hover = 0; this.hoverDone = false; this.hoverRoll = 0; this.torqueDone = 0;
      this.harrier = 0; this.harrierDone = false;
      this.spin = 0; this.spinYaw = 0; this.spinDone = false;
    }

    /**
     * s: { w: body rates [x, y, z] rad/s, pitch, bank, heading (rad), alt, vs, hspeed, ias, alpha, stall (0..1),
     *      agl, onGround, vStall (m/s, clean stall speed) }.  Returns [{id, name}] completed this frame.
     */
    update(s, dt) {
      this.t += dt;
      const out = [];
      if (s.onGround || s.agl < 15) { const t = this.t, cool = this.cool; this.reset(); this.t = t; this.cool = cool; return out; }
      const emit = (id, name = NAMES[id] || id) => {
        if ((this.cool[name] || -1e9) > this.t - 2) return;
        this.cool[name] = this.t;
        out.push({ id, name });
      };
      const q = s.w[0], r = -s.w[2], yaw = -s.w[1];
      const inverted = Math.abs(s.bank) > 135 * DEG, upright = Math.abs(s.bank) < 45 * DEG;
      const level = Math.abs(s.pitch) < 30 * DEG;
      const hovering = s.pitch > 70 * DEG && s.hspeed < 4 && Math.abs(s.vs) < 2.5;

      // ---- hover / torque roll
      if (hovering) {
        this.hover += dt; this.hoverRoll += r * dt;
        if (this.hover > 3 && !this.hoverDone) { this.hoverDone = true; emit('hover'); }
        if (this.hover > 1 && Math.abs(this.hoverRoll) >= 330 * DEG * (this.torqueDone + 1)) { this.torqueDone++; emit('torque'); }
        if (this.rollSeg) this.rollSeg.hover = true;
      } else if (s.pitch < 60 * DEG || s.hspeed > 8 || Math.abs(s.vs) > 5) { this.hover = 0; this.hoverDone = false; this.hoverRoll = 0; this.torqueDone = 0; }

      // ---- knife edge
      const kb = Math.abs(s.bank);
      if (kb > 72 * DEG && kb < 108 * DEG && Math.abs(s.pitch) < 25 * DEG && s.ias > 22 && Math.abs(s.vs) < 4 && Math.abs(q) < 12 * DEG && Math.abs(yaw) < 15 * DEG) {
        this.knife += dt;
        if (this.knife > 3 && !this.knifeDone) { this.knifeDone = true; emit('knife'); }
      } else { this.knife = Math.max(0, this.knife - dt * 3); if (this.knife === 0) this.knifeDone = false; }

      // ---- harrier: nose high, slower than the clean stall speed, holding height, wings roughly level
      if (s.pitch > 20 * DEG && s.pitch < 70 * DEG && s.alpha > 22 * DEG && s.ias > 5 && s.ias < s.vStall * 0.85 &&
          Math.abs(s.vs) < 2.5 && Math.abs(s.bank) < 40 * DEG) {
        this.harrier += dt;
        if (this.harrier > 4 && !this.harrierDone) { this.harrierDone = true; emit('harrier'); }
      } else { this.harrier = Math.max(0, this.harrier - dt * 2); if (this.harrier === 0) this.harrierDone = false; }

      // ---- spins (blender / plain spin): autorotation at high alpha, falling, nose not straight down
      if (Math.abs(yaw) > 100 * DEG && s.alpha > 28 * DEG && s.pitch > -60 * DEG && s.vs < -4) {
        this.spin += dt; this.spinYaw += Math.abs(yaw) * dt;
        if (this.spin > 1 && this.downRoll && this.t - this.downRoll.t < 6 && !this.spinDone) {
          this.spinDone = true; this.downRoll = null;
          this.pending = this.pending.filter(p => p.tag !== 'downroll');
          emit('blender');
        }
        if (this.spinYaw > 540 * DEG && !this.spinDone) { this.spinDone = true; emit('spin', 'Spin'); }
        if (this.rollSeg) this.rollSeg.spin = true;
      } else if (Math.abs(yaw) < 40 * DEG) { this.spin = 0; this.spinYaw = 0; this.spinDone = false; }

      // ---- rolls
      const RS = this.rollSeg;
      if (!RS) {
        if (Math.abs(r) > 50 * DEG) this.rollSeg = { R: 0, dir: Math.sign(r), active: 0, quiet: 0, stops: 0, sinceStop: 0, stallMax: 0, stallT: 0,
                                                     p0: s.pitch, pMin: s.pitch, pMax: s.pitch, Q: 0, t0: this.t, hover: false, spin: false, endBank: s.bank, endPitch: s.pitch,
                                                     // the looping that came just before (or is still going on) - for Immelmann / Cuban Eight
                                                     prev: this.pitchSeg ? { ...this.pitchSeg, t1: this.t } : this.lastPitch };
      } else {
        RS.R += r * dt; RS.Q += q * dt;
        if (Math.abs(r) > 25 * DEG && Math.sign(r) === RS.dir) {
          if (RS.quiet > 0.12 && RS.sinceStop > 45 * DEG) { RS.stops++; RS.sinceStop = 0; }
          RS.quiet = 0; RS.active += dt; RS.sinceStop += Math.abs(r) * dt;
          RS.pMin = Math.min(RS.pMin, s.pitch); RS.pMax = Math.max(RS.pMax, s.pitch); RS.endBank = s.bank; RS.endPitch = s.pitch;
          RS.stallMax = Math.max(RS.stallMax, s.stall); if (s.stall > 0.5) RS.stallT += dt;
        } else RS.quiet += dt;
        // a full roll on a vertical down-line: may turn into a Blender (the spin follows without a pause)
        if (!RS.down && Math.abs(RS.R) >= 330 * DEG && RS.p0 < -55 * DEG && s.pitch < -45 * DEG) { RS.down = true; this.downRoll = { t: this.t }; }
        const reverse = Math.sign(r) === -RS.dir && Math.abs(r) > 50 * DEG;
        if (RS.quiet > 0.8 || reverse) { this.endRoll(RS, s, emit); this.rollSeg = null; }
      }

      // ---- pitch (looping) segments
      const PS = this.pitchSeg;
      if (!PS) {
        if (Math.abs(q) > 12 * DEG) this.pitchSeg = { Q: 0, roll: 0, quiet: 0, t0: this.t, hdg0: s.heading, alt0: s.alt, inv0: inverted, up0: upright, loops: 0, up: false, top: false, down: false };
      } else {
        PS.Q += q * dt; PS.roll += Math.abs(r) * dt;
        if (!PS.inv0 && inverted && PS.Q < 60 * DEG) { PS.inv0 = true; PS.roll = 0; PS.hdg0 = s.heading; }   // the half roll overlapped the pull
        PS.quiet = Math.abs(q) < 10 * DEG ? PS.quiet + dt : 0;
        // a loop goes nose-up, over the top inverted and nose-down (a long steep turn also pitches 360 deg in body axes)
        if (s.pitch > 55 * DEG) PS.up = true;
        if (PS.up && inverted && s.pitch < 45 * DEG) PS.top = true;
        if (PS.top && s.pitch < -45 * DEG) PS.down = true;
        if (PS.Q >= 340 * DEG * (PS.loops + 1) && PS.roll < 120 * DEG && PS.down) { PS.loops++; PS.up = PS.top = PS.down = false; emit('loop'); }
        if (PS.quiet > 0.6) {
          this.lastPitch = { ...PS, t1: this.t, hdg1: s.heading, alt1: s.alt };
          this.endPitch(this.lastPitch, s, upright, level, emit);
          this.pitchSeg = null;
        }
      }

      // ---- hammerhead: up-line, yaw pivot over the top, down-line
      if (s.pitch > 72 * DEG && !this.vertUp) this.vertUp = { t: this.t, Y: 0, Q: 0 };
      if (this.vertUp) {
        const V = this.vertUp;
        V.Y += yaw * dt; V.Q += q * dt;
        if (s.pitch < -58 * DEG) {
          if (Math.abs(V.Y) > 120 * DEG && Math.abs(V.Q) < 110 * DEG) emit('hammerhead');
          this.vertUp = null;
        } else if (this.t - V.t > 25 || (s.pitch < 30 * DEG && Math.abs(V.Y) < 60 * DEG && Math.abs(V.Q) > 60 * DEG)) this.vertUp = null;
      }

      // ---- delayed announcements
      for (const p of this.pending.slice()) if (this.t >= p.at) { this.pending.splice(this.pending.indexOf(p), 1); emit(p.id, p.name); }
      return out;
    }

    endRoll(RS, s, emit) {
      const deg = Math.abs(RS.R) / DEG;
      if (RS.hover) return;                                          // counted as a torque roll
      // a half roll: feeds the Immelmann and the Cuban Eight
      if (deg > 140 && deg < 260 && Math.abs(RS.endBank) < 50 * DEG) {
        const LP = RS.prev;
        if (LP && RS.t0 - LP.t1 < 4) {
          const Qd = LP.Q / DEG;
          // Immelmann: half loop up (inverted at the top), half roll upright, heading reversed, higher
          if (Qd > 145 && Qd < 230 && Math.abs(RS.endPitch) < 30 * DEG && s.alt > LP.alt0 + 40 && reversed(LP.hdg0, s.heading)) {
            emit('immelmann'); this.lastPitch = null; return;
          }
          // half Cuban: 5/8 loop then the half roll on the 45 deg down-line
          if (Qd > 190 && Qd < 300 && RS.pMax < -15 * DEG && RS.pMin > -75 * DEG) {
            if (this.halfCuban && this.t - this.halfCuban.t < 30 && reversed(this.halfCuban.hdg, s.heading)) {
              emit('cuban'); this.halfCuban = null;
            } else { emit('halfcuban', 'Half Cuban Eight'); this.halfCuban = { t: this.t, hdg: s.heading }; }
            this.lastPitch = null; return;
          }
        }
        return;
      }
      if (deg < 330) return;
      const n = Math.floor((deg + 30) / 360), times = n >= 3 ? 'Triple ' : n === 2 ? 'Double ' : '';
      // spinning (autorotation for seconds) is not a roll
      if (RS.spin && (RS.active > 2.5 || RS.down)) return;
      if (RS.stallMax > 0.45 && RS.stallT > 0.25 && RS.active < 2.6 && RS.p0 > -50 * DEG) return emit('snap', times + NAMES.snap);
      if (RS.down) {
        // a roll on the down-line: wait and see whether it turns into a Blender
        if (this.spinDone) return;
        this.downRoll = { t: this.t };
        this.pending.push({ id: 'aileron', name: 'Vertical ' + times + 'Roll', at: this.t + 3, tag: 'downroll' });
        return;
      }
      if (RS.stops >= 1) return emit('point', `${RS.stops + 1 >= 8 ? 8 : RS.stops + 1 >= 4 ? 4 : 2}-${NAMES.point}`);
      if (Math.abs(RS.Q) > 100 * DEG) return emit('barrel', times + 'Barrel Roll');
      emit('aileron', times + NAMES.aileron);
    }

    endPitch(LP, s, upright, level, emit) {
      const Qd = LP.Q / DEG;
      // Split-S: from inverted, a half loop down to upright, heading reversed, lower
      if (LP.inv0 && Qd > 145 && Qd < 230 && upright && level && s.alt < LP.alt0 - 40 && reversed(LP.hdg0, s.heading) && LP.roll < 120 * DEG) {
        emit('splits'); this.lastPitch = null;
      }
    }
  }

  return { Recognizer, MANEUVERS, NAMES };
});
