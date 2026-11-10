// Thin WebSocket wrapper with message-type events.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      const ws = (this.ws = new WebSocket(url));
      let opened = false;
      ws.onopen = () => { opened = true; resolve(); };
      ws.onerror = () => { if (!opened) reject(new Error('Could not reach the game server.')); };
      ws.onclose = () => { if (opened) this.emit('close', {}); };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m && m.t) this.emit(m.t, m);
      };
    });
  }

  get open() { return !!this.ws && this.ws.readyState === 1; }

  send(m) { if (this.open) this.ws.send(JSON.stringify(m)); }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, m) {
    for (const fn of this.handlers.get(type) || []) {
      try { fn(m); } catch (err) { console.error(`handler for "${type}" failed`, err); }
    }
  }
}
