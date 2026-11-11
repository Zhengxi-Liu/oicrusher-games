/*
 * Esc: a physics lab worksheet (a still picture of a PDF viewer) covers the whole window at once.
 * ` (backquote, the key under Esc) takes it away and you fly on.
 *
 * A classic script loaded before main.js so its capture listener on window runs before every
 * other key handler (bombsight, chat, pause); while the sheet is up it swallows all keys.
 * main.js plugs in onShow / onHide (pause the flight, mute the sound) and calls noteFullBtn()
 * before its own full-screen toggle - in full screen the browser eats Esc and only leaves full screen.
 */
(function () {
  const CSS = `
#labSheet{display:none;position:fixed;inset:0;z-index:2147483000;background:#525659;font-family:Arial,Helvetica,sans-serif;cursor:default;flex-direction:column}
#labSheet.on{display:flex}
#labSheet .lsBar{flex:none;height:56px;background:#323639;color:#f1f1f1;display:flex;align-items:center;padding:0 16px;gap:18px;font-size:14px;box-shadow:0 1px 4px rgba(0,0,0,.5)}
#labSheet .lsBar .ham{font-size:20px;opacity:.9}
#labSheet .lsBar .nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#labSheet .lsBar .mid{display:flex;align-items:center;gap:14px}
#labSheet .lsBar .pg{background:#191b1c;padding:3px 8px;border-radius:2px}
#labSheet .lsBar .sep{width:1px;height:20px;background:#5f6368}
#labSheet .lsBar .ico{font-size:18px;opacity:.9;width:22px;text-align:center}
#labSheet .lsBar .rt{flex:1;display:flex;justify-content:flex-end;gap:20px}
#labSheet .lsDoc{flex:1;overflow:auto;padding:22px 0 40px}
#labSheet .lsPage{width:816px;max-width:calc(100vw - 40px);margin:0 auto 14px;background:#fff;color:#111;box-shadow:0 2px 6px rgba(0,0,0,.45);padding:60px 72px 70px;font-family:'Times New Roman',Times,serif;font-size:15px;line-height:1.38;user-select:none}
#labSheet h1,#labSheet h2{letter-spacing:normal;text-shadow:none;color:#111;text-transform:none;font-family:inherit}
#labSheet h1{font-size:19px;text-align:center;margin:0 0 2px;font-weight:bold}
#labSheet h2{font-size:15px;margin:16px 0 4px;font-weight:bold}
#labSheet .sub{text-align:center;font-size:13.5px;margin-bottom:14px}
#labSheet .info{display:flex;gap:18px;margin:6px 0 10px;font-size:14.5px}
#labSheet .info span{flex:1;white-space:nowrap}
#labSheet .ln{display:inline-block;border-bottom:1px solid #111;min-width:60px;position:relative;top:-2px}
#labSheet .hw{font-family:'Bradley Hand','Segoe Print','Ink Free','Comic Sans MS',cursive;color:#1b3fa0;font-size:15px}
#labSheet ol,#labSheet ul{margin:2px 0 2px 26px;padding:0}
#labSheet li{margin:2px 0}
#labSheet p{margin:4px 0}
#labSheet table{border-collapse:collapse;margin:6px 0 4px;width:100%;font-size:14px}
#labSheet th,#labSheet td{border:1px solid #111;padding:3px 6px;text-align:center;height:25px}
#labSheet th{background:#ececec;font-weight:bold}
#labSheet .cap{font-size:13px;font-style:italic;margin-top:2px}
#labSheet .eq{text-align:center;margin:6px 0;font-style:italic}
#labSheet .rule{border-bottom:1px solid #999;height:26px}
#labSheet .foot{font-size:11.5px;color:#444;display:flex;justify-content:space-between;margin-top:26px;border-top:1px solid #bbb;padding-top:4px}
`;
  const TRIALS = [  // launch angle, trials (m) - v0 = 3.10 m/s: R = v0^2 sin 2θ / g, with real scatter
    [15, '0.482', '0.497', '0.476', '0.485'], [30, '0.851', '0.836', '0.842', '0.843'], [45, '0.962', '0.978', '0.971', '0.970'],
    [60, '0.829', '0.846', '', ''], [75, '', '', '', '']];
  const rows = TRIALS.map(r => `<tr><td>${r[0]}°</td>${r.slice(1).map(v => `<td class="hw">${v}</td>`).join('')}<td></td><td></td></tr>`).join('');
  const lines = n => Array.from({ length: n }, () => '<div class="rule"></div>').join('');
  // graph paper with the three points measured so far
  let grid = '';
  for (let i = 0; i <= 18; i++) grid += `<line x1="${50 + i * 30}" y1="10" x2="${50 + i * 30}" y2="250" stroke="${i % 3 ? '#cfe0cf' : '#9fbf9f'}" stroke-width="${i % 3 ? .6 : 1}"/>`;
  for (let j = 0; j <= 8; j++) grid += `<line x1="50" y1="${10 + j * 30}" x2="590" y2="${10 + j * 30}" stroke="${j % 2 ? '#cfe0cf' : '#9fbf9f'}" stroke-width="${j % 2 ? .6 : 1}"/>`;
  const px = a => 50 + a / 90 * 540, py = r => 250 - r / 1.2 * 240;
  const pts = [[15, .485], [30, .843], [45, .970]].map(([a, r]) => `<circle cx="${px(a)}" cy="${py(r)}" r="3.4" fill="#1b3fa0"/>`).join('');
  const graph = `<svg viewBox="0 0 600 290" width="100%" style="display:block;margin:4px 0">${grid}
    <line x1="50" y1="250" x2="590" y2="250" stroke="#111" stroke-width="1.4"/><line x1="50" y1="10" x2="50" y2="250" stroke="#111" stroke-width="1.4"/>
    ${[0, 15, 30, 45, 60, 75, 90].map(a => `<text x="${px(a)}" y="266" font-size="11" text-anchor="middle" font-family="Times New Roman">${a}</text>`).join('')}
    ${[0, .3, .6, .9, 1.2].map(r => `<text x="44" y="${py(r) + 4}" font-size="11" text-anchor="end" font-family="Times New Roman">${r.toFixed(1)}</text>`).join('')}
    <text x="320" y="285" font-size="12" text-anchor="middle" font-family="Times New Roman">Launch angle θ (degrees)</text>
    <text x="14" y="130" font-size="12" text-anchor="middle" font-family="Times New Roman" transform="rotate(-90 14 130)">Range R (m)</text>${pts}</svg>`;

  const HTML = `
<div class="lsBar"><span class="ham">☰</span><span class="nm">PHYS1_Lab06_Projectile_Motion.pdf</span>
  <span class="mid"><span><span class="pg">1</span>&nbsp; / &nbsp;3</span><span class="sep"></span><span class="ico">−</span><span class="pg">100%</span><span class="ico">+</span><span class="sep"></span><span class="ico">⤢</span><span class="ico">↻</span></span>
  <span class="rt"><span class="ico">⤓</span><span class="ico">⎙</span><span class="ico">⋮</span></span></div>
<div class="lsDoc">
 <div class="lsPage">
  <h1>Lab 6: Projectile Motion — Range vs. Launch Angle</h1>
  <div class="sub">Physics 1 · Mechanics Laboratory · Fall 2026</div>
  <div class="info"><span>Name: <span class="ln" style="min-width:190px"></span></span><span>Lab partner(s): <span class="ln" style="min-width:170px"></span></span></div>
  <div class="info"><span>Section: <span class="ln" style="min-width:70px"></span></span><span>Date: <span class="ln hw" style="min-width:110px">11/4</span></span><span>Bench #: <span class="ln hw" style="min-width:50px">&nbsp;7</span></span></div>

  <h2>Objective</h2>
  <p>To verify that a projectile launched from and landing at the same height travels a horizontal range
  <i>R</i> = <i>v</i><sub>0</sub><sup>2</sup> sin 2θ / <i>g</i>, to find the launch angle that gives the maximum range, and to measure
  the launch speed <i>v</i><sub>0</sub> of the spring launcher using two independent methods.</p>

  <h2>Materials</h2>
  <ul><li>Mini projectile launcher with protractor and plumb bob; 25 mm steel ball</li>
  <li>Photogate pair with timer (spacing 10.0 cm); carbon paper and white paper; masking tape</li>
  <li>2 m tape measure; meter stick; C-clamp; safety goggles</li></ul>

  <h2>Procedure — Part A: Launch speed</h2>
  <ol><li>Clamp the launcher to the end of the bench, level (θ = 0°). Mount the photogates on the barrel. <b>Wear goggles.</b></li>
  <li>Load the ball to the <u>short-range</u> setting and fire. Record the gate time Δ<i>t</i>; repeat for 5 trials.</li>
  <li>Compute <i>v</i><sub>0</sub> = <i>d</i> / Δ<i>t</i> and its mean. Keep the same spring setting for the rest of the lab.</li></ol>

  <h2>Procedure — Part B: Range vs. angle</h2>
  <ol start="4"><li>Move the launcher to the floor so the ball lands at the launch height. Tape paper and carbon paper where the ball lands.</li>
  <li>For each angle in Table 1, fire three trials. Measure <i>R</i> from the plumb-bob mark to the center of each dot.</li>
  <li>Compute the theoretical range from your mean <i>v</i><sub>0</sub> and the percent difference.</li></ol>

  <h2>Data</h2>
  <p>Mean launch speed (Part A): &nbsp;<i>v</i><sub>0</sub> = <span class="ln hw" style="min-width:90px">&nbsp;3.10</span> m/s &nbsp;&nbsp; ± <span class="ln hw" style="min-width:60px">&nbsp;0.04</span> m/s</p>
  <table><tr><th>θ</th><th>R<sub>1</sub> (m)</th><th>R<sub>2</sub> (m)</th><th>R<sub>3</sub> (m)</th><th>R<sub>avg</sub> (m)</th><th>R<sub>theory</sub> (m)</th><th>% diff</th></tr>${rows}</table>
  <div class="cap">Table 1. Horizontal range for each launch angle (same launch and landing height, g = 9.81 m/s²).</div>
  <div class="foot"><span>PHYS 1 Lab Manual</span><span>Page 1 of 3</span></div>
 </div>

 <div class="lsPage">
  <h2>Graph</h2>
  <p>Plot <i>R</i><sub>avg</sub> versus θ. Sketch the theoretical curve on the same axes and label both.</p>
  ${graph}
  <div class="cap">Figure 1. Range versus launch angle.</div>

  <h2>Analysis</h2>
  <ol><li>At what angle is the measured range a maximum? Use the trig identity sin 2θ to explain why.</li>${lines(2)}
  <li>Show that complementary angles (e.g. 30° and 60°) give the same range in the absence of air resistance. Do your data agree? Quantify.</li>${lines(3)}
  <li>Use <i>R</i><sub>avg</sub> at 45° to solve for <i>v</i><sub>0</sub>. Compare it with the photogate value from Part A (percent difference).</li>${lines(3)}
  <li>Identify two sources of systematic error. For each, state whether it makes <i>R</i> larger or smaller than predicted.</li>${lines(3)}</ol>
  <div class="foot"><span>PHYS 1 Lab Manual</span><span>Page 2 of 3</span></div>
 </div>

 <div class="lsPage">
  <h2>Part C: Horizontal launch from the bench</h2>
  <p>Fire the ball horizontally from the bench top, height <i>h</i> = <span class="ln hw" style="min-width:70px">&nbsp;0.915</span> m above the floor.</p>
  <div class="eq">t = √(2h / g) &nbsp;&nbsp;&nbsp;&nbsp; x = v<sub>0</sub> t</div>
  <table><tr><th>Quantity</th><th>Predicted</th><th>Measured</th><th>% diff</th></tr>
  <tr><td>Time of flight t (s)</td><td></td><td>—</td><td>—</td></tr><tr><td>Landing distance x (m)</td><td></td><td></td><td></td></tr>
  <tr><td>Impact speed |v| (m/s)</td><td></td><td>—</td><td>—</td></tr><tr><td>Impact angle below horizontal</td><td></td><td>—</td><td>—</td></tr></table>
  <ol start="5"><li>Before firing, mark your predicted landing point on the floor. How far from the mark did the ball land?</li>${lines(2)}
  <li>If the bench were twice as high, by what factor would the landing distance change? Explain.</li>${lines(3)}</ol>
  <h2>Conclusion</h2>
  <p>In 4–6 sentences, state whether your results support the range equation, citing numbers from Tables 1 and 2.</p>${lines(5)}
  <div class="foot"><span>PHYS 1 Lab Manual</span><span>Page 3 of 3</span></div>
 </div>
</div>`;

  let el = null, on = false, fullBtnAt = 0;
  function build() {
    if (el) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    el = document.createElement('div'); el.id = 'labSheet'; el.innerHTML = HTML;
    for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'touchstart'])
      el.addEventListener(t, e => { e.stopPropagation(); if (t === 'contextmenu') e.preventDefault(); });
    document.body.appendChild(el);
  }
  const api = window.LabSheet = {
    onShow: null, onHide: null,
    get open() { return on; },
    show() {
      if (on) return; build(); on = true;
      el.classList.add('on'); el.querySelector('.lsDoc').scrollTop = 0;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      try { api.onShow && api.onShow(); } catch (e) { console.error(e); }
    },
    hide() {
      if (!on) return; on = false; el.classList.remove('on');
      try { api.onHide && api.onHide(); } catch (e) { console.error(e); }
    },
    noteFullBtn() { fullBtnAt = performance.now(); }
  };
  addEventListener('keydown', e => {
    if (e.code === 'Escape' && !on) { e.preventDefault(); e.stopImmediatePropagation(); return api.show(); }
    if (!on) return;
    e.stopImmediatePropagation();                                  // nothing reaches the game while the sheet is up
    if (e.code === 'Backquote' && !e.repeat) { e.preventDefault(); return api.hide(); }
    if (!e.metaKey && !e.ctrlKey && !e.altKey) e.preventDefault(); // browser shortcuts still work
  }, true);
  // in browser full screen Esc never reaches the page: it only leaves full screen
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && performance.now() - fullBtnAt > 1500) api.show(); });
  if (document.body) build(); else addEventListener('DOMContentLoaded', build);
})();
