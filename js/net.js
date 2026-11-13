/* Case Room — room connection
   The host screen is the source of truth. It publishes the game state to several free public
   MQTT relays at once (plus a same-browser channel), and listens for players on all of them.
   Phones connect to every relay they can reach, so one blocked or slow relay doesn't matter. */
(function (root) {
  'use strict';

  const DEFAULT_RELAYS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://mqtt.eclipseprojects.io:443/mqtt',
  ];
  const PREFIX = 'caseroom-v1';
  // Anything on a public relay can come from anyone, so oversized messages are dropped before parsing.
  const MAX_STATE_BYTES = 256 * 1024;
  const MAX_UP_BYTES = 4 * 1024;

  // ?relay= is for local testing only (e.g. ?relay=ws://localhost:8883, or ?relay=none).
  // A link or QR code must not be able to send students or the DM to somebody else's relay.
  function isLocalRelay(url) {
    try {
      const u = new URL(url);
      return (u.protocol === 'ws:' || u.protocol === 'wss:') && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    } catch (e) { return false; }
  }
  function customRelays() {
    const p = new URLSearchParams(location.search).get('relay');
    if (p === 'none') return [];
    if (!p) return null;
    const ok = p.split(',').map((s) => s.trim()).filter(isLocalRelay);
    return ok.length ? ok : null;
  }
  function relayList() {
    const c = customRelays();
    return c || DEFAULT_RELAYS;
  }

  function rid(n) {
    const a = 'abcdefghijkmnpqrstuvwxyz23456789';
    const r = new Uint8Array(n || 8);
    crypto.getRandomValues(r);
    let s = '';
    for (const x of r) s += a[x % a.length];
    return s;
  }

  function warnDrop(e) { try { console.warn('Case Room: dropped a malformed message', e && e.message); } catch (err) { /* ignore */ } }

  function shortName(url) {
    try { return new URL(url).hostname.split('.').slice(-2, -1)[0] || url; } catch (e) { return url; }
  }

  class Relay {
    constructor(o) {
      this.room = o.room;
      this.role = o.role; // 'host' | 'player'
      this.onState = o.onState || (() => {});
      this.onUp = o.onUp || (() => {});
      this.onPeer = o.onPeer || (() => {}); // host: state published by another DM screen on this code
      this.onStatus = o.onStatus || (() => {});
      this.onConnect = o.onConnect || (() => {});
      this.topicS = `${PREFIX}/${this.room}/s`;
      this.topicU = `${PREFIX}/${this.room}/u`;
      this.clients = [];
      this.seen = new Map();
      this.lastJson = null;
      this.lastState = null;
      this.bc = null;
    }

    start() {
      try {
        this.bc = new BroadcastChannel(`${PREFIX}-${this.room}`);
        this.bc.onmessage = (ev) => {
          try {
            const d = ev.data || {};
            if (d.ch === 'hello') { if (this.role === 'host' && this.lastState) this.bc.postMessage({ ch: 's', m: this.lastState }); return; }
            this.inbound(d.ch, d.m, 'local', false);
          } catch (e) { warnDrop(e); }
        };
        if (this.role === 'player') this.bc.postMessage({ ch: 'hello' });
      } catch (e) { this.bc = null; }

      if (!root.mqtt) { this.status(); return this; }
      for (const url of relayList()) {
        const entry = { url, name: shortName(url), ok: false, client: null };
        this.clients.push(entry);
        let c;
        try {
          c = root.mqtt.connect(url, {
            protocolVersion: 4, clean: true, keepalive: 30, connectTimeout: 12000,
            reconnectPeriod: 4000, clientId: 'cr_' + rid(12),
          });
        } catch (e) { continue; }
        entry.client = c;
        c.on('connect', () => {
          entry.ok = true;
          // the host also listens on the state topic, so it can tell when another DM screen is live on the same code
          c.subscribe(this.role === 'host' ? [this.topicU, this.topicS] : this.topicS, { qos: 1 });
          if (this.role === 'host' && this.lastJson) c.publish(this.topicS, this.lastJson, { qos: 1, retain: true });
          this.status();
          this.onConnect(entry);
        });
        const down = () => { if (entry.ok) { entry.ok = false; this.status(); } };
        c.on('close', down);
        c.on('offline', down);
        c.on('error', () => {});
        // Never let one bad message throw inside the MQTT client: it would stop reading until it reconnects.
        c.on('message', (topic, payload, packet) => {
          try {
            if (!payload || !payload.length) return;
            const isState = topic === this.topicS;
            if (payload.length > (isState ? MAX_STATE_BYTES : MAX_UP_BYTES)) return;
            let m;
            try { m = JSON.parse(typeof payload === 'string' ? payload : new TextDecoder().decode(payload)); } catch (e) { return; }
            this.inbound(isState ? 's' : 'u', m, entry.name, !!(packet && packet.retain));
          } catch (e) { warnDrop(e); }
        });
      }
      this.status();
      return this;
    }

    inbound(ch, m, via, retained) {
      if (!m || typeof m !== 'object') return;
      if (ch === 's') {
        if (this.role === 'player') this.onState(m, via);
        else this.onPeer(m, via, !!retained);
      } else if (ch === 'u' && this.role === 'host') {
        // the same message arrives once per relay: keep the first copy (bounded, oldest ids dropped first)
        if (typeof m.mid !== 'string' || m.mid.length > 40 || this.seen.has(m.mid)) return;
        this.seen.set(m.mid, 1);
        if (this.seen.size > 4000) {
          const it = this.seen.keys();
          for (let i = 0; i < 1000; i++) this.seen.delete(it.next().value);
        }
        this.onUp(m, via);
      }
    }

    // host → everyone (retained, so late joiners get the current screen)
    publishState(state) {
      this.lastState = state;
      this.lastJson = JSON.stringify(state);
      for (const e of this.clients) if (e.ok) e.client.publish(this.topicS, this.lastJson, { qos: 1, retain: true });
      if (this.bc) this.bc.postMessage({ ch: 's', m: state });
    }

    // player → host
    send(msg) {
      msg.mid = msg.mid || rid(12);
      const json = JSON.stringify(msg);
      for (const e of this.clients) if (e.ok) e.client.publish(this.topicU, json, { qos: 1 });
      if (this.bc) this.bc.postMessage({ ch: 'u', m: msg });
    }

    connected() { return this.clients.filter((e) => e.ok).length; }

    status() {
      this.onStatus({ ok: this.connected(), total: this.clients.length, list: this.clients.map((e) => ({ name: e.name, ok: e.ok })), local: !!this.bc });
    }

    stop() {
      for (const e of this.clients) { try { e.client.end(true); } catch (err) { /* ignore */ } }
      if (this.bc) this.bc.close();
    }
  }

  root.CRNet = { Relay, rid, DEFAULT_RELAYS, customRelays };
})(window);
