/**
 * PlaneController - keyboard, mouse and gamepad -> control surface commands.
 *
 *   W / S  or  ↑ / ↓      pitch (S / ↓ = stick back, nose up; can be inverted)
 *   Shift (hold)          full control deflection (plain keys pull the stick only part way on agile planes)
 *   A / D  or  ← / →      roll (ailerons)
 *   Q / E                 rudder (yaw)
 *   R / F  or  wheel      throttle up / down
 *   V / Shift+V (or X)    flaps down / up one notch
 *   B or Space (hold)     wheel brakes
 *   T / G                 elevator trim nose up / down
 *   C                     camera: chase -> cockpit -> fly-by
 *   M                     mouse-stick mode (the cursor is a virtual joystick)
 *   right mouse drag      look around
 * Gamepad (standard layout): left stick pitch/roll, triggers throttle, bumpers rudder,
 *   A brakes, B camera, X flaps down, Y flaps up.
 *
 * Keyboard axes ramp toward full deflection instead of snapping, so taps give small corrections.
 */
export class PlaneController {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.axes = { pitch: 0, roll: 0, yaw: 0 };
    this.throttle = 0;
    this.flaps = 0;
    this.trim = 0;
    this.brake = 0;
    this.active = false;
    this.mouseStick = false;
    this.feel = null;                           // aircraft feel (pitchKey), set by main.js
    this.mouse = { x: 0, y: 0 };                // -1..1 over the canvas
    this.look = { yaw: 0, pitch: 0, dragging: false };
    this.invert = false;
    try { this.invert = localStorage.getItem('fsInvert') === '1'; this.mouseStick = localStorage.getItem('fsMouse') === '1'; } catch (e) {}
    this.onCamera = null; this.onAction = null;
    this.padPrev = [];

    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (!this.active) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyV') this.setFlaps(this.flaps + (e.shiftKey ? -1 : 1));
      if (e.code === 'KeyX') this.setFlaps(this.flaps - 1);
      if (e.code === 'KeyC') this.onCamera && this.onCamera();
      if (e.code === 'KeyM') { this.mouseStick = !this.mouseStick; try { localStorage.setItem('fsMouse', this.mouseStick ? '1' : '0'); } catch (err) {} this.onAction && this.onAction('mouse', this.mouseStick); }
      if (e.code === 'KeyP') this.onAction && this.onAction(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = Object.create(null); });
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (this.look.dragging) { this.look.yaw -= e.movementX * 0.005; this.look.pitch = Math.max(-1.3, Math.min(1.3, this.look.pitch - e.movementY * 0.005)); }
    });
    canvas.addEventListener('mousedown', e => { if (e.button === 2) this.look.dragging = true; });
    addEventListener('mouseup', e => { if (e.button === 2) this.look.dragging = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('dblclick', () => { this.look.yaw = 0; this.look.pitch = 0; });
    canvas.addEventListener('wheel', e => { if (!this.active) return; this.throttle = Math.max(0, Math.min(1, this.throttle - Math.sign(e.deltaY) * 0.05)); e.preventDefault(); }, { passive: false });
  }

  setFlaps(n) { const v = Math.max(0, Math.min(2, n)); if (v !== this.flaps) { this.flaps = v; this.onAction && this.onAction('flaps', v); } }
  setInvert(v) { this.invert = v; try { localStorage.setItem('fsInvert', v ? '1' : '0'); } catch (e) {} }

  /** Sync with the aircraft after a reset (throttle / flaps it was placed with). */
  sync(ac) { this.throttle = ac.ctl.throttle; this.flaps = ac.ctl.flaps; this.trim = 0; this.axes = { pitch: 0, roll: 0, yaw: 0 }; }

  /** Advance one frame; returns the control command for FlightPhysics. */
  update(dt) {
    const k = this.keys, A = this.axes;
    const ramp = (cur, want, up, back) => want ? Math.max(-1, Math.min(1, cur + Math.sign(want - cur) * Math.min(Math.abs(want - cur), up * dt)))
                                               : cur - Math.sign(cur) * Math.min(Math.abs(cur), back * dt);
    let wp = ((k.KeyS || k.ArrowDown) ? 1 : 0) - ((k.KeyW || k.ArrowUp) ? 1 : 0);
    if (this.invert) wp = -wp;
    const wr = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0);
    const wy = (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0);
    const full = k.ShiftLeft || k.ShiftRight, pk = full ? 1 : (this.feel && this.feel.pitchKey) || 1;
    A.pitch = ramp(A.pitch, wp * pk, 2.2, 4);
    A.roll = ramp(A.roll, wr * (full ? 1 : 0.8), 3, 5);
    A.yaw = ramp(A.yaw, wy, 2.5, 4);
    if (k.KeyR) this.throttle = Math.min(1, this.throttle + dt * 0.5);
    if (k.KeyF) this.throttle = Math.max(0, this.throttle - dt * 0.5);
    if (k.KeyT) this.trim = Math.min(0.5, this.trim + dt * 0.12);
    if (k.KeyG) this.trim = Math.max(-0.5, this.trim - dt * 0.12);
    this.brake = (k.KeyB || k.Space) ? 1 : 0;
    let pitch = A.pitch, roll = A.roll, yaw = A.yaw;

    // mouse as a virtual stick (dead zone in the middle)
    if (this.mouseStick && this.active && !this.look.dragging) {
      const dz = v => Math.abs(v) < 0.06 ? 0 : (v - Math.sign(v) * 0.06) / 0.94;
      if (!wp) pitch = Math.max(-1, Math.min(1, dz(this.mouse.y) * 1.6 * (this.invert ? -1 : 1)));
      if (!wr) roll = Math.max(-1, Math.min(1, dz(this.mouse.x) * 1.6));
    }

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(p => p && p.connected);
    if (gp && this.active) {
      const ax = i => { const v = gp.axes[i] || 0; return Math.abs(v) < 0.08 ? 0 : v; };
      const btn = i => gp.buttons[i] && (gp.buttons[i].value > 0.5 || gp.buttons[i].pressed);
      const pressed = i => btn(i) && !this.padPrev[i];
      if (ax(0) || ax(1)) { roll = ax(0); pitch = ax(1) * (this.invert ? -1 : 1); }
      const lt = gp.buttons[6] ? gp.buttons[6].value : 0, rt = gp.buttons[7] ? gp.buttons[7].value : 0;
      if (rt > 0.05) this.throttle = Math.min(1, this.throttle + rt * dt * 0.7);
      if (lt > 0.05) this.throttle = Math.max(0, this.throttle - lt * dt * 0.7);
      if (btn(4) || btn(5)) yaw = (btn(5) ? 1 : 0) - (btn(4) ? 1 : 0);
      if (btn(0)) this.brake = 1;
      if (pressed(1)) this.onCamera && this.onCamera();
      if (pressed(2)) this.setFlaps(this.flaps + 1);
      if (pressed(3)) this.setFlaps(this.flaps - 1);
      if (pressed(9)) this.onAction && this.onAction('KeyP');
      this.padPrev = gp.buttons.map(b => b && (b.value > 0.5 || b.pressed));
    }
    if (!this.active) { pitch = 0; roll = 0; yaw = 0; }
    return { pitch, roll, yaw, throttle: this.throttle, flaps: this.flaps, brake: this.brake, trim: this.trim };
  }
}
