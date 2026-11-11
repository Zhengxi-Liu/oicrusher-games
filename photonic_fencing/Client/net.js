/** WebSocket link to the authoritative server, with RTT measurement. */
(function () {
  'use strict';

  function defaultUrl() {
    const q = new URLSearchParams(location.search).get('ws');
    if (q) return q;
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game/fencing-ws`;
  }

  class Net {
    constructor(url = defaultUrl()) {
      this.url = url;
      this.ws = null;
      this.handlers = {};
      this.rtt = 0;
      this.pinger = null;
    }
    on(type, fn) { this.handlers[type] = fn; return this; }
    get open() { return !!this.ws && this.ws.readyState === 1; }

    connect() {
      return new Promise((resolve, reject) => {
        let opened = false;
        const ws = new WebSocket(this.url);
        this.ws = ws;
        ws.onopen = () => {
          opened = true;
          const ping = () => this.send({ t: 'ping', c: performance.now() });
          ping(); this.pinger = setInterval(ping, 1000);
          resolve();
        };
        ws.onmessage = e => {
          let m; try { m = JSON.parse(e.data); } catch (err) { return; }
          if (m.t === 'pong') {
            const r = performance.now() - m.c;
            this.rtt = this.rtt ? this.rtt * 0.75 + r * 0.25 : r;
          }
          const h = this.handlers[m.t];
          if (h) h(m);
        };
        ws.onclose = () => {
          clearInterval(this.pinger);
          if (!opened) reject(new Error('Could not reach the game server.'));
          else if (this.handlers.close) this.handlers.close();
        };
        ws.onerror = () => {};
      });
    }

    send(m) { if (this.open) this.ws.send(JSON.stringify(m)); }

    close() {
      clearInterval(this.pinger);
      if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch (e) {} }
      this.ws = null;
    }
  }

  window.FencingNet = { Net };
})();
