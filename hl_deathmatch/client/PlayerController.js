/**
 * PlayerController: Pointer Lock mouse look, WASD / jump, Ctrl or C crouch, fire / alt-fire, reload,
 * Counter-Strike style slots (1 primary · 2 pistol · 3 crowbar · 4 grenade), G drops the gun in hand.
 * sample() is called once per 60 Hz tick and returns one input packet for prediction + the server.
 */
const { MOVE, BTN, WEAPONS, SLOT, NUM_WEAPONS } = window.HLConst;
const ORDER = [SLOT.PRIMARY, SLOT.PISTOL, SLOT.MELEE, SLOT.GRENADE];

export class PlayerController {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.yaw = 0;
    this.pitch = 0;
    this.buttons = 0;
    this.tapped = 0;             // fire/alt pressed since the last tick (a click shorter than a frame still fires)
    this.wantSlot = 0;
    this.dropTap = false;
    this.lastWeapon = 0;
    this.zoom = 0;               // 0 = none; crossbow 1; AWP 1 or 2
    this.rezoomAt = 0;            // AWP: scope back in after the bolt is cycled
    this.active = false;         // in-game and not in a menu
    this.locked = false;
    this.sens = 0.0022;
    try { const s = Number(localStorage.getItem('hldmSens')); if (s > 0) this.sens = s; } catch (e) {}
    this.onEscape = null;
    this.onScoreboard = null;

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked && this.active && this.onEscape) this.onEscape();   // Esc released a real lock
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      const k = this.zoom === 2 ? 0.15 : this.zoom ? 0.35 : 1;
      this.yaw -= e.movementX * this.sens * k;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * this.sens * k));
    });
    canvas.addEventListener('mousedown', e => {
      if (!this.active) return;
      if (!this.locked) this.lock();
      const bit = e.button === 0 ? BTN.FIRE : e.button === 2 ? BTN.ALT : 0;
      this.buttons |= bit; this.tapped |= bit;
      e.preventDefault();
    });
    addEventListener('mouseup', e => { this.buttons &= ~(e.button === 0 ? BTN.FIRE : e.button === 2 ? BTN.ALT : 0); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { if (this.active) { this.cycle = e.deltaY > 0 ? 1 : -1; e.preventDefault(); } }, { passive: false });
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (!this.active) return;
      this.keys[e.code] = true;
      if (/^Digit[1-4]$/.test(e.code)) this.wantSlot = +e.code.slice(5);
      if (e.code === 'KeyQ') this.wantSlot = -1;            // last weapon
      if (e.code === 'KeyG') this.dropTap = true;
      if (e.code === 'Tab') { e.preventDefault(); if (this.onScoreboard) this.onScoreboard(true); }
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ControlLeft', 'ControlRight', 'KeyC'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.code === 'Tab' && this.onScoreboard) this.onScoreboard(false);
    });
    addEventListener('blur', () => { this.keys = Object.create(null); this.buttons = 0; });
  }

  lock() {
    try {
      const r = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* browsers without pointer lock still get keyboard + click */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  setLook(yaw, pitch) { this.yaw = yaw; this.pitch = pitch; }

  /** One input packet. `p` is the predicted local player (owned weapons, current weapon). */
  sample(p) {
    const k = this.keys;
    let m = 0;
    if (k.KeyW || k.ArrowUp) m |= MOVE.FWD;
    if (k.KeyS || k.ArrowDown) m |= MOVE.BACK;
    if (k.KeyA || k.ArrowLeft) m |= MOVE.LEFT;
    if (k.KeyD || k.ArrowRight) m |= MOVE.RIGHT;
    if (k.Space) m |= MOVE.JUMP;
    if (k.ControlLeft || k.ControlRight || k.KeyC) m |= MOVE.CROUCH;
    let b = (this.buttons | this.tapped) & (BTN.FIRE | BTN.ALT);
    this.tapped = 0;
    if (k.KeyR) b |= BTN.RELOAD;

    if (this.dropTap) { b |= BTN.DROP; this.dropTap = false; }

    // weapon selection: slot keys 1-4, Q (last weapon), mouse wheel through what we carry
    let w = 0;
    const owns = x => p && (p.owned & (1 << x));
    const inSlot = sl => { for (let x = 1; x <= NUM_WEAPONS; x++) if (owns(x) && WEAPONS[x].slot === sl) return x; return 0; };
    if (this.cycle && p) {
      const carried = ORDER.map(inSlot).filter(Boolean), i = carried.indexOf(p.cur);
      if (carried.length) w = carried[((i < 0 ? 0 : i) + this.cycle + carried.length) % carried.length];
      this.cycle = 0;
    }
    if (this.wantSlot === -1) w = this.lastWeapon;
    else if (this.wantSlot) w = inSlot(this.wantSlot);
    this.wantSlot = 0;
    if (w && (!owns(w) || w === p.cur)) w = 0;
    if (w) { this.lastWeapon = p.cur; this.zoom = 0; this.rezoomAt = 0; }

    // scopes: right click toggles the crossbow zoom and cycles the AWP through 2 zoom levels
    const altPress = (b & BTN.ALT) && !this.altHeld;
    this.altHeld = !!(b & BTN.ALT);
    if (p && altPress && p.cur === 6) this.zoom = this.zoom ? 0 : 1;
    if (p && altPress && p.cur === 8) { this.zoom = (this.zoom + 1) % 3; this.rezoomAt = 0; }
    if (p && p.cur !== 6 && p.cur !== 8) this.zoom = 0;
    if (this.rezoomAt && performance.now() >= this.rezoomAt && p && p.cur === 8 && p.cool <= 0) { this.zoom = this.rezoomZoom; this.rezoomAt = 0; }
    if (p && p.cur === 8 && this.zoom) b |= BTN.SCOPE;
    if (!this.active) { m = 0; b = 0; w = 0; }
    return { m, yaw: this.yaw, pitch: this.pitch, b, w };
  }

  /** AWP: the scope drops while the bolt is cycled, then comes back at the same zoom. */
  afterShot(w) {
    if (w !== 8 || !this.zoom) return;
    this.rezoomZoom = this.zoom;
    this.zoom = 0;
    this.rezoomAt = performance.now() + 900;
  }

  setSensitivity(v) { this.sens = v; try { localStorage.setItem('hldmSens', String(v)); } catch (e) {} }
}

export { WEAPONS };
