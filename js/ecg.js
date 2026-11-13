/* Case Room — waveform engine
   Live monitor signals (ECG lead II, pleth, capnography) and static 12-lead rendering.
   Everything is synthetic and built from simple shapes, so it is fully parameterized. */
(function (root) {
  'use strict';

  const gauss = (x, mu, s) => { const z = (x - mu) / s; return Math.exp(-0.5 * z * z); };
  const sig = (x) => 1 / (1 + Math.exp(-x));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- beat templates (tau = seconds from the R peak) ---------- */

  // Narrow complex (sinus, junctional, AV-nodal escape). m = {q, r, s, st, t}
  function narrowQRST(tau, m, rr) {
    if (tau < -0.09 || tau > 0.8) return 0;
    const tPk = 0.08 + 0.2 * Math.sqrt(clamp(rr, 0.3, 2.2)); // QT shortens with rate
    let v = 0;
    v += (m.q || 0) * gauss(tau, -0.024, 0.008);
    v += (m.r || 0) * gauss(tau, 0, 0.0105);
    v += (m.s || 0) * gauss(tau, 0.026, 0.0095);
    if (m.st) v += m.st * sig((tau - 0.04) / 0.006) * (1 - sig((tau - (tPk + 0.07)) / 0.025));
    const t = m.t || 0;
    v += t * (tau < tPk ? gauss(tau, tPk, 0.058) : gauss(tau, tPk, 0.042));
    return v;
  }

  // Wide complex (paced, ventricular). m = {r1, r, s, t}
  function wideQRST(tau, m, rr) {
    if (tau < -0.1 || tau > 0.85) return 0;
    const tPk = 0.17 + 0.2 * Math.sqrt(clamp(rr, 0.3, 2.2));
    let v = 0;
    v += (m.r1 || 0) * gauss(tau, -0.012, 0.016);
    v += (m.r || 0) * gauss(tau, 0.045, 0.034);
    v += (m.s || 0) * gauss(tau, 0.11, 0.03);
    const t = m.t || 0;
    v += t * (tau < tPk ? gauss(tau, tPk, 0.075) : gauss(tau, tPk, 0.055));
    return v;
  }

  const MORPH = {
    II: { q: -0.06, r: 1.05, s: -0.22, t: 0.3 },
    PACED: { r1: 0.2, r: -1.1, s: -0.15, t: 0.42 },
    VT: { r1: 0, r: 1.35, s: -0.7, t: -0.45 },
  };

  function vfibWave(t) {
    const a = 0.32 + 0.22 * Math.sin(2 * Math.PI * 0.31 * t);
    return a * (Math.sin(2 * Math.PI * 4.8 * t + 2 * Math.sin(2 * Math.PI * 0.9 * t)) +
      0.5 * Math.sin(2 * Math.PI * 7.1 * t + 1.3) + 0.3 * Math.sin(2 * Math.PI * 2.9 * t));
  }
  function afibBaseline(t) {
    return 0.045 * Math.sin(2 * Math.PI * 5.3 * t + 1.7 * Math.sin(2 * Math.PI * 0.7 * t)) +
      0.025 * Math.sin(2 * Math.PI * 7.9 * t);
  }

  // Perfusion (pleth amplitude 0..1) from systolic pressure
  function perfFrom(v) {
    if (v.pulseless) return 0;
    return clamp(((v.sbp || 100) - 35) / 85, 0.08, 1);
  }

  /* ---------- live signal generator ---------- */

  const DEFAULT_VITALS = {
    rhythm: 'sinus', hr: 80, ar: 80, st: 0, sbp: 120, dbp: 78, spo2: 98, rr: 14, etco2: 38,
  };

  class SignalGen {
    constructor(v) {
      this.v = Object.assign({}, DEFAULT_VITALS, v || {});
      this.t = 0;
      this.events = [];
      this.nextBeat = 0.4;
      this.nextP = 0.25;
      this.breathPhase = 0.3;
      this.pauseUntil = -1;
      this.onBeat = null;
    }

    set(patch) {
      const prev = this.v.rhythm;
      Object.assign(this.v, patch);
      if (patch.rhythm && patch.rhythm !== prev) {
        // drop not-yet-drawn beats from the old rhythm and restart the schedule
        this.events = this.events.filter((e) => e.t < this.t + 0.02);
        this.nextBeat = this.t + 0.35;
        this.nextP = this.t + 0.12;
      }
    }

    pause(sec) { this.pauseUntil = this.t + sec; this.events = this.events.filter((e) => !(e.kind === 'V' && e.t > this.t)); this.nextBeat = Math.max(this.nextBeat, this.pauseUntil); }

    schedule(tUntil) {
      const v = this.v;
      const r = v.rhythm;
      const perf = perfFrom(v);
      while (this.nextBeat < tUntil) {
        const tb = this.nextBeat;
        let rr = 0.5;
        if (tb < this.pauseUntil) { this.nextBeat = this.pauseUntil; continue; }
        if (r === 'sinus') {
          rr = (60 / clamp(v.hr, 20, 250)) * (1 + (Math.random() - 0.5) * 0.04);
          this.events.push({ t: tb - 0.16, kind: 'P', amp: v.pAmp == null ? 0.15 : v.pAmp });
          this.events.push({ t: tb, kind: 'V', rr, perf });
        } else if (r === 'afib') {
          rr = (60 / clamp(v.hr, 20, 250)) * (0.62 + Math.random() * 0.76);
          this.events.push({ t: tb, kind: 'V', rr, perf: perf * (0.65 + 0.35 * Math.random()) });
        } else if (r === 'avb3' || r === 'junctional') {
          rr = 60 / clamp(v.hr, 10, 250);
          this.events.push({ t: tb, kind: 'V', rr, perf });
        } else if (r === 'paced') {
          rr = 60 / clamp(v.hr, 30, 180);
          this.events.push({ t: tb - 0.035, kind: 'S' });
          if (v.capture !== false) this.events.push({ t: tb, kind: 'W', rr, perf, m: MORPH.PACED });
        } else if (r === 'vtach') {
          rr = 60 / clamp(v.hr, 100, 260);
          this.events.push({ t: tb, kind: 'W', rr, perf: perf * 0.45, m: MORPH.VT });
        }
        this.nextBeat = tb + rr;
      }
      const independentP = r === 'avb3' || r === 'paced' || (r === 'asystole' && v.pWaves);
      if (independentP) {
        while (this.nextP < tUntil) {
          this.events.push({ t: this.nextP, kind: 'P', amp: v.pAmp == null ? 0.15 : v.pAmp });
          this.nextP += (60 / clamp(v.ar || 80, 30, 220)) * (1 + (Math.random() - 0.5) * 0.03);
        }
      } else {
        this.nextP = Math.max(this.nextP, tUntil);
      }
    }

    ecgAt(t) {
      const v = this.v;
      if (v.rhythm === 'none') return 0;
      const m = { q: MORPH.II.q, r: MORPH.II.r, s: MORPH.II.s, st: v.st || 0, t: MORPH.II.t + Math.max(0, v.st || 0) * 0.7 };
      let y = 0;
      for (const e of this.events) {
        const tau = t - e.t;
        if (tau < -0.12 || tau > 0.9) continue;
        if (e.kind === 'P') y += e.amp * gauss(tau, 0, 0.022);
        else if (e.kind === 'V') y += narrowQRST(tau, m, e.rr);
        else if (e.kind === 'W') y += wideQRST(tau, e.m, e.rr);
        else if (e.kind === 'S') y += 1.7 * gauss(tau, 0, 0.0032);
      }
      if (v.rhythm === 'vfib') y += vfibWave(t);
      if (v.rhythm === 'afib') y += afibBaseline(t);
      y += 0.014 * Math.sin(2 * Math.PI * 0.23 * t);
      y += (Math.random() - 0.5) * 0.012;
      return y;
    }

    plethAt(t) {
      if (this.v.rhythm === 'none') return 0;
      let y = 0;
      for (const e of this.events) {
        if (e.kind !== 'V' && e.kind !== 'W') continue;
        const tau = t - e.t - 0.2;
        if (tau < -0.1 || tau > 0.95) continue;
        y += e.perf * (gauss(tau, 0.11, 0.045) + 0.42 * gauss(tau, 0.3, 0.075));
      }
      return y;
    }

    co2Step(dt) {
      const v = this.v;
      if (v.rhythm === 'none') return 0;
      const rr = clamp(v.rr || 0, 0, 60);
      if (rr <= 0) return 0;
      this.breathPhase = (this.breathPhase + (dt * rr) / 60) % 1;
      const p = this.breathPhase;
      const shark = v.cap === 'shark'; // bronchospasm: slow, sloped upstroke
      const rise = sig((p - 0.1) / (shark ? 0.05 : 0.012));
      const fall = sig((p - 0.58) / 0.01);
      const plateau = shark ? 0.42 + 0.58 * clamp((p - 0.06) / 0.52, 0, 1) : 0.88 + 0.12 * clamp((p - 0.12) / 0.46, 0, 1);
      return (v.etco2 || 0) * rise * (1 - fall) * plateau;
    }

    generate(tNow, fs) {
      const dt = 1 / fs;
      if (tNow - this.t > 1.5) { // tab was hidden: jump ahead cleanly
        this.t = tNow - 0.02;
        this.events = [];
        this.nextBeat = this.t + 0.25;
        this.nextP = this.t + 0.1;
      }
      const n = Math.floor((tNow - this.t) / dt);
      if (n <= 0) return null;
      this.schedule(this.t + n * dt + 1.0);
      const ecg = new Float32Array(n), pleth = new Float32Array(n), co2 = new Float32Array(n);
      const t0 = this.t;
      for (let i = 0; i < n; i++) {
        this.t += dt;
        ecg[i] = this.ecgAt(this.t);
        pleth[i] = this.plethAt(this.t);
        co2[i] = this.co2Step(dt);
      }
      if (this.onBeat) {
        for (const e of this.events) {
          if ((e.kind === 'V' || e.kind === 'W') && !e.fired && e.t > t0 && e.t <= this.t) { e.fired = true; this.onBeat(e); }
        }
      }
      const keep = this.t - 1.2;
      if (this.events.length > 40 || (this.events[0] && this.events[0].t < keep)) this.events = this.events.filter((e) => e.t > keep);
      return { n, ecg, pleth, co2 };
    }
  }

  /* ---------- static 12-lead ---------- */

  const NORMAL_12 = {
    I: { p: 0.1, q: -0.04, r: 0.7, s: -0.1, st: 0, t: 0.22 },
    II: { p: 0.15, q: -0.05, r: 1.0, s: -0.18, st: 0, t: 0.3 },
    III: { p: 0.06, q: -0.06, r: 0.45, s: -0.2, st: 0, t: 0.1 },
    aVR: { p: -0.12, q: 0, r: -0.85, s: 0.12, st: 0, t: -0.25 },
    aVL: { p: 0.03, q: -0.03, r: 0.35, s: -0.25, st: 0, t: 0.08 },
    aVF: { p: 0.11, q: -0.05, r: 0.72, s: -0.18, st: 0, t: 0.2 },
    V1: { p: 0.06, q: 0, r: 0.2, s: -1.0, st: 0, t: -0.05 },
    V2: { p: 0.07, q: 0, r: 0.4, s: -1.3, st: 0.05, t: 0.45 },
    V3: { p: 0.07, q: 0, r: 0.85, s: -0.85, st: 0.04, t: 0.5 },
    V4: { p: 0.08, q: -0.03, r: 1.3, s: -0.5, st: 0.02, t: 0.48 },
    V5: { p: 0.09, q: -0.05, r: 1.35, s: -0.25, st: 0, t: 0.38 },
    V6: { p: 0.09, q: -0.05, r: 1.1, s: -0.12, st: 0, t: 0.3 },
    V4R: { p: 0.05, q: 0, r: 0.25, s: -0.6, st: 0, t: 0.12 },
  };

  function withOverrides(base, ov) {
    const out = {};
    for (const k of Object.keys(base)) out[k] = Object.assign({}, base[k], (ov && ov[k]) || {});
    return out;
  }

  const PRESETS = {
    normal: { hr: 76, leads: NORMAL_12 },
    // Inferior STEMI, RCA pattern: ST up III > II, aVF; reciprocal ST down I, aVL; V1 up (RV)
    inferiorRV: {
      hr: 56,
      leads: withOverrides(NORMAL_12, {
        II: { st: 0.2, t: 0.5 },
        III: { st: 0.32, t: 0.55, q: -0.12 },
        aVF: { st: 0.26, t: 0.5, q: -0.09 },
        I: { st: -0.08, t: 0.04 },
        aVL: { st: -0.2, t: -0.12 },
        aVR: { st: -0.04 },
        V1: { st: 0.1, t: 0.08 },
        V2: { st: 0.0, t: 0.35 },
        V3: { st: 0.0 },
        V4: { st: -0.02 },
        V5: { st: -0.04, t: 0.3 },
        V6: { st: -0.05, t: 0.22 },
        V4R: { st: 0.15, t: 0.3 },
      }),
    },
  };

  // Build a 10 s beat schedule. Seeded so the same ECG renders the same way every time.
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function buildSchedule(hr, rhythm, ar) {
    const rand = rng(1234 + Math.round(hr));
    const ev = [];
    const rr = 60 / hr;
    if (rhythm === 'avb3') {
      for (let t = 0.12; t < 10.4; t += 60 / (ar || 80)) ev.push({ t, kind: 'P' });
      for (let t = 0.55; t < 10.6; t += rr) ev.push({ t, kind: 'V', rr });
    } else {
      for (let t = 0.42; t < 10.6; t += rr * (1 + (rand() - 0.5) * 0.04)) {
        ev.push({ t: t - 0.16, kind: 'P' });
        ev.push({ t, kind: 'V', rr });
      }
    }
    return ev;
  }

  function leadValue(t, events, m) {
    let y = 0;
    for (const e of events) {
      const tau = t - e.t;
      if (tau < -0.12 || tau > 0.9) continue;
      if (e.kind === 'P') y += (m.p || 0) * gauss(tau, 0, 0.022);
      else y += narrowQRST(tau, m, e.rr);
    }
    return y;
  }

  function drawPaper(ctx, x, y, w, h, mm) {
    ctx.fillStyle = '#fff6f4';
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = Math.max(0.5, mm * 0.07);
    ctx.strokeStyle = '#f7d3cf';
    ctx.beginPath();
    for (let gx = x; gx <= x + w + 0.1; gx += mm) { ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
    for (let gy = y; gy <= y + h + 0.1; gy += mm) { ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
    ctx.stroke();
    ctx.lineWidth = Math.max(0.8, mm * 0.16);
    ctx.strokeStyle = '#eba59f';
    ctx.beginPath();
    for (let gx = x; gx <= x + w + 0.1; gx += mm * 5) { ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
    for (let gy = y; gy <= y + h + 0.1; gy += mm * 5) { ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
    ctx.stroke();
  }

  // Draw one lead segment: time window [t0, t1] placed at (x, yBase). 25 mm/s, 10 mm/mV.
  function traceLead(ctx, events, m, t0, t1, x, yBase, mm) {
    const pxPerSec = 25 * mm, pxPerMv = 10 * mm;
    ctx.beginPath();
    const step = 0.002;
    for (let t = t0; t <= t1 + 1e-9; t += step) {
      const px = x + (t - t0) * pxPerSec;
      const py = yBase - leadValue(t, events, m) * pxPerMv;
      if (t === t0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function calPulse(ctx, x, yBase, mm) {
    ctx.beginPath();
    ctx.moveTo(x, yBase);
    ctx.lineTo(x + mm, yBase);
    ctx.lineTo(x + mm, yBase - 10 * mm);
    ctx.lineTo(x + 6 * mm, yBase - 10 * mm);
    ctx.lineTo(x + 6 * mm, yBase);
    ctx.lineTo(x + 7 * mm, yBase);
    ctx.stroke();
  }

  /* Render a 12-lead (layout '12') or selected leads as long strips (layout 'strips').
     spec: {preset, leads: ['V4R'], hr, rhythm, ar, title} */
  function render12(canvas, spec) {
    const preset = PRESETS[spec.preset || 'normal'] || PRESETS.normal;
    const hr = spec.hr || preset.hr;
    const leads = preset.leads;
    const events = buildSchedule(hr, spec.rhythm || 'sinus', spec.ar);
    const strips = spec.layout === 'strips';
    const stripLeads = spec.leads || ['II'];

    // geometry in mm
    const marginL = 8, marginT = 4, rowH = strips ? 34 : 30;
    const nRows = strips ? stripLeads.length : 4;
    const widthMm = marginL + (strips ? 150 : 250) + 3;
    const heightMm = marginT + rowH * nRows + 3;

    const cssW = canvas.clientWidth || 1000;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const mm = cssW / widthMm;
    const cssH = heightMm * mm;
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPaper(ctx, 0, 0, cssW, cssH, mm);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const label = (txt, x, y) => {
      ctx.fillStyle = '#1b1b1b';
      ctx.font = `700 ${Math.max(10, 3.4 * mm)}px Cardo, Georgia, serif`;
      ctx.fillText(txt, x, y);
    };
    const trace = () => { ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.1, 0.32 * mm); };

    if (strips) {
      stripLeads.forEach((name, i) => {
        const yBase = (marginT + rowH * i + rowH * 0.62) * mm;
        trace();
        calPulse(ctx, 1 * mm, yBase, mm);
        traceLead(ctx, events, leads[name] || leads.II, 0.3, 6.3, marginL * mm, yBase, mm);
        label(name, marginL * mm + 1.5 * mm, (marginT + rowH * i + 5) * mm);
      });
      return;
    }

    const grid = [['I', 'aVR', 'V1', 'V4'], ['II', 'aVL', 'V2', 'V5'], ['III', 'aVF', 'V3', 'V6']];
    for (let r = 0; r < 3; r++) {
      const yBase = (marginT + rowH * r + rowH * 0.6) * mm;
      trace();
      calPulse(ctx, 0.5 * mm, yBase, mm);
      for (let c = 0; c < 4; c++) {
        const name = grid[r][c];
        const x = (marginL + 62.5 * c) * mm;
        trace();
        traceLead(ctx, events, leads[name], 2.5 * c, 2.5 * (c + 1), x, yBase, mm);
        if (c > 0) { ctx.beginPath(); ctx.moveTo(x, yBase - 4 * mm); ctx.lineTo(x, yBase + 4 * mm); ctx.stroke(); }
        label(name, x + 1.5 * mm, (marginT + rowH * r + 5) * mm);
      }
    }
    // rhythm strip, lead II, 10 s
    const yb = (marginT + rowH * 3 + rowH * 0.6) * mm;
    trace();
    calPulse(ctx, 0.5 * mm, yb, mm);
    traceLead(ctx, events, leads.II, 0, 10, marginL * mm, yb, mm);
    label('II', marginL * mm + 1.5 * mm, (marginT + rowH * 3 + 5) * mm);
  }

  root.CRWave = { SignalGen, render12, PRESETS, perfFrom, clamp };
})(window);
