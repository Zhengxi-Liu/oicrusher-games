/**
 * Practice opponent. It sees the duel through a reaction delay (it reads an old state for the
 * opponent, its own state live) and plays footsie: keep distance, read lunges, punish whiffs.
 */
(function () {
  'use strict';
  const S = window.FencingSim, { C, IN } = S;

  // attack: ticks between committed attacks [min, max]; poke: chance per tick to lunge when already in range
  const LEVELS = {
    easy:   { react: 20, parry: 0.12, dodge: 0.25, punish: 0.45, poke: 0.012, jitter: 4, attack: [150, 260] },
    normal: { react: 13, parry: 0.28, dodge: 0.28, punish: 0.80, poke: 0.025, jitter: 3, attack: [80, 160] },
    hard:   { react: 8,  parry: 0.50, dodge: 0.25, punish: 1.00, poke: 0.040, jitter: 2, attack: [45, 110] },
  };
  const LUNGE_RANGE = C.REACH + C.LUNGE_EXT + C.LUNGE_SPEED * C.LUNGE_ACTIVE - 6 + C.BODY_HALF;

  class Bot {
    constructor(side, level) {
      this.side = side;
      this.cfg = LEVELS[level] || LEVELS.normal;
      this.plan = null;            // { at: tick, bit }
      this.read = -1;              // start tick of the last enemy lunge we already decided about
      this.want = 160 + Math.random() * 25;
      this.nextAttack = 0;         // tick of the next committed attack (close in, then lunge)
      this.attacking = false;
    }

    decide(past, now) {
      if (now.phase !== 'fight') { this.plan = null; return 0; }
      const cfg = this.cfg;
      const view = past[Math.max(0, past.length - 1 - cfg.react)] || now;
      const me = now.f[this.side], op = view.f[1 - this.side];
      const gap = Math.abs(op.x - me.x);
      const toward = this.side === 0 ? IN.RIGHT : IN.LEFT, away = this.side === 0 ? IN.LEFT : IN.RIGHT;
      const R = Math.random;

      if (this.plan) {
        if (now.tick >= this.plan.at + 2) this.plan = null;
        else if (now.tick >= this.plan.at) return this.plan.bit;
        else return 0;
      }
      if (!this.nextAttack) this.nextAttack = now.tick + cfg.attack[0] + R() * (cfg.attack[1] - cfg.attack[0]);
      if (me.st !== 'idle' && me.st !== 'walk') return 0;

      // An incoming lunge we have not reacted to yet.
      if (op.st === 'lunge' && op.t < C.LUNGE_STARTUP && gap < LUNGE_RANGE + 40) {
        const start = view.tick - op.t;
        if (this.read !== start) {
          this.read = start;
          const r = R();
          const contact = start + C.LUNGE_STARTUP + 3;
          if (r < cfg.parry) {
            this.plan = { at: Math.max(now.tick, contact - 3 + Math.round((R() - 0.5) * 2 * cfg.jitter)), bit: IN.PARRY };
          } else if (r < cfg.parry + cfg.dodge) {
            this.plan = { at: now.tick, bit: IN.DODGE };
          }
          if (this.plan) return 0;
        }
      }

      // Punish anything left hanging.
      const open = op.st === 'stagger'
        || (op.st === 'lunge' && op.t >= C.LUNGE_STARTUP + C.LUNGE_ACTIVE)
        || (op.st === 'parry' && op.t >= C.PARRY_WINDOW)
        || (op.st === 'recoil');
      if (open && gap <= LUNGE_RANGE && R() < cfg.punish * 0.25) return IN.LUNGE;
      if (open && op.st === 'stagger' && gap > LUNGE_RANGE) return toward;

      // Committed attack: walk into range, then lunge from a random depth.
      if (!this.attacking && now.tick >= this.nextAttack && gap < LUNGE_RANGE + 90) { this.attacking = true; this.depth = LUNGE_RANGE - 4 - R() * 40; }
      if (this.attacking) {
        if (gap > this.depth) return toward;
        this.attacking = false;
        this.nextAttack = now.tick + cfg.attack[0] + R() * (cfg.attack[1] - cfg.attack[0]);
        return IN.LUNGE;
      }

      // Footsies around the edge of lunge range.
      if (gap <= LUNGE_RANGE && R() < cfg.poke) return IN.LUNGE;
      if (R() < 0.01) this.want = 150 + R() * 40;
      if (gap > this.want + 12) return toward;
      if (gap < this.want - 25) return away;
      return 0;
    }
  }

  window.FencingBot = { Bot, LEVELS };
})();
