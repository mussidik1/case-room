/* Case Room — live patient monitor (sweeping ECG / pleth / capnography + numerics) */
(function (root) {
  'use strict';
  const { SignalGen, clamp } = root.CRWave;
  const FS = 500;          // samples per second
  const WINDOW = 6;        // seconds across the screen
  const KEYS = ['hr', 'ar', 'spo2', 'rr', 'etco2', 'st', 'sbp', 'dbp'];
  const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

  function rhythmName(v) {
    if (v.label) return v.label;
    const st = (v.st || 0) > 0.1 ? ' · ST elevation' : '';
    switch (v.rhythm) {
      case 'sinus': return (v.hr < 60 ? 'Sinus bradycardia' : v.hr > 100 ? 'Sinus tachycardia' : 'Sinus rhythm') + st;
      case 'avb3': return 'Complete heart block' + st;
      case 'paced': return 'Paced rhythm';
      case 'afib': return 'Atrial fibrillation';
      case 'vtach': return 'Ventricular tachycardia';
      case 'vfib': return 'Ventricular fibrillation';
      case 'asystole': return 'Asystole';
      case 'junctional': return 'Junctional rhythm';
      default: return '';
    }
  }

  class Monitor {
    constructor(el, opts) {
      opts = opts || {};
      this.el = el;
      el.classList.add('mon');
      el.innerHTML = `
        <div class="mon-wave">
          <canvas></canvas>
          <span class="mon-lbl ecg" style="top:3%">II</span>
          <span class="mon-lbl spo2" style="top:36%">Pleth</span>
          <span class="mon-lbl co2" style="top:69.5%">CO₂</span>
          <div class="mon-off"><span>Monitor not attached</span></div>
        </div>
        <div class="mon-nums">
          <div class="mn hr"><b>HR</b><span class="v">--</span><i>bpm</i></div>
          <div class="mn spo2"><b>SpO₂</b><span class="v">--</span><i>%</i></div>
          <div class="mn co2"><b>EtCO₂</b><span class="v">--</span><i>mmHg</i></div>
        </div>
        <div class="mon-foot">
          <div class="mn nibp"><b>NIBP</b><span class="v">--/--</span><i class="map"></i></div>
          <div class="mn rr"><b>RR</b><span class="v">--</span></div>
          <div class="mon-rhythm"></div>
        </div>`;
      this.canvas = el.querySelector('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.wave = el.querySelector('.mon-wave');
      this.q = (s) => el.querySelector(s);
      this.cur = { rhythm: 'none', hr: 0, ar: 80, spo2: 0, rr: 0, etco2: 0, st: 0, sbp: 0, dbp: 0 };
      this.nibp = null;
      this.cycling = false;
      this.anim = null;
      this.showRhythm = !!opts.showRhythm;
      this.sound = false;
      this.audio = null;
      this.gen = new SignalGen({ rhythm: 'none' });
      this.gen.onBeat = () => this.beep();
      this.x = 0;
      this.last = {};
      this.lastNum = 0;
      this.w = 0; this.h = 0;
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.wave);
      this.loop = this.loop.bind(this);
      this.raf = requestAnimationFrame(this.loop);
      this.render(true);
    }

    resize() {
      const r = this.wave.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.max(0, Math.floor(r.width));
      this.h = Math.max(0, Math.floor(r.height));
      this.canvas.width = Math.floor(this.w * dpr);
      this.canvas.height = Math.floor(this.h * dpr);
      this.canvas.style.width = this.w + 'px';
      this.canvas.style.height = this.h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.clearRect(0, 0, this.w, this.h);
      this.x = 0;
      this.last = {};
    }

    /* ---- public API ---- */

    // Set vitals instantly (no animation). Pass rhythm:'none' to detach.
    set(v) {
      this.anim = null;
      clearTimeout(this.nibpTimer);
      this.cycling = false;
      Object.assign(this.cur, v);
      if (v.sbp != null) this.nibp = { s: v.sbp, d: v.dbp };
      this.gen.set(this.genParams());
      this.render(true);
    }

    // Animate toward new vitals over ms. Rhythm changes happen at once.
    transition(target, ms) {
      ms = ms || 6000;
      const t = Object.assign({}, target);
      if (t.rhythm && t.rhythm !== this.cur.rhythm) {
        this.cur.rhythm = t.rhythm;
        if (t.hr != null) this.cur.hr = t.hr;
        if (t.ar != null) this.cur.ar = t.ar;
        if (t.label !== undefined) this.cur.label = t.label;
        this.gen.set(this.genParams());
      } else if (t.label !== undefined) {
        this.cur.label = t.label;
      }
      if (t.cap !== undefined) { this.cur.cap = t.cap; this.gen.set({ cap: t.cap }); }
      const to = {};
      for (const k of KEYS) to[k] = t[k] != null ? t[k] : this.cur[k];
      const from = {};
      for (const k of KEYS) from[k] = this.cur[k];
      this.anim = { from, to, t0: performance.now(), ms };
      if (t.pause) this.gen.pause(t.pause);
      if (t.sbp != null || t.dbp != null) this.cycleNibp(to.sbp, to.dbp, Math.min(ms * 0.55, 3800));
    }

    cycleNibp(s, d, delay) {
      clearTimeout(this.nibpTimer);
      this.nibpTimer = setTimeout(() => {
        this.cycling = true;
        this.render(true);
        this.nibpTimer = setTimeout(() => { this.cycling = false; this.nibp = { s: Math.round(s), d: Math.round(d) }; this.render(true); }, 2200);
      }, delay);
    }

    setShowRhythm(on) { this.showRhythm = !!on; this.render(true); }

    enableSound(on) {
      this.sound = !!on;
      if (on && !this.audio) {
        try { this.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.audio = null; }
      }
      if (this.audio && this.audio.state === 'suspended') this.audio.resume();
    }

    snapshot() { return Object.assign({}, this.cur, { nibpS: this.nibp && this.nibp.s, nibpD: this.nibp && this.nibp.d }); }

    /* ---- internals ---- */

    genParams() {
      const c = this.cur;
      return { rhythm: c.rhythm, hr: c.hr, ar: c.ar, st: c.st, sbp: c.sbp, rr: c.rr, etco2: c.etco2, cap: c.cap || 'normal', pulseless: c.rhythm === 'vfib' || c.rhythm === 'asystole' };
    }

    beep() {
      if (!this.sound || !this.audio || this.cur.rhythm === 'none') return;
      const a = this.audio;
      const t = a.currentTime;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'sine';
      o.frequency.value = 380 + clamp(this.cur.spo2 - 70, 0, 30) * 15; // pitch falls with the sat
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 0.1);
    }

    loop() {
      this.raf = requestAnimationFrame(this.loop);
      const nowMs = performance.now();
      if (this.anim) {
        const p = clamp((nowMs - this.anim.t0) / this.anim.ms, 0, 1);
        const e = ease(p);
        for (const k of KEYS) this.cur[k] = this.anim.from[k] + (this.anim.to[k] - this.anim.from[k]) * e;
        this.gen.set(this.genParams());
        if (p >= 1) this.anim = null;
      }
      const out = this.gen.generate(nowMs / 1000, FS);
      if (out && this.w > 0 && this.h > 0) this.draw(out);
      if (nowMs - this.lastNum > 300) { this.lastNum = nowMs; this.render(false); }
    }

    draw(o) {
      const ctx = this.ctx, W = this.w, H = this.h, sh = H / 3;
      const pps = W / (WINDOW * FS);
      const a = this.x, b = this.x + o.n * pps;
      const gap = Math.max(10, W * 0.025);
      // erase just ahead of the sweep
      if (b + gap <= W) ctx.clearRect(a + 1, 0, b + gap - a, H);
      else { ctx.clearRect(a + 1, 0, W - a, H); ctx.clearRect(0, 0, b + gap - W, H); }
      const lw = Math.max(1.6, Math.min(3, W / 420));
      this.strip(o.ecg, 0, sh, (v) => sh * 0.6 - v * sh * 0.3, getVar(this.el, '--ecg', '#4dff88'), 'e', pps, lw);
      this.strip(o.pleth, sh, sh, (v) => sh * 0.86 - v * sh * 0.62, getVar(this.el, '--spo2', '#4fd8ff'), 'p', pps, lw);
      this.strip(o.co2, sh * 2, sh, (v) => sh * 0.9 - (v / 50) * sh * 0.75, getVar(this.el, '--co2', '#ffd84d'), 'c', pps, lw);
      this.x = b % W;
    }

    strip(arr, top, h, map, color, key, pps, lw) {
      const ctx = this.ctx, W = this.w;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let x = this.x;
      let last = this.last[key];
      if (last) ctx.moveTo(last.x, last.y);
      for (let i = 0; i < arr.length; i++) {
        x += pps;
        if (x >= W) { x -= W; ctx.stroke(); ctx.beginPath(); last = null; }
        const y = top + clamp(map(arr[i]), 3, h - 3);
        if (!last) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        last = { x, y };
      }
      ctx.stroke();
      this.last[key] = last;
    }

    render(force) {
      const c = this.cur;
      const off = c.rhythm === 'none';
      this.el.classList.toggle('off', off);
      const set = (sel, txt, alarm) => {
        const n = this.q(sel);
        const v = n.querySelector('.v');
        if (v.textContent !== txt) v.textContent = txt;
        n.classList.toggle('alarm', !!alarm && !off);
      };
      const perfusing = !(c.rhythm === 'vfib' || c.rhythm === 'asystole') && c.sbp >= 45;
      let hr = '--';
      if (!off) hr = c.rhythm === 'vfib' ? '---' : c.rhythm === 'asystole' ? '0' : String(Math.round(c.hr));
      set('.mn.hr', hr, !off && (c.hr < 50 || c.hr > 130 || c.rhythm === 'vfib' || c.rhythm === 'asystole'));
      set('.mn.spo2', off || !perfusing ? '--' : String(Math.round(c.spo2)), perfusing && c.spo2 < 90);
      set('.mn.co2', off ? '--' : String(Math.round(c.etco2)), c.etco2 < 25 || c.etco2 > 50);
      set('.mn.rr', off ? '--' : String(Math.round(c.rr)), c.rr < 8 || c.rr > 30);
      const nb = this.q('.mn.nibp');
      let ntxt = '--/--', map = '';
      if (!off && this.cycling) { ntxt = 'cycling'; }
      else if (!off && this.nibp) { ntxt = `${this.nibp.s}/${this.nibp.d}`; map = `(${Math.round((this.nibp.s + 2 * this.nibp.d) / 3)})`; }
      nb.querySelector('.v').textContent = ntxt;
      nb.querySelector('.map').textContent = map;
      nb.classList.toggle('alarm', !off && !this.cycling && !!this.nibp && this.nibp.s < 90);
      nb.classList.toggle('cycling', this.cycling);
      const rl = this.q('.mon-rhythm');
      const name = !off && this.showRhythm ? rhythmName(c) : '';
      if (rl.textContent !== name) rl.textContent = name;
    }
  }

  const varCache = new WeakMap();
  function getVar(el, name, fallback) {
    let m = varCache.get(el);
    if (!m) { m = {}; varCache.set(el, m); }
    if (!m[name]) m[name] = (getComputedStyle(el).getPropertyValue(name) || '').trim() || fallback;
    return m[name];
  }

  root.CRMonitor = { Monitor, rhythmName };
})(window);
