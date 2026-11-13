/* Case Room — host / Dungeon Master screen */
(function () {
  'use strict';
  const R = window.CRRules, N = window.CRNet, W = window.CRWave;
  const CASES = window.CR_CASES || [];
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => (typeof s === 'string' ? s : typeof s === 'number' && Number.isFinite(s) ? String(s) : '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const params = new URLSearchParams(location.search);
  const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const BOT_NAMES = ['Medic 7', 'Engine 351', 'Truck 12', 'Ambo 4', 'Rescue 9', 'Squad 2', 'Medic 35', 'Tower 1', 'Brush 6', 'Boat 3', 'Chief 5', 'Paramedic 16'];
  const GRADE = { best: 'Best call', ok: 'Reasonable', wrong: 'Harmful' };
  const LS_SETTINGS = 'caseroom-settings';
  const LS_SAVE = 'caseroom-host-save';

  const DEFAULT_SETTINGS = { timer: 45, dice: true, follow: 'party', board: 'each', showRhythm: false, sound: false, teams: 0 };

  const G = {
    phase: 'setup',
    hid: N.rid(8),
    gid: N.rid(6), // game id: part of every question id, so answers saved on phones never carry into another game
    seq: 0,
    askN: 0,
    room: null,
    settings: Object.assign({}, DEFAULT_SETTINGS, loadJson(LS_SETTINGS) || {}),
    caseDef: CASES[0] || null, // during play, a per-game copy with the answer order shuffled
    order: null, // step id -> authored option keys, in the order shown this game
    peer: null, // another DM screen seen live on the same room code
    locked: false, // no new players once the DM locks the room
    joinWin: { t0: 0, n: 0 }, // new players per 10 s, so a flood can't fill the room
    closeArm: 0, // first press of "close the vote" while answers are still coming in
    stepIdx: -1,
    hp: 100,
    hpMax: 100,
    players: new Map(),
    kicked: new Set(),
    ask: null,
    res: null,
    adhoc: null,
    pendingNext: null,
    finished: false,
    history: [],
    net: { ok: 0, total: 0, list: [], local: false },
  };

  let relay = null;
  let monitor = null;
  let timerInt = null;
  let pubTimer = null;
  let liveTimer = null;
  let saveTimer = null;
  let lastNextAt = 0;
  let viewKey = '';

  function loadJson(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function saveJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

  /* ---------------- helpers ---------------- */

  function newCode() {
    const r = new Uint8Array(4);
    crypto.getRandomValues(r);
    return Array.from(r, (x) => CODE_ALPHA[x % CODE_ALPHA.length]).join('');
  }
  function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
  function cleanName(s) { return (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18) || 'Adventurer'; }
  function steps() { return G.caseDef ? G.caseDef.steps : []; }
  function step() { return steps()[G.stepIdx] || null; }
  function idxOf(id) { return steps().findIndex((s) => s.id === id); }
  function opt(st, k) { return st && st.options ? st.options.find((o) => o.k === k) : null; }
  function bestKeys(st) { return st.options.filter((o) => o.grade === 'best').map((o) => o.k); }
  function activePlayers() {
    const cut = Date.now() - 45000;
    return [...G.players.values()].filter((p) => !G.kicked.has(p.pid) && (p.bot || p.seen > cut));
  }
  function mainSteps() { return steps().filter((s) => !s.branch); }
  function progress() {
    const ms = mainSteps();
    const st = step();
    if (!st) return { i: 0, n: ms.length };
    let i = ms.indexOf(st);
    if (i < 0) { for (let j = G.stepIdx; j >= 0; j--) { i = ms.indexOf(steps()[j]); if (i >= 0) break; } }
    return { i: i + 1, n: ms.length };
  }
  function joinUrl() {
    const u = new URL('./', location.href);
    u.search = '';
    u.searchParams.set('r', G.room);
    return u.toString(); // never copy a ?relay= override into the join QR
  }
  function joinDisplay() {
    const u = new URL('./', location.href);
    return (u.host + u.pathname).replace(/\/$/, '');
  }
  function ranked() {
    return [...G.players.values()].filter((p) => !G.kicked.has(p.pid)).sort((a, b) => b.xp - a.xp || a.joined - b.joined);
  }

  /* ---- answer order: shuffled once per game, the same on every phone ---- */
  function randInt(n) { const r = new Uint32Array(1); crypto.getRandomValues(r); return r[0] % n; }
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // The best answer's slot is drawn from a shuffled bag of A–D, so it lands evenly across the letters
  // over a case and never in the same slot twice in a row. The other options fill the rest at random.
  function makeOrder(base) {
    const order = {};
    let bag = [], last = -1;
    for (const st of base.steps) {
      if (st.type !== 'choice' || !st.options || !st.options.length) continue;
      const n = st.options.length;
      const best = st.options.find((o) => o.grade === 'best');
      if (!best) { order[st.id] = shuffled(st.options.map((o) => o.k)); continue; }
      let pos = -1;
      for (let tries = 0; tries < 3 && pos < 0; tries++) {
        if (!bag.length) bag = shuffled([0, 1, 2, 3]);
        const i = bag.findIndex((p) => p < n && p !== last);
        if (i >= 0) pos = bag.splice(i, 1)[0]; else bag = [];
      }
      if (pos < 0) pos = randInt(n);
      last = pos;
      const keys = shuffled(st.options.filter((o) => o !== best)).map((o) => o.k);
      keys.splice(pos, 0, best.k);
      order[st.id] = keys;
    }
    return order;
  }
  // A copy of the case with each decision's options in this game's order, relettered A, B, C…
  function applyOrder(base, order) {
    if (!base || !order) return base;
    return Object.assign({}, base, {
      steps: base.steps.map((st) => {
        const ks = order[st.id];
        if (st.type !== 'choice' || !ks || ks.length !== st.options.length) return st;
        const opts = ks.map((k0, i) => Object.assign({}, st.options.find((o) => o.k === k0), { k: 'ABCDEFGH'[i], k0 }));
        if (opts.some((o) => !o.text)) return st; // order from an older version of the case
        return Object.assign({}, st, { options: opts });
      }),
    });
  }
  function baseCase(id) { return CASES.find((c) => c.id === id) || null; }

  function qrSvg(text) {
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount(), m = 4;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR code to join"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
  }

  /* ---------------- networking ---------------- */

  function startRelay() {
    if (relay) relay.stop();
    G.peer = null;
    renderPeer();
    relay = new N.Relay({
      room: G.room, role: 'host',
      onUp: (m) => onUp(m, false), // network messages are never trusted
      onPeer: onPeer,
      onStatus: (s) => { G.net = s; renderBar(); },
    }).start();
    publish();
    clearInterval(G.hb);
    G.hb = setInterval(() => { if (G.phase !== 'setup') publish(); }, 4000);
  }

  function schedulePublish() {
    if (pubTimer) return;
    pubTimer = setTimeout(() => { pubTimer = null; publish(); }, 300);
  }

  function publish() {
    if (!relay) return;
    relay.publishState(buildState());
  }

  // Another DM screen publishing live on this code (a second laptop, an old tab, another instructor).
  // Retained messages are only the last word from an earlier session, so they don't count.
  function onPeer(m, via, retained) {
    if (!m || m.app !== 'caseroom' || m.room !== G.room || m.hid === G.hid) return;
    if (retained || m.phase === 'setup' || Date.now() - (m.ts || 0) > 20000) return;
    const fresh = !peerLive();
    G.peer = { at: Date.now(), hid: m.hid };
    if (fresh) renderPeer();
  }
  function peerLive() { return !!(G.peer && Date.now() - G.peer.at < 15000); }
  function renderPeer() {
    let el = $('#peerWarn');
    if (!el) {
      el = document.createElement('div');
      el.id = 'peerWarn';
      el.className = 'peer-warn';
      el.setAttribute('role', 'alert');
      el.hidden = true;
      document.body.appendChild(el);
    }
    const on = peerLive() && G.phase !== 'setup';
    if (on) el.innerHTML = `<b>Another DM screen is live in room ${esc(G.room)}.</b> Phones will jump between the two. Close the other screen, or go back and open a different room code.`;
    el.hidden = !on;
  }

  function buildState() {
    const st = step();
    const pr = progress();
    const rk = ranked();
    const xp = {};
    rk.forEach((p, i) => { xp[p.pid] = [p.xp, i + 1, R.levelFor(p.xp).level, p.lastXp || 0, p.team || '']; });
    const mv = monitor ? monitor.snapshot() : {};
    const s = {
      app: 'caseroom', v: 2, hid: G.hid, gid: G.gid, seq: ++G.seq, ts: Date.now(), room: G.room,
      phase: G.phase,
      title: G.caseDef ? G.caseDef.title : '',
      step: st ? { id: st.id, type: st.type, title: st.title, text: st.type === 'scene' ? st.text : undefined, i: pr.i, n: pr.n } : null,
      hp: [Math.round(G.hp), G.hpMax],
      vit: mv.rhythm && mv.rhythm !== 'none' ? { hr: Math.round(mv.hr), bp: mv.nibpS ? `${mv.nibpS}/${mv.nibpD}` : '', spo2: Math.round(mv.spo2), etco2: Math.round(mv.etco2) } : null,
      n: rk.length,
      dice: G.settings.dice,
      kicked: [...G.kicked].slice(-60),
      insp: rk.filter((p) => p.insp).map((p) => p.pid),
      xp,
      top: rk.slice(0, 5).map((p) => [p.name, p.cls, p.xp]),
      teams: teamStandings().map((t) => [t.id, t.name, t.color, t.avg, t.members]),
    };
    const a = G.ask;
    if (a && (G.phase === 'choose' || G.phase === 'roll')) {
      const spec = a.kind === 'roll' ? a.spec : st;
      s.ask = {
        sid: a.sid, kind: a.kind, title: spec.title, prompt: spec.prompt,
        options: a.kind === 'choice' ? st.options.map((o) => ({ k: o.k, t: o.text, ab: o.check.ab })) : null,
        ab: a.kind === 'roll' ? a.spec.check.ab : null,
        rem: a.dur ? Math.max(0, a.dur - (Date.now() - a.opened)) : null,
        dur: a.dur || null,
      };
      s.got = [...a.picks.keys()];
      s.rolled = [...a.rolls.keys()];
      s.rv = {}; // dice the DM screen rolled for each player, so each phone can show its own
      for (const [pid, r] of a.rolls) s.rv[pid] = r.d;
    }
    if (G.res && (G.phase === 'reveal' || G.phase === 'rollReveal')) {
      const r = G.res;
      const per = {};
      for (const [pid, x] of Object.entries(r.per)) per[pid] = [x.k || '', x.raw, x.bonus, x.total, x.ok ? 1 : 0, x.crit === 'nat20' ? 20 : x.crit === 'nat1' ? 1 : 0, x.xp, x.grade || '', x.ab || '', x.dc || 0];
      s.res = {
        sid: r.sid, kind: r.kind,
        best: r.kind === 'choice' ? bestKeys(st) : null,
        party: r.party ? { k: r.party.k || null, ok: r.party.ok, passed: r.party.passed, total: r.party.total, ab: r.party.ab, dc: r.party.dc } : null,
        partyText: r.kind === 'choice' && r.party ? (opt(st, r.party.k) || {}).text : null,
        note: r.effect ? r.effect.note : '',
        hp: r.effect ? r.effect.hp || 0 : 0,
        per,
      };
    }
    if (G.phase === 'final') s.fin = { win: G.hp > 0 };
    s.locked = G.locked;
    return s;
  }

  /* ---------------- player messages ---------------- */

  function addPlayer(pid, name, cls, bot) {
    const p = { pid, name: cleanName(name), cls: typeof cls === 'string' && Object.prototype.hasOwnProperty.call(R.CLASSES, cls) ? cls : 'emt', xp: 0, lastXp: 0, joined: Date.now(), seen: Date.now(), bot: !!bot, crits: 0, fumbles: 0, insp: false, team: null, log: [] };
    G.players.set(pid, p);
    assignTeam(p);
    return p;
  }

  /* ---- teams ---- */
  function teamList() { return R.TEAMS.slice(0, G.settings.teams || 0); }
  function teamOf(id) { return R.TEAMS.find((t) => t.id === id) || null; }
  function assignTeam(p) {
    const ts = teamList();
    if (!ts.length) return;
    if (p.team && ts.some((t) => t.id === p.team)) return;
    const counts = {};
    ts.forEach((t) => { counts[t.id] = 0; });
    for (const q of G.players.values()) if (q !== p && !G.kicked.has(q.pid) && counts[q.team] != null) counts[q.team]++;
    p.team = ts.slice().sort((a, b) => counts[a.id] - counts[b.id])[0].id;
  }
  function ensureTeams() { for (const p of G.players.values()) assignTeam(p); }
  function teamStandings() {
    const ts = teamList();
    if (!ts.length) return [];
    const people = ranked();
    const rows = ts.map((t) => {
      const mem = people.filter((p) => p.team === t.id);
      const total = mem.reduce((sum, p) => sum + p.xp, 0);
      return { id: t.id, name: t.name, color: t.color, members: mem.length, total, avg: mem.length ? Math.round(total / mem.length) : 0 };
    });
    rows.sort((a, b) => b.avg - a.avg || b.total - a.total);
    return rows;
  }

  /* ---- session log (for export) ---- */
  function logHistory() {
    const r = G.res, a = G.ask;
    if (!r || !a) return;
    const st = step();
    const isRoll = a.kind === 'roll';
    const o = !isRoll && r.party ? opt(st, r.party.k) : null;
    const entry = {
      sid: r.sid, at: Date.now(), caseTitle: G.caseDef ? G.caseDef.title : '',
      title: isRoll ? (a.spec.title || (st && st.title) || 'Roll') : st.title,
      kind: isRoll ? (a.adhoc ? 'DM roll' : 'Group roll') : 'Decision',
      action: o ? `${o.k}: ${o.text}` : isRoll ? `${R.ABILITIES[a.spec.check.ab].name} check, DC ${a.spec.check.dc}` : '',
      grade: o ? o.grade : '',
      ok: r.party ? r.party.ok : null,
      forced: !!(r.party && r.party.forced),
      hp: Math.round(G.hp),
    };
    const i = G.history.findIndex((h) => h.sid === entry.sid);
    if (i >= 0) G.history[i] = entry; else G.history.push(entry);
  }

  /* Every uplink message is untrusted: on a public relay it can come from anyone.
     Each phone makes a secret token when it joins and sends it with every message; the DM screen binds
     the token to that player and ignores messages for the player that don't carry it. Dice are rolled
     here, never on the phone. Bots are local, so their calls are trusted. */
  const MAX_PLAYERS = 150;
  const PID_RE = /^(p|bot)-[A-Za-z0-9]{4,24}$/;
  const TOK_RE = /^[A-Za-z0-9]{16,64}$/;
  const KEY_RE = /^[A-H]$/;
  const UP_TYPES = ['join', 'pick', 'roll', 'team', 'hb'];
  function overRate(p) { // at most 40 messages per player per 10 seconds
    const now = Date.now();
    if (!p.rl || now - p.rl.t0 > 10000) p.rl = { t0: now, n: 0 };
    return ++p.rl.n > 40;
  }
  function joinAllowed() {
    if (G.locked || G.players.size >= MAX_PLAYERS) return false;
    const now = Date.now(), w = G.joinWin;
    if (now - w.t0 > 10000) { w.t0 = now; w.n = 0; }
    return ++w.n <= 80;
  }
  function onUp(m, trusted) {
    if (!m || typeof m !== 'object' || !UP_TYPES.includes(m.t)) return;
    if (typeof m.pid !== 'string' || !PID_RE.test(m.pid)) return;
    if (!trusted && (typeof m.tok !== 'string' || !TOK_RE.test(m.tok))) return;
    if (G.kicked.has(m.pid)) { schedulePublish(); return; }
    if (G.phase === 'setup') return;
    let p = G.players.get(m.pid);
    if (!p) {
      if (typeof m.name !== 'string' || !m.name.trim() || !joinAllowed()) return;
      p = addPlayer(m.pid, m.name, m.cls);
      if (!trusted) p.tok = m.tok;
    } else {
      if (!trusted) {
        if (!p.tok) p.tok = m.tok; // a player restored from an older save: bind now
        else if (p.tok !== m.tok) return; // someone else using this player's id
      }
      if (overRate(p)) return;
      if (m.t === 'join') {
        if (typeof m.name === 'string' && m.name.trim()) p.name = cleanName(m.name);
        if (typeof m.cls === 'string' && Object.prototype.hasOwnProperty.call(R.CLASSES, m.cls)) p.cls = m.cls;
      }
    }
    p.seen = Date.now();
    if (m.t === 'team' && ['lobby', 'setup'].includes(G.phase) && typeof m.team === 'string' && teamList().some((t) => t.id === m.team)) {
      p.team = m.team;
      if (G.phase === 'lobby') scheduleLive();
    }
    assignTeam(p);
    const a = G.ask;
    if (m.t === 'pick' && a && !a.closed && a.kind === 'choice' && m.sid === a.sid && !a.picks.has(p.pid)) {
      const st = step();
      if (typeof m.k === 'string' && KEY_RE.test(m.k) && opt(st, m.k)) a.picks.set(p.pid, { k: m.k, t: Date.now() });
      checkAllIn();
    } else if (m.t === 'roll' && a && !a.closed && G.settings.dice && m.sid === a.sid && !a.rolls.has(p.pid)) {
      if (a.kind === 'choice' && !a.picks.has(p.pid)) return;
      a.rolls.set(p.pid, { d: a.insp.has(p.pid) ? [R.d20(), R.d20()] : [R.d20()] });
      checkAllIn();
    }
    schedulePublish();
    scheduleLive();
    if (m.t !== 'hb') scheduleSave();
  }

  function checkAllIn() {
    const a = G.ask;
    if (!a || a.closed) return;
    const act = activePlayers();
    if (!act.length) return;
    const done = act.every((p) => (a.kind === 'choice' ? a.picks.has(p.pid) : true) && (!G.settings.dice || a.rolls.has(p.pid)));
    if (done && !a.allIn) {
      a.allIn = true;
      setTimeout(() => { if (G.ask === a && !a.closed) (a.kind === 'choice' ? closeChoice : closeRoll)(); }, 1400);
    }
  }

  /* ---------------- flow ---------------- */

  function openRoom() {
    G.room = cleanCode($('#setCode').value) || newCode();
    $('#setCode').value = G.room;
    G.gid = N.rid(6);
    G.locked = false;
    G.phase = 'lobby';
    G.hp = G.hpMax = (G.caseDef && G.caseDef.hp) || 100;
    saveJson(LS_SETTINGS, G.settings);
    startRelay();
    monitor.set({ rhythm: 'none' });
    render();
  }

  function beginCase() {
    if (!G.caseDef) return;
    const base = baseCase(G.caseDef.id) || G.caseDef;
    G.order = makeOrder(base);
    G.caseDef = applyOrder(base, G.order);
    G.finished = false;
    G.hp = G.hpMax = G.caseDef.hp || 100;
    monitor.setAlarms(G.caseDef.alarms);
    G.stepIdx = -1;
    G.res = null;
    G.ask = null;
    G.pendingNext = null;
    monitor.set({ rhythm: 'none' });
    advance();
  }

  function nextIdx(from, forcedId) {
    if (forcedId) { const i = idxOf(forcedId); if (i >= 0) return i; }
    const all = steps();
    for (let i = from + 1; i < all.length; i++) if (!all[i].branch) return i;
    return all.length;
  }

  function advance() {
    const ni = nextIdx(G.stepIdx, G.pendingNext);
    G.pendingNext = null;
    if (ni >= steps().length) return finish(null);
    gotoStep(ni);
  }

  function gotoStep(i) {
    G.stepIdx = i;
    G.res = null;
    G.ask = null;
    const st = step();
    if (st.vitals) applyVitals(st.vitals);
    if (st.hp) changeHp(st.hp);
    if (st.type === 'scene') G.phase = 'scene';
    else if (st.type === 'choice') openChoice(st);
    else if (st.type === 'roll') openRoll(st, false);
    else if (st.type === 'debrief') return finish(st);
    saveGame();
    render();
    publish();
  }

  function applyVitals(v) {
    if (v.rhythm === 'none') { monitor.set({ rhythm: 'none' }); return; }
    const cur = monitor.snapshot();
    if (cur.rhythm === 'none') monitor.set(Object.assign({}, v));
    else monitor.transition(v, 5000);
  }

  function changeHp(d) {
    if (!d) return;
    G.hp = clamp(G.hp + d, 0, G.hpMax);
    renderHp(d);
  }

  function inspiredSet() { return new Set([...G.players.values()].filter((p) => p.insp).map((p) => p.pid)); }

  function openChoice(st) {
    G.phase = 'choose';
    const secs = st.time || G.settings.timer;
    G.closeArm = 0;
    G.ask = {
      sid: G.gid + '.c' + (++G.askN) + '-' + st.id, kind: 'choice', opened: Date.now(), dur: secs ? secs * 1000 : 0,
      picks: new Map(), rolls: new Map(), closed: false, insp: inspiredSet(), pre: null, preHp: G.hp,
    };
    startTimer();
    botsAct();
  }

  function openRoll(spec, adhoc) {
    G.phase = 'roll';
    G.closeArm = 0;
    G.ask = {
      sid: G.gid + '.r' + (++G.askN), kind: 'roll', spec, adhoc: !!adhoc, opened: Date.now(), dur: 30000,
      picks: new Map(), rolls: new Map(), closed: false, insp: inspiredSet(), preHp: G.hp,
    };
    startTimer();
    botsAct();
  }

  function startTimer() {
    clearInterval(timerInt);
    timerInt = setInterval(() => {
      const a = G.ask;
      if (!a || a.closed) { clearInterval(timerInt); return; }
      if (a.dur && Date.now() - a.opened >= a.dur) { (a.kind === 'choice' ? closeChoice : closeRoll)(); return; }
      renderLive();
    }, 250);
  }

  function rollFor(p, a, ab, dc, judgment) {
    const got = a.rolls.get(p.pid);
    const dice = got ? got.d : [R.d20()];
    const raw = a.insp.has(p.pid) && dice.length > 1 ? Math.max(dice[0], dice[1]) : dice[0];
    const bonus = R.mod(p.cls, ab) + (judgment || 0);
    const r = R.resolve(raw, bonus, dc);
    if (a.insp.has(p.pid)) p.insp = false;
    if (r.crit === 'nat20') p.crits++;
    if (r.crit === 'nat1') p.fumbles++;
    return { raw, bonus, total: r.total, ok: r.ok, crit: r.crit, dice, auto: !got };
  }

  function closeChoice() {
    const a = G.ask;
    if (!a || a.closed || a.kind !== 'choice') return;
    a.closed = true;
    clearInterval(timerInt);
    const st = step();
    const counts = {};
    st.options.forEach((o) => { counts[o.k] = 0; });
    for (const pk of a.picks.values()) counts[pk.k]++;
    const per = {};
    for (const p of G.players.values()) p.lastXp = 0;
    for (const [pid, pk] of a.picks) {
      const p = G.players.get(pid);
      if (!p) continue;
      const o = opt(st, pk.k);
      let x = { k: pk.k, grade: o.grade, ok: true, raw: null, bonus: null, total: null, crit: null, ab: o.check.ab, dc: o.check.dc };
      if (G.settings.dice) Object.assign(x, rollFor(p, a, o.check.ab, o.check.dc, R.JUDGMENT_BONUS[o.grade]));
      let xp = R.XP.choice[o.grade] || 0;
      if (G.settings.dice && o.grade !== 'wrong') { if (x.ok) xp += R.XP.successBonus; if (x.crit === 'nat20') xp += R.XP.critBonus; }
      x.xp = xp;
      p.xp += xp;
      p.lastXp = xp;
      per[pid] = x;
      p.log.push({ caseTitle: G.caseDef.title, title: st.title, kind: 'Decision', k: pk.k, text: o.text, grade: o.grade, raw: x.raw, total: x.total, dc: G.settings.dice ? o.check.dc : null, ok: x.ok, crit: x.crit, xp, at: Date.now() });
    }
    for (const p of activePlayers()) {
      if (!a.picks.has(p.pid)) p.log.push({ caseTitle: G.caseDef.title, title: st.title, kind: 'Decision', k: '', text: '', grade: 'none', raw: null, total: null, dc: null, ok: null, crit: null, xp: 0, at: Date.now() });
    }
    let partyK;
    if (G.settings.follow === 'best' || a.picks.size === 0) partyK = bestKeys(st)[0];
    else partyK = plurality(counts, st);
    G.res = { sid: a.sid, kind: 'choice', counts, per, party: null, effect: null, first: true };
    resolveParty(partyK, null);
    G.phase = 'reveal';
    saveGame();
    render();
    publish();
  }

  function plurality(counts, st) {
    const max = Math.max(...Object.values(counts));
    const tied = st.options.filter((o) => counts[o.k] === max);
    const rank = { wrong: 0, ok: 1, best: 2 };
    tied.sort((x, y) => rank[x.grade] - rank[y.grade]); // a split vote plays out the riskier call
    return tied[0].k;
  }

  // Decide the party's outcome for action k (group check) and apply it. force: true/false/null
  function resolveParty(k, force) {
    const st = step(), a = G.ask, res = G.res;
    const o = opt(st, k);
    if (!res.first) { // DM override: undo the previous outcome first
      G.hp = res.preHp;
      if (res.preVitals) monitor.set(res.preVitals);
    } else {
      res.preHp = G.hp;
      res.preVitals = monitor.snapshot();
      res.preVitals.sbp = res.preVitals.nibpS || res.preVitals.sbp;
      res.preVitals.dbp = res.preVitals.nibpD || res.preVitals.dbp;
    }
    res.first = false;
    let ok = true, passed = 0, total = 0, dmRoll = null;
    if (G.settings.dice) {
      const rollers = Object.values(res.per).filter((x) => x.k === k && x.raw != null);
      if (rollers.length) {
        passed = rollers.filter((x) => x.ok).length;
        total = rollers.length;
        ok = passed * 2 >= total;
      } else {
        const raw = R.d20();
        const r = R.resolve(raw, R.JUDGMENT_BONUS[o.grade], o.check.dc);
        dmRoll = { raw, bonus: R.JUDGMENT_BONUS[o.grade], total: r.total, ok: r.ok, crit: r.crit };
        ok = r.ok; passed = ok ? 1 : 0; total = 1;
      }
    }
    if (force === true || force === false) ok = force;
    res.party = { k, ok, passed, total, dmRoll, ab: o.check.ab, dc: o.check.dc, forced: force === true || force === false };
    const eff = (ok ? o.success : o.fail) || {};
    res.effect = { note: eff.note || '', hp: eff.hp || 0, ecg: eff.ecg || null };
    applyEffect(eff);
    G.pendingNext = eff.next || null;
    logHistory();
  }

  function applyEffect(eff) {
    if (!eff) return;
    const v = Object.assign({}, eff.vitals || {});
    if (eff.pause) v.pause = eff.pause;
    if (Object.keys(v).length) monitor.transition(v, 6000);
    if (eff.hp) changeHp(eff.hp);
  }

  function closeRoll() {
    const a = G.ask;
    if (!a || a.closed || a.kind !== 'roll') return;
    a.closed = true;
    clearInterval(timerInt);
    const spec = a.spec;
    const per = {};
    for (const p of G.players.values()) p.lastXp = 0;
    const act = new Set(activePlayers().map((p) => p.pid));
    for (const p of G.players.values()) {
      if (G.kicked.has(p.pid)) continue;
      if (!a.rolls.has(p.pid) && !act.has(p.pid)) continue;
      const x = rollFor(p, a, spec.check.ab, spec.check.dc, 0);
      x.ab = spec.check.ab;
      x.dc = spec.check.dc;
      x.xp = x.ok ? R.XP.rollPass + (x.crit === 'nat20' ? R.XP.rollCrit : 0) : 0;
      p.xp += x.xp;
      p.lastXp = x.xp;
      per[p.pid] = x;
      p.log.push({ caseTitle: G.caseDef ? G.caseDef.title : '', title: spec.title || (step() || {}).title || 'Roll', kind: a.adhoc ? 'DM roll' : 'Group roll', k: '', text: `${R.ABILITIES[spec.check.ab].name} check`, grade: '', raw: x.raw, total: x.total, dc: spec.check.dc, ok: x.ok, crit: x.crit, xp: x.xp, at: Date.now() });
    }
    const xs = Object.values(per);
    let ok, passed = 0, total = 0, dmRoll = null;
    if (!G.settings.dice) { ok = true; }
    else if (xs.length) { passed = xs.filter((x) => x.ok).length; total = xs.length; ok = passed * 2 >= total; }
    else {
      const raw = R.d20();
      const r = R.resolve(raw, 0, spec.check.dc);
      dmRoll = { raw, bonus: 0, total: r.total, ok: r.ok, crit: r.crit };
      ok = r.ok; passed = ok ? 1 : 0; total = 1;
    }
    const eff = (ok ? spec.success : spec.fail) || {};
    G.res = { sid: a.sid, kind: 'roll', per, party: { ok, passed, total, dmRoll, ab: spec.check.ab, dc: spec.check.dc }, effect: { note: eff.note || '', hp: eff.hp || 0 }, preHp: G.hp, first: false };
    applyEffect(eff);
    logHistory();
    G.phase = 'rollReveal';
    saveGame();
    render();
    publish();
  }

  function forceRoll(ok) {
    const res = G.res;
    if (!res || res.kind !== 'roll' || !res.party) return;
    const spec = G.ask.spec;
    G.hp = res.preHp;
    res.party.ok = ok;
    res.party.forced = true;
    const eff = (ok ? spec.success : spec.fail) || {};
    res.effect = { note: eff.note || '', hp: eff.hp || 0 };
    applyEffect(eff);
    logHistory();
    render();
    publish();
    saveGame();
  }

  function next() {
    const now = Date.now();
    if (now - lastNextAt < 800) return; // a clicker double-press, or a key bounce
    lastNextAt = now;
    switch (G.phase) {
      case 'lobby': return beginCase();
      case 'scene': return advance();
      case 'choose':
      case 'roll': return tryCloseVote(now);
      case 'reveal':
        if (G.settings.board === 'each' && G.players.size) { G.phase = 'board'; render(); publish(); saveGame(); return; }
        return advance();
      case 'rollReveal':
        if (G.adhoc) return resumeAdhoc();
        return advance();
      case 'board': return advance();
      default: return undefined;
    }
  }

  // How many of the people in the room have answered the open vote (picked a choice, or rolled a check)
  function answered(a) {
    const act = activePlayers();
    const done = act.filter((p) => (a.kind === 'choice' ? a.picks.has(p.pid) : a.rolls.has(p.pid))).length;
    return { done, total: act.length };
  }
  function armed() { return !!(G.closeArm && Date.now() - G.closeArm < 5000); }

  // Closing a vote can't be undone, so a stray press doesn't do it: presses in the first seconds after a
  // vote opens are ignored, and while answers are still coming in it takes a second press to close.
  function tryCloseVote(now) {
    const a = G.ask;
    if (!a || a.closed) return;
    if (now - a.opened < 2500) return;
    const n = answered(a);
    if (n.done < n.total && !armed()) {
      G.closeArm = now;
      renderControls();
      setTimeout(renderControls, 5100);
      return;
    }
    G.closeArm = 0;
    (a.kind === 'choice' ? closeChoice : closeRoll)();
  }

  function finish(st) {
    clearInterval(timerInt);
    G.ask = null;
    G.res = null;
    if (!G.finished) {
      G.finished = true;
      if (G.hp > 0) for (const p of G.players.values()) { p.xp += R.XP.survive; p.lastXp = R.XP.survive; p.log.push({ caseTitle: G.caseDef.title, title: 'Patient survived', kind: 'Bonus', k: '', text: '', grade: '', raw: null, total: null, dc: null, ok: null, crit: null, xp: R.XP.survive, at: Date.now() }); }
      G.history.push({ sid: 'end-' + Date.now(), at: Date.now(), caseTitle: G.caseDef.title, title: 'Outcome', kind: 'Outcome', action: G.hp > 0 ? 'Patient survived' : 'Patient crashed', grade: '', ok: G.hp > 0, forced: false, hp: Math.round(G.hp) });
    }
    G.debrief = st || [...steps()].reverse().find((s) => s.type === 'debrief') || null;
    G.phase = 'final';
    saveGame();
    render();
    publish();
  }

  /* ---- DM ad hoc roll ---- */
  function startAdhoc(ab, dc, text) {
    if (!['scene', 'reveal', 'board', 'lobby', 'rollReveal'].includes(G.phase) || G.adhoc) return;
    G.adhoc = { phase: G.phase, ask: G.ask, res: G.res, pendingNext: G.pendingNext };
    openRoll({ title: text || `Roll for it`, prompt: '', check: { ab, dc } }, true);
    render();
    publish();
  }
  function resumeAdhoc() {
    const s = G.adhoc;
    G.adhoc = null;
    G.phase = s.phase;
    G.ask = s.ask;
    G.res = s.res;
    G.pendingNext = s.pendingNext;
    render();
    publish();
    saveGame();
  }

  /* ---- bots ---- */
  function addBots(n) {
    const used = new Set([...G.players.values()].map((p) => p.name));
    const names = BOT_NAMES.filter((x) => !used.has(x));
    for (let i = 0; i < n && i < names.length; i++) {
      const cls = R.CLASS_ORDER[Math.floor(Math.random() * R.CLASS_ORDER.length)];
      addPlayer('bot-' + N.rid(6), names[i], cls, true);
    }
    render();
    publish();
    scheduleSave();
  }

  function botsAct() {
    const a = G.ask;
    const bots = [...G.players.values()].filter((p) => p.bot && !G.kicked.has(p.pid));
    const st = step();
    const maxDelay = a.dur ? Math.min(a.dur * 0.6, 14000) : 9000;
    for (const b of bots) {
      setTimeout(() => {
        if (G.ask !== a || a.closed) return;
        if (a.kind === 'choice') {
          const r = Math.random();
          const pool = (g) => st.options.filter((o) => o.grade === g);
          let choices = r < 0.55 ? pool('best') : r < 0.75 ? pool('ok') : pool('wrong');
          if (!choices.length) choices = st.options;
          const k = choices[Math.floor(Math.random() * choices.length)].k;
          onUp({ t: 'pick', pid: b.pid, sid: a.sid, k, mid: N.rid(10) }, true);
        }
        if (G.settings.dice) {
          setTimeout(() => {
            if (G.ask !== a || a.closed) return;
            onUp({ t: 'roll', pid: b.pid, sid: a.sid, mid: N.rid(10) }, true);
          }, 600 + Math.random() * 1800);
        }
      }, 1200 + Math.random() * maxDelay);
    }
  }

  /* ---- save / resume (survives an accidental refresh) ----
     The save is a full snapshot: the screen you were on, the open question with its answers so far, the last
     result, and where the story goes next. Resume puts you back on that screen. It never reopens a decision
     that was already scored, so XP, HP, and the log can't count twice. */
  function packAsk(a) {
    if (!a) return null;
    return {
      sid: a.sid, kind: a.kind, opened: a.opened, dur: a.dur, closed: !!a.closed, adhoc: !!a.adhoc, preHp: a.preHp,
      picks: [...a.picks], rolls: [...a.rolls], insp: [...a.insp], spec: a.kind === 'roll' ? a.spec : null, savedAt: Date.now(),
    };
  }
  function unpackAsk(x) {
    if (!x) return null;
    return Object.assign({}, x, { picks: new Map(x.picks || []), rolls: new Map(x.rolls || []), insp: new Set(x.insp || []), allIn: false });
  }
  function saveGame() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!G.room || !G.caseDef || G.phase === 'setup') return;
    // An ad hoc DM roll is a short detour: save the screen underneath it.
    const u = G.adhoc ? G.adhoc : { phase: G.phase, ask: G.ask, res: G.res, pendingNext: G.pendingNext };
    saveJson(LS_SAVE, {
      v: 3, ts: Date.now(), room: G.room, gid: G.gid, askN: G.askN, caseId: G.caseDef.id, order: G.order,
      stepIdx: G.stepIdx, hp: G.hp, hpMax: G.hpMax, finished: G.finished,
      phase: u.phase, ask: packAsk(u.ask), res: u.res || null, pendingNext: u.pendingNext || null, locked: G.locked,
      players: [...G.players.values()], kicked: [...G.kicked], settings: G.settings, history: G.history,
      vit: monitor ? monitor.snapshot() : null,
    });
  }
  function scheduleSave() {
    if (saveTimer || G.phase === 'setup') return;
    saveTimer = setTimeout(saveGame, 1500);
  }
  function savedGame() {
    const s = loadJson(LS_SAVE);
    if (!s || Date.now() - s.ts > 4 * 3600 * 1000 || s.phase === 'setup') return null;
    if (!baseCase(s.caseId)) return null;
    return s;
  }
  function resumeGame(s) {
    clearInterval(timerInt);
    G.room = s.room;
    G.gid = s.gid || N.rid(6);
    G.askN = s.askN || 0;
    G.order = s.order || null;
    G.caseDef = applyOrder(baseCase(s.caseId), G.order);
    G.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
    G.players = new Map(s.players.map((p) => [p.pid, Object.assign({ log: [], team: null }, p)]));
    G.history = s.history || [];
    G.kicked = new Set(s.kicked || []);
    G.hp = s.hp;
    G.hpMax = s.hpMax || G.caseDef.hp || 100;
    G.finished = !!s.finished;
    G.stepIdx = s.stepIdx;
    G.pendingNext = s.pendingNext || null;
    G.locked = !!s.locked;
    G.adhoc = null;
    G.ask = null;
    G.res = null;
    $('#setCode').value = G.room;
    monitor.setAlarms(G.caseDef && G.caseDef.alarms);
    if (s.vit && s.vit.rhythm && s.vit.rhythm !== 'none') {
      const v = Object.assign({}, s.vit);
      if (v.nibpS) { v.sbp = v.nibpS; v.dbp = v.nibpD; }
      monitor.set(v);
    } else monitor.set({ rhythm: 'none' });

    const st = step();
    let ph = s.phase;
    let reopen = false;
    if (ph === 'lobby' || G.stepIdx < 0 || !st) ph = 'lobby';
    else if (ph === 'final') { G.debrief = [...steps()].reverse().find((x) => x.type === 'debrief') || null; }
    else if (!s.v || s.v < 3) {
      // a save from before full snapshots: never re-ask a question that may already be scored
      if (ph === 'choose' || ph === 'roll') reopen = true;
      else if (ph !== 'scene') ph = 'board';
    } else if (ph === 'choose' || ph === 'roll') {
      const a = unpackAsk(s.ask);
      if (a && !a.closed) {
        if (a.kind === 'roll' && !a.adhoc && st.type === 'roll') a.spec = st;
        // keep the time that was left, but give phones at least 15 seconds to resend their answers
        if (a.dur) {
          const used = clamp((a.savedAt || s.ts) - a.opened, 0, a.dur);
          a.opened = Date.now() - (a.dur - Math.max(15000, a.dur - used));
        }
        G.ask = a;
      } else reopen = true;
    } else if (ph === 'reveal' || ph === 'rollReveal') {
      const a = unpackAsk(s.ask);
      if (a && s.res) {
        if (a.kind === 'roll' && !a.adhoc && st.type === 'roll') a.spec = st;
        G.ask = a;
        G.res = s.res;
      } else ph = 'board';
    }
    G.phase = ph;
    if (reopen) {
      if (st.type === 'choice') openChoice(st);
      else if (st.type === 'roll') openRoll(st, false);
      else G.phase = 'scene';
    }
    startRelay();
    viewKey = '';
    render();
    if (!reopen && G.ask && !G.ask.closed && (G.phase === 'choose' || G.phase === 'roll')) {
      startTimer();
      botsAct();
      checkAllIn();
    }
    saveGame();
    publish();
  }

  /* ---------------- rendering ---------------- */

  function show(id) {
    for (const v of $$('.view')) v.hidden = v.id !== id;
  }

  function render() {
    renderBar();
    const key = G.phase + '|' + G.stepIdx + '|' + (G.ask ? G.ask.sid : '') + '|' + (G.res ? G.res.sid + ':' + (G.res.party && G.res.party.k) + ':' + (G.res.party && G.res.party.ok) + ':' + (G.res.party && G.res.party.forced) : '');
    if (G.phase === 'setup') { show('vSetup'); renderSetup(); }
    else if (G.phase === 'lobby') { show('vLobby'); renderLobby(); }
    else if (G.phase === 'final') { show('vFinal'); if (key !== viewKey) renderFinal(); }
    else {
      show('vGame');
      document.body.dataset.phase = G.phase;
      if (key !== viewKey) renderGame();
      renderHp(0);
    }
    viewKey = key;
    renderLive();
    renderControls();
  }

  function scheduleLive() {
    if (liveTimer) return;
    liveTimer = setTimeout(() => { liveTimer = null; if (G.phase === 'lobby') renderLobby(); renderLive(); renderBar(); }, 150);
  }

  function renderBar() {
    $('#barTitle').textContent = G.caseDef && G.phase !== 'setup' ? G.caseDef.title : '';
    const pr = progress();
    $('#barStep').textContent = G.stepIdx >= 0 && !['setup', 'lobby', 'final'].includes(G.phase) ? `${pr.i} / ${pr.n}` : '';
    const join = $('#barJoin');
    join.hidden = !G.room || G.phase === 'setup';
    join.textContent = G.room ? `Join · ${G.room}` : '';
    const party = $('#barParty');
    party.hidden = G.phase === 'setup';
    party.textContent = `👥 ${ranked().length}`;
    const dot = $('#barNet');
    dot.className = 'dot ' + (G.phase === 'setup' ? 'idle' : G.net.ok > 0 ? 'ok' : G.net.local ? 'warn' : 'bad');
    dot.title = G.net.list.length ? 'Relays: ' + G.net.list.map((x) => `${x.name} ${x.ok ? '✓' : '…'}`).join(' · ') : 'Not connected';
    $('#btnRoll').hidden = G.phase === 'setup';
    $('#btnRoll').disabled = !['scene', 'reveal', 'board', 'lobby', 'rollReveal'].includes(G.phase) || !!G.adhoc;
  }

  function renderControls() {
    const btn = $('#btnNext');
    const hint = $('#hint');
    let label = 'Next ▸', h = '→ / Space / clicker', hide = false;
    switch (G.phase) {
      case 'setup': hide = true; h = ''; break;
      case 'lobby': label = 'Begin the adventure ▸'; h = ranked().length ? `${ranked().length} in the party` : 'Waiting for players… or add a practice party'; break;
      case 'scene': h = '→ / Space / clicker to continue · R to call for a roll'; break;
      case 'choose':
      case 'roll':
        label = G.phase === 'choose' ? 'Close the vote ▸' : 'Close the roll ▸';
        if (armed() && G.ask) {
          const n = answered(G.ask);
          label = `Press again to close · ${n.done}/${n.total} in`;
          h = 'Not everyone has answered yet';
        }
        break;
      case 'reveal': label = G.settings.board === 'each' && G.players.size ? 'Standings ▸' : 'Continue ▸'; h = 'R to call for a roll'; break;
      case 'board': h = '✧ grants Inspiration (advantage on the next roll)'; break;
      case 'rollReveal': label = G.adhoc ? 'Back to the story ▸' : 'Continue ▸'; break;
      case 'final': hide = true; h = ''; break;
      default: break;
    }
    btn.hidden = hide;
    btn.textContent = label;
    btn.classList.toggle('armed', (G.phase === 'choose' || G.phase === 'roll') && armed());
    hint.textContent = h;
  }

  /* ---- setup ---- */
  function seg(name, opts, cur) {
    return `<div class="seg" data-set="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(cur) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  }
  function settingsHtml() {
    const s = G.settings;
    return `
      <label class="row"><span>Decision timer</span>${seg('timer', [[30, '30s'], [45, '45s'], [60, '60s'], [90, '90s'], [0, 'Off']], s.timer)}</label>
      <label class="row"><span>Dice rolls</span>${seg('dice', [[true, 'On'], [false, 'Off']], s.dice)}</label>
      <label class="row"><span>Patient follows</span>${seg('follow', [['party', 'Party vote'], ['best', 'Best answer']], s.follow)}</label>
      <label class="row"><span>Teams</span>${seg('teams', [[0, 'Off'], [2, '2'], [3, '3'], [4, '4']], s.teams)}</label>
      <label class="row"><span>Standings</span>${seg('board', [['each', 'After each decision'], ['end', 'End only']], s.board)}</label>
      <label class="row"><span>Rhythm name on monitor</span>${seg('showRhythm', [[false, 'Hide'], [true, 'Show']], s.showRhythm)}</label>
      <label class="row"><span>Monitor beep</span>${seg('sound', [[false, 'Off'], [true, 'On']], s.sound)}</label>`;
  }
  function bindSettings(root) {
    for (const sg of $$('.seg', root)) {
      sg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const k = sg.dataset.set;
        let v = b.dataset.v;
        if (v === 'true') v = true; else if (v === 'false') v = false; else if (/^\d+$/.test(v)) v = parseInt(v, 10);
        G.settings[k] = v;
        saveJson(LS_SETTINGS, G.settings);
        $$('button', sg).forEach((x) => x.classList.toggle('on', x === b));
        if (k === 'showRhythm') monitor.setShowRhythm(v);
        if (k === 'sound') monitor.enableSound(v);
        if (k === 'teams') { ensureTeams(); if (G.phase === 'lobby') renderLobby(); viewKey = ''; if (!['setup', 'lobby'].includes(G.phase)) render(); }
        renderControls();
        schedulePublish();
      });
    }
  }

  function renderSetup() {
    const el = $('#vSetup');
    if (el.dataset.built) return;
    el.dataset.built = '1';
    const saved = savedGame();
    el.innerHTML = `
      <div class="setup">
        <div class="hero">
          <div class="crest">${R.d20Svg(20, { fill: '#1b1f29' })}</div>
          <div>
            <h1>Case Room</h1>
            <p>Live patient cases played like a tabletop RPG. You're the Dungeon Master. Your class joins on their phones, picks a move, and rolls for it.</p>
          </div>
        </div>
        ${saved ? `<div class="resume"><span>Unfinished game in room <b>${esc(saved.room)}</b> · ${esc((CASES.find((c) => c.id === saved.caseId) || {}).title || '')}</span><button type="button" id="btnResume">Resume</button></div>` : ''}
        <h2>Choose a case</h2>
        <p class="lib-note">Grouped by National Registry recertification topic (NCCP 2025).</p>
        ${libraryHtml()}
        <h2>Settings</h2>
        <div class="settings">
          <label class="row"><span>Room code</span><span class="code-in"><input id="setCode" maxlength="8" autocomplete="off" spellcheck="false" placeholder="Auto"><button type="button" id="btnNewCode">New</button></span></label>
          ${settingsHtml()}
        </div>
        <button type="button" class="primary big" id="btnOpen">Open the room</button>
        <p class="fine">Teaching simulation. Follow your local protocols.</p>
      </div>`;
    const fixed = cleanCode(params.get('r'));
    $('#setCode').value = G.room || fixed || newCode();
    $('#btnNewCode').onclick = () => { $('#setCode').value = newCode(); };
    $('#btnOpen').onclick = () => { monitor.enableSound(G.settings.sound); openRoom(); };
    if (saved) $('#btnResume').onclick = () => { monitor.enableSound(G.settings.sound); resumeGame(saved); };
    for (const f of $$('.folder', el)) {
      f.onclick = () => {
        for (const x of $$('.folder', el)) { x.classList.toggle('on', x === f); x.setAttribute('aria-selected', String(x === f)); }
        for (const p of $$('.subfolders', el)) p.hidden = p.dataset.topic !== f.dataset.topic;
      };
    }
    for (const b of $$('.case', el)) b.onclick = () => { G.caseDef = CASES.find((c) => c.id === b.dataset.id); $$('.case', el).forEach((x) => x.classList.toggle('on', x === b)); };
    bindSettings(el);
  }

  /* ---- case library: Registry topic folders → Adult / Pediatric → body-system headings (js/topics.js) ---- */
  const TOPICS = window.CR_TOPICS || [];
  const AGES = window.CR_AGES || [{ id: 'adult', name: 'Adult' }, { id: 'pediatric', name: 'Pediatric' }];
  const FOLDER_ICON = '<svg class="fold-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.7l2 2.2h8.3A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>';
  function topicOf(c) { return TOPICS.some((t) => t.id === c.topic) ? c.topic : 'other'; }
  function ageOf(c) { return c.age === 'pediatric' ? 'pediatric' : 'adult'; }
  function subtopicOf(c) {
    const t = TOPICS.find((x) => x.id === c.topic);
    return (t && t.subtopics.find((s) => s.id === c.subtopic)) || null;
  }
  function nCases(n) { return n + (n === 1 ? ' case' : ' cases'); }
  // e.g. "Cardiology › Acute coronary syndromes · Adult"
  function folderName(c, ageSep, ageEnd) {
    const t = TOPICS.find((x) => x.id === c.topic);
    const s = subtopicOf(c);
    return (t ? t.name : 'Other') + (s ? ' › ' + s.name : '') + (ageSep || ' · ') + (ageOf(c) === 'pediatric' ? 'Pediatric' : 'Adult') + (ageEnd || '');
  }
  function caseCard(c) {
    return `
      <button type="button" class="case ${G.caseDef && G.caseDef.id === c.id ? 'on' : ''}" data-id="${esc(c.id)}">
        <span class="case-t">${esc(c.title)}</span>
        <span class="case-s">${esc(c.tagline || '')}</span>
        <span class="case-m">${esc(c.level || '')} · ~${esc(c.minutes || 15)} min · ${c.steps.filter((s) => s.type === 'choice' && !s.branch).length} decisions</span>
      </button>`;
  }
  // Every heading shows, so the whole map is visible. Empty ones are dimmed and take one line.
  function headingsHtml(topic, list) {
    const t = TOPICS.find((x) => x.id === topic);
    const subs = t ? t.subtopics : [];
    const rows = subs.map((s) => ({ s, cases: list.filter((c) => c.subtopic === s.id) }));
    const other = list.filter((c) => !subs.some((s) => s.id === c.subtopic));
    if (other.length) rows.push({ s: { id: 'other', name: 'Other' }, cases: other });
    return rows.map((r) => `
            <div class="subtopic${r.cases.length ? '' : ' st-none'}" data-subtopic="${esc(r.s.id)}">
              <div class="st-h"><span>${esc(r.s.name)}</span>${r.cases.length ? `<small>${r.cases.length}</small>` : ''}</div>${r.cases.length ? `
              <div class="st-cases">${r.cases.map(caseCard).join('')}</div>` : ''}
            </div>`).join('');
  }
  function libraryHtml() {
    const topics = TOPICS.slice();
    if (CASES.some((c) => topicOf(c) === 'other')) topics.push({ id: 'other', name: 'Other', subtopics: [] });
    const open = G.caseDef ? topicOf(G.caseDef) : topics[0].id;
    return `
      <div class="folders" role="tablist" aria-label="Registry topics">${topics.map((t) => `
        <button type="button" class="folder ${t.id === open ? 'on' : ''}" data-topic="${t.id}" role="tab" aria-selected="${t.id === open}">
          ${FOLDER_ICON}<span class="fold-n">${esc(t.name)}</span><span class="fold-c">${nCases(CASES.filter((c) => topicOf(c) === t.id).length)}</span>
        </button>`).join('')}
      </div>${topics.map((t) => `
      <div class="subfolders" data-topic="${t.id}" role="tabpanel" ${t.id === open ? '' : 'hidden'}>${AGES.map((a) => {
        const list = CASES.filter((c) => topicOf(c) === t.id && ageOf(c) === a.id);
        return `
        <div class="subfolder">
          <div class="sub-h">${FOLDER_ICON}<span>${a.name}</span><small>${nCases(list.length)}</small></div>
          <div class="sub-cases">${headingsHtml(t.id, list)}
          </div>
        </div>`;
      }).join('')}
      </div>`).join('')}`;
  }

  /* ---- lobby ---- */
  function renderLobby() {
    const el = $('#vLobby');
    const key = G.room + '|' + (G.caseDef ? G.caseDef.id : '');
    if (el.dataset.key !== key) { // rebuild when the room or the case changes
      el.dataset.key = key;
      el.innerHTML = `
        <div class="lobby">
          <div class="join">
            <div class="kicker">Gather your party</div>
            <div class="qr">${qrSvg(joinUrl())}</div>
            <div class="join-url">Scan, or go to <b>${esc(joinDisplay())}</b></div>
            <div class="code-big"><span>Room</span><b>${esc(G.room)}</b></div>
          </div>
          <div class="roster">
            <div class="roster-h">${G.caseDef ? `<div class="kicker">${esc(folderName(G.caseDef))}</div>` : ''}<h2>${esc(G.caseDef ? G.caseDef.title : '')}</h2><span class="muted">${esc(G.caseDef ? G.caseDef.tagline : '')}</span></div>
            <div class="party" id="lobbyParty"></div>
            <div class="lobby-actions">
              <button type="button" id="btnBots" class="ghost">+ Practice party (6 bots)</button>
              <button type="button" id="btnLock" class="ghost"></button>
              <button type="button" id="btnBack" class="ghost">Change case or settings</button>
            </div>
          </div>
        </div>`;
      $('#btnBots').onclick = () => addBots(6);
      $('#btnLock').onclick = () => setLocked(!G.locked);
      $('#btnBack').onclick = () => {
        G.phase = 'setup';
        if (relay) { relay.publishState(Object.assign(buildState(), { phase: 'setup' })); }
        $('#vSetup').dataset.built = '';
        render();
      };
    }
    const lockBtn = $('#btnLock');
    if (lockBtn) { lockBtn.textContent = G.locked ? '🔒 Room locked · unlock' : '🔓 Lock room to new players'; lockBtn.classList.toggle('on', G.locked); }
    const list = ranked();
    const ts = teamList();
    const chip = (p) => `
      <div class="pc" data-pid="${esc(p.pid)}"${ts.length ? ' title="Tap to move to the next team"' : ''}>
        <span class="pc-i">${R.CLASSES[p.cls].icon}</span>
        <span class="pc-n">${esc(p.name)}</span>
        <span class="pc-c">${esc(R.CLASSES[p.cls].name)}${p.bot ? ' · bot' : ''}</span>
        <button type="button" class="pc-x" title="Remove from room">✕</button>
      </div>`;
    let html;
    if (!list.length) html = '<div class="empty">No one yet. Students scan the code to join and pick a class.</div>';
    else if (ts.length) {
      html = `<div class="teams-grid" style="--n:${ts.length}">${ts.map((t) => {
        const mem = list.filter((p) => p.team === t.id);
        return `<div class="team-col" style="--tc:${t.color}"><div class="team-h"><span class="tdot"></span>${esc(t.name)}<span class="muted">${mem.length}</span></div>${mem.map(chip).join('')}</div>`;
      }).join('')}</div>`;
    } else html = list.map(chip).join('');
    const box = $('#lobbyParty');
    if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
    for (const c of $$('.pc', box)) {
      c.onclick = (e) => {
        const pid = c.dataset.pid;
        if (e.target.closest('.pc-x')) { kickPlayer(pid); return; }
        const p = G.players.get(pid);
        if (!p || !ts.length) return;
        const i = ts.findIndex((t) => t.id === p.team);
        p.team = ts[(i + 1) % ts.length].id;
        renderLobby();
        publish();
      };
    }
  }

  /* ---- game ---- */
  function kicker(st) {
    if (G.phase === 'roll' && G.ask && G.ask.adhoc) return 'The DM calls for a roll';
    const t = { scene: 'Scene', choice: 'Decision', roll: 'Group check', debrief: 'Debrief' }[st.type] || '';
    return t;
  }

  function renderGame() {
    const left = $('#left');
    const st = step();
    const a = G.ask;
    document.body.classList.toggle('wide-ecg', !!(st && st.ecg && G.phase === 'choose'));
    if (G.phase === 'scene') {
      left.innerHTML = `
        <div class="kicker">${esc(kicker(st))}</div>
        <h1 class="title">${esc(st.title)}</h1>
        <div class="readaloud">${esc(st.text)}</div>`;
    } else if (G.phase === 'choose') {
      const opts = `<div class="opts">${st.options.map((o) => `
          <div class="opt k${o.k}"><span class="key">${o.k}</span><span class="txt">${esc(o.text)}</span></div>`).join('')}
        </div>`;
      const prog = `<div class="progress">
          <div class="timer"><div class="fill" id="tFill"></div></div>
          <div class="pcount" id="pCount"></div>
        </div>
        <div class="tokens" id="tokens"></div>`;
      left.innerHTML = `
        <div class="kicker">${esc(kicker(st))}</div>
        <h1 class="title">${esc(st.title)}</h1>
        <p class="prompt">${esc(st.prompt)}</p>
        ${st.ecg ? `<div class="ecg-q"><canvas class="ecg12" id="ecgMain"></canvas><div class="ecg-side">${opts}${prog}</div></div>` : opts + prog}`;
      if (st.ecg) drawEcg($('#ecgMain'), st.ecg);
    } else if (G.phase === 'roll') {
      const sp = a.spec;
      left.innerHTML = `
        <div class="kicker">${esc(kicker(st))}</div>
        <h1 class="title">${esc(sp.title || st.title)}</h1>
        ${sp.prompt ? `<p class="prompt">${esc(sp.prompt)}</p>` : ''}
        <div class="callroll">
          <div class="die-big">${R.d20Svg('?')}</div>
          <div><div class="ab-big">${esc(R.ABILITIES[sp.check.ab].name)} check</div><div class="muted">${esc(R.ABILITIES[sp.check.ab].ems)} · everyone rolls on their phone</div></div>
        </div>
        <div class="progress">
          <div class="timer"><div class="fill" id="tFill"></div></div>
          <div class="pcount" id="pCount"></div>
        </div>
        <div class="tokens" id="tokens"></div>`;
    } else if (G.phase === 'reveal') {
      renderReveal(left, st);
    } else if (G.phase === 'rollReveal') {
      renderRollReveal(left, st);
    } else if (G.phase === 'board') {
      renderBoard(left);
    }
  }

  function drawEcg(canvas, spec) {
    requestAnimationFrame(() => { try { W.render12(canvas, spec); } catch (e) { console.error(e); } });
  }

  function diceChips(per) {
    const rows = Object.entries(per).map(([pid, x]) => ({ p: G.players.get(pid), x })).filter((r) => r.p && r.x.raw != null);
    rows.sort((u, v) => (v.x.crit === 'nat20') - (u.x.crit === 'nat20') || v.x.total - u.x.total);
    const max = 12;
    const html = rows.slice(0, max).map(({ p, x }) => {
      const cls = x.crit === 'nat20' ? 'crit' : x.crit === 'nat1' ? 'fumble' : x.ok ? 'pass' : 'miss';
      return `<div class="chip-die ${cls}" title="${esc(p.name)}">${R.d20Svg(x.raw, { fill: cls === 'crit' ? '#3a2c0a' : cls === 'fumble' ? '#3a0d12' : '#1d222c', stroke: cls === 'pass' || cls === 'crit' ? '#d9a441' : '#7b2430' })}<span class="cd-n">${esc(p.name)}</span><span class="cd-t">${R.fmtMod(x.bonus)} → ${x.total}</span></div>`;
    }).join('');
    return html + (rows.length > max ? `<div class="chip-more">+${rows.length - max} more</div>` : '');
  }

  function critCallouts(per) {
    const crits = [], fumbles = [];
    for (const [pid, x] of Object.entries(per)) {
      const p = G.players.get(pid);
      if (!p) continue;
      if (x.crit === 'nat20') crits.push(p.name);
      if (x.crit === 'nat1') fumbles.push(p.name);
    }
    let h = '';
    if (crits.length) h += `<div class="callout crit">✦ Natural 20: ${esc(crits.join(', '))}</div>`;
    if (fumbles.length) h += `<div class="callout fumble">✖ Natural 1: ${esc(fumbles.join(', '))}</div>`;
    return h;
  }

  function tone(hp, ok) { return hp < 0 ? 'no' : hp > 0 ? 'ok' : ok ? 'neutral' : 'neutral'; }

  function renderReveal(left, st) {
    const r = G.res;
    const total = Object.values(r.counts).reduce((x, y) => x + y, 0);
    const best = bestKeys(st);
    const pk = r.party.k;
    const o = opt(st, pk);
    const partyPer = {};
    for (const [pid, x] of Object.entries(r.per)) if (x.k === pk) partyPer[pid] = x;
    const ok = r.party.ok;
    const dm = r.party.dmRoll;
    const who = !total ? 'No votes. The DM plays out' : G.settings.follow === 'best' ? 'The DM plays out' : 'The party chose';
    left.innerHTML = `
      <div class="kicker">${esc(kicker(st))} · result</div>
      <h1 class="title sm">${esc(st.title)}</h1>
      <div class="rv-top">
        <div class="votes">${st.options.map((x) => {
          const c = r.counts[x.k] || 0;
          const pct = total ? Math.round((100 * c) / total) : 0;
          return `<button type="button" class="vote k${x.k} ${x.k === pk ? 'party' : ''} g-${x.grade}" data-k="${x.k}" title="Play out ${x.k} instead">
            <span class="key">${x.k}</span>
            <span class="vbar"><span class="vfill" style="width:${pct}%"></span><span class="vtxt">${esc(x.text)}</span></span>
            <span class="vnum">${c}</span>
            <span class="vgrade">${x.grade === 'best' ? '✓' : x.grade === 'ok' ? '~' : '✗'}</span>
          </button>`;
        }).join('')}</div>
        <div class="check ${ok ? 'ok' : 'no'}">
          <div class="check-l">${who} <b>${esc(pk)}</b>${G.settings.dice ? `<br><span class="muted">${esc(R.ABILITIES[r.party.ab].name)} check · DC ${r.party.dc}</span>` : ''}</div>
          <div class="verdict">${ok ? 'SUCCESS' : 'FAILURE'}${G.settings.dice && !dm ? ` <small>${r.party.passed}/${r.party.total} passed</small>` : ''}${r.party.forced ? ' <small>DM ruling</small>' : ''}</div>
          ${o.grade === 'wrong' ? `<div class="harm">${ok ? 'They pulled off a harmful call.' : 'They fumbled a harmful call. Lucky patient.'}</div>` : ''}
          ${G.settings.dice ? `<div class="dice-row">${dm ? `<div class="chip-die ${dm.ok ? 'pass' : 'miss'}">${R.d20Svg(dm.raw)}<span class="cd-n">DM rolls</span><span class="cd-t">${R.fmtMod(dm.bonus)} → ${dm.total}</span></div>` : diceChips(partyPer)}</div>` : ''}
          ${critCallouts(r.per)}
        </div>
      </div>
      <div class="outcome ${tone(r.effect.hp, ok)}">
        <div class="outcome-t">${esc(o.text)}</div>
        <p>${esc(r.effect.note)}</p>
        ${r.effect.hp ? `<span class="hpd ${r.effect.hp > 0 ? 'up' : 'down'}">${r.effect.hp > 0 ? '+' : ''}${r.effect.hp} HP</span>` : ''}
        ${r.effect.ecg ? '<canvas class="ecg-strip" id="ecgEff"></canvas>' : ''}
      </div>
      <div class="lesson"><div class="lesson-h">The lesson · best call: ${best.map(esc).join(', ')}</div><p>${esc(st.teach || '')}</p></div>
      <div class="dm-tools"><span class="muted">DM:</span><button type="button" data-force="1">Rule success</button><button type="button" data-force="0">Rule failure</button>${st.ecg ? '<button type="button" id="btnShowEcg">Show the 12-lead</button>' : ''}<span class="muted">· Tap a bar to play out a different action</span></div>
      ${st.ecg ? '<canvas class="ecg12 small" id="ecgMain" hidden></canvas>' : ''}`;
    if (r.effect.ecg) drawEcg($('#ecgEff'), r.effect.ecg);
    if (st.ecg) {
      $('#btnShowEcg').onclick = () => {
        const c = $('#ecgMain');
        c.hidden = !c.hidden;
        $('#btnShowEcg').textContent = c.hidden ? 'Show the 12-lead' : 'Hide the 12-lead';
        if (!c.hidden) { drawEcg(c, st.ecg); setTimeout(() => c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60); }
      };
    }
    for (const b of $$('.vote', left)) b.onclick = () => { resolveParty(b.dataset.k, null); render(); publish(); saveGame(); };
    for (const b of $$('[data-force]', left)) b.onclick = () => { resolveParty(G.res.party.k, b.dataset.force === '1'); render(); publish(); saveGame(); };
  }

  function renderRollReveal(left, st) {
    const r = G.res;
    const sp = G.ask.spec;
    const ok = r.party.ok;
    const dm = r.party.dmRoll;
    left.innerHTML = `
      <div class="kicker">${esc(G.ask.adhoc ? 'The DM calls for a roll' : kicker(st))} · result</div>
      <h1 class="title">${esc(sp.title || st.title)}</h1>
      <div class="check wide ${ok ? 'ok' : 'no'}">
        <div class="check-h">
          <span class="check-l">${esc(R.ABILITIES[sp.check.ab].name)} check · DC ${sp.check.dc}</span>
          <span class="verdict">${ok ? 'SUCCESS' : 'FAILURE'}${G.settings.dice && !dm ? ` <small>${r.party.passed}/${r.party.total} passed</small>` : ''}${r.party.forced ? ' <small>DM ruling</small>' : ''}</span>
        </div>
        <div class="dice-row">${dm ? `<div class="chip-die ${dm.ok ? 'pass' : 'miss'}">${R.d20Svg(dm.raw)}<span class="cd-n">DM rolls</span><span class="cd-t">${dm.total}</span></div>` : diceChips(r.per)}</div>
        ${critCallouts(r.per)}
      </div>
      ${r.effect.note ? `<div class="outcome ${tone(r.effect.hp, ok)}"><p>${esc(r.effect.note)}</p>${r.effect.hp ? `<span class="hpd ${r.effect.hp > 0 ? 'up' : 'down'}">${r.effect.hp > 0 ? '+' : ''}${r.effect.hp} HP</span>` : ''}</div>` : ''}
      <div class="dm-tools"><span class="muted">DM:</span><button type="button" data-force="1">Rule success</button><button type="button" data-force="0">Rule failure</button></div>`;
    for (const b of $$('[data-force]', left)) b.onclick = () => forceRoll(b.dataset.force === '1');
  }

  function teamBoard(rows) {
    if (!rows.length) return '';
    const max = Math.max(1, ...rows.map((t) => t.avg));
    return `<div class="team-board">${rows.map((t, i) => `
      <div class="tb-row" style="--tc:${t.color}">
        <span class="b-rank">${i + 1}</span>
        <span class="tb-name">${esc(t.name)}<small>${t.members} ${t.members === 1 ? 'member' : 'members'}</small></span>
        <span class="tb-bar"><i style="width:${Math.round((100 * t.avg) / max)}%"></i></span>
        <span class="b-xp">${t.avg} <small>avg XP</small></span>
      </div>`).join('')}</div>`;
  }

  function renderBoard(left) {
    const rk = ranked();
    const tsr = teamStandings();
    const shown = tsr.length ? 5 : 8;
    left.innerHTML = `
      <div class="kicker">${tsr.length ? 'Team standings' : 'Party standings'}</div>
      <h1 class="title">${tsr.length ? 'Which shift is carrying the bag' : 'Who\'s carrying the bag'}</h1>
      ${teamBoard(tsr)}
      <ol class="board">${rk.slice(0, shown).map((p, i) => {
        const lv = R.levelFor(p.xp);
        const t = p.team ? teamOf(p.team) : null;
        return `<li class="${p.insp ? 'insp' : ''} ${t ? 'has-team' : ''}" data-pid="${esc(p.pid)}"${t ? ` style="--tc:${t.color}"` : ''}>
          <span class="b-rank">${i + 1}</span>
          <span class="b-icon">${R.CLASSES[p.cls].icon}</span>
          <span class="b-name">${esc(p.name)}<small>Lv ${lv.level} ${esc(lv.title)} · ${esc(R.CLASSES[p.cls].name)}${t ? ' · ' + esc(t.name) : ''}</small></span>
          <span class="b-delta">${p.lastXp ? '+' + p.lastXp : ''}</span>
          <span class="b-xp">${p.xp} XP</span>
          <button type="button" class="b-insp" title="Grant Inspiration: advantage on their next roll">${p.insp ? '✨' : '✧'}</button>
        </li>`;
      }).join('')}</ol>
      ${rk.length > shown ? `<p class="muted">+${rk.length - shown} more adventurers</p>` : ''}
      <p class="muted small">✧ Grant Inspiration for a great answer out loud. They roll with advantage next time.</p>`;
    for (const b of $$('.b-insp', left)) {
      b.onclick = () => {
        const p = G.players.get(b.closest('li').dataset.pid);
        if (!p) return;
        p.insp = !p.insp;
        viewKey = '';
        render();
        publish();
        scheduleSave();
      };
    }
  }

  function renderLive() {
    const a = G.ask;
    if ((G.phase === 'choose' || G.phase === 'roll') && a) {
      const fill = $('#tFill');
      if (fill) {
        if (a.dur) {
          const p = clamp(1 - (Date.now() - a.opened) / a.dur, 0, 1);
          fill.style.width = (p * 100).toFixed(1) + '%';
          fill.classList.toggle('low', p < 0.2);
        } else fill.style.width = '100%';
      }
      const act = ranked().length;
      const pc = $('#pCount');
      if (pc) {
        const secs = a.dur ? Math.ceil(Math.max(0, a.dur - (Date.now() - a.opened)) / 1000) + 's · ' : '';
        pc.textContent = a.kind === 'choice'
          ? `${secs}${a.picks.size} / ${act} chose${G.settings.dice ? ` · ${a.rolls.size} rolled` : ''}`
          : `${secs}${a.rolls.size} / ${act} rolled`;
      }
      const tk = $('#tokens');
      if (tk) {
        const ids = a.kind === 'choice' ? [...a.picks.keys()] : [...a.rolls.keys()];
        const html = ids.map((pid) => G.players.get(pid)).filter(Boolean).map((p) => `<span class="tok ${a.rolls.has(p.pid) ? 'rolled' : ''}">${R.CLASSES[p.cls].icon} ${esc(p.name)}</span>`).join('');
        if (tk.dataset.h !== html) { tk.innerHTML = html; tk.dataset.h = html; }
      }
    }
  }

  let hpShown = null;
  function renderHp(delta) {
    const el = $('#hp');
    const pct = G.hpMax ? (100 * G.hp) / G.hpMax : 0;
    el.querySelector('.hp-fill').style.width = pct + '%';
    el.querySelector('.hp-num').textContent = `${Math.round(G.hp)} / ${G.hpMax}`;
    el.classList.toggle('low', pct <= 30);
    el.classList.toggle('dead', G.hp <= 0);
    if (delta) {
      el.classList.remove('hit', 'heal');
      void el.offsetWidth;
      el.classList.add(delta < 0 ? 'hit' : 'heal');
      const f = document.createElement('span');
      f.className = 'hp-float ' + (delta < 0 ? 'down' : 'up');
      f.textContent = (delta > 0 ? '+' : '') + delta;
      el.appendChild(f);
      setTimeout(() => f.remove(), 1800);
    }
    hpShown = G.hp;
  }

  /* ---- final ---- */
  function renderFinal() {
    const el = $('#vFinal');
    const d = G.debrief || {};
    const rk = ranked();
    const win = G.hp > 0;
    const mvp = rk[0];
    const tsr = teamStandings();
    const champ = tsr[0];
    el.innerHTML = `
      <div class="final">
        <div class="final-l">
          <div class="kicker">Debrief</div>
          <h1 class="title">${esc(d.title || 'The End')}</h1>
          <div class="readaloud">${esc(d.text || '')}</div>
          ${d.points ? `<ul class="points">${d.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
          <div class="fate ${win ? 'win' : 'lose'}"><b>${win ? 'The patient survived' : 'The patient crashed'}</b> · ${Math.round(G.hp)} / ${G.hpMax} HP<p>${esc(win ? d.win || '' : d.lose || '')}</p>${win ? `<p class="small">Everyone earned +${R.XP.survive} XP for keeping the patient alive.</p>` : ''}</div>
          <div class="final-actions">
            <button type="button" class="primary" id="btnSetup">Next case, keep XP</button>
            <button type="button" class="ghost" id="btnAgain">New game, reset XP</button>
          </div>
          <div class="final-actions export">
            <span class="muted small">Results:</span>
            <button type="button" class="ghost" data-export="summary">⬇ Summary (CSV)</button>
            <button type="button" class="ghost" data-export="log">⬇ Decision log (CSV)</button>
          </div>
        </div>
        <div class="final-r">
          <h2>Final standings</h2>
          ${champ && champ.members ? `<div class="champ" style="--tc:${champ.color}"><span class="tdot"></span><b>${esc(champ.name)} wins</b><span>${champ.avg} avg XP · ${champ.members} ${champ.members === 1 ? 'member' : 'members'}</span></div>${teamBoard(tsr)}` : ''}
          ${mvp ? `<div class="mvp">${R.CLASSES[mvp.cls].icon} <b>${esc(mvp.name)}</b><span>MVP · ${mvp.xp} XP · Lv ${R.levelFor(mvp.xp).level} ${esc(R.levelFor(mvp.xp).title)}</span></div>` : ''}
          <ol class="board compact">${rk.slice(0, tsr.length ? 5 : 8).map((p, i) => `<li><span class="b-rank">${i + 1}</span><span class="b-icon">${R.CLASSES[p.cls].icon}</span><span class="b-name">${esc(p.name)}<small>${p.crits ? `✦${p.crits} ` : ''}${p.fumbles ? `✖${p.fumbles}` : ''}</small></span><span class="b-xp">${p.xp} XP</span></li>`).join('')}</ol>

        </div>
      </div>`;
    bindExport(el);
    $('#btnAgain').onclick = () => {
      for (const p of G.players.values()) { p.xp = 0; p.lastXp = 0; p.crits = 0; p.fumbles = 0; p.insp = false; p.log = []; }
      G.history = [];
      G.gid = N.rid(6);
      G.phase = 'lobby';
      saveGame();
      viewKey = '';
      render();
      publish();
    };
    $('#btnSetup').onclick = () => {
      G.phase = 'setup';
      publish();
      $('#vSetup').dataset.built = '';
      viewKey = '';
      render();
    };
  }

  /* ---------------- export (CSV) ---------------- */

  function csvCell(v) {
    if (v == null) return '';
    let t = String(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(t)) t = "'" + t; // keep spreadsheets from running names as formulas
    return '"' + t.replace(/"/g, '""') + '"'; // quote every cell, so no locale's separator can split one
  }
  function toCsv(rows) { return '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'); }
  function stamp(d) {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
  }
  function fileStamp() { return stamp(new Date()).replace(/[: ]/g, '-'); }
  function saveFile(name, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const GRADE_TXT = { best: 'Best call', ok: 'Reasonable', wrong: 'Harmful', none: 'No answer' };
  function resultTxt(e) {
    if (e.ok == null) return '';
    if (e.crit === 'nat20') return 'Critical success';
    if (e.crit === 'nat1') return 'Critical fail';
    return e.ok ? 'Success' : 'Fail';
  }
  function people() { return ranked().filter((p) => !p.bot); }

  function exportSummary() {
    const ps = people();
    const teams = teamList().length > 0;
    const cases = [...new Set(G.history.map((h) => h.caseTitle).filter(Boolean))];
    const rows = [
      ['Case Room results'],
      ['Exported', stamp(new Date())],
      ['Room', G.room || ''],
      ['Cases played', cases.join('; ') || (G.caseDef ? G.caseDef.title : '')],
      ['Registry topics', [...new Set((cases.length ? cases.map((t) => CASES.find((c) => c.title === t)) : [G.caseDef]).filter(Boolean).map((c) => folderName(c, ' (', ')')))].join('; ')],
      ['Last patient', G.finished ? (G.hp > 0 ? `Survived (${Math.round(G.hp)}/${G.hpMax} HP)` : `Crashed (0/${G.hpMax} HP)`) : `In progress (${Math.round(G.hp)}/${G.hpMax} HP)`],
      ['Players', ps.length],
      [],
      ['Rank', 'Name', 'Class', ...(teams ? ['Team'] : []), 'XP', 'Level', 'Title', 'Decisions answered', 'Best calls', 'Reasonable calls', 'Harmful calls', 'No answer', 'Checks passed', 'Checks rolled', 'Natural 20s', 'Natural 1s', 'Joined'],
    ];
    ps.forEach((p, i) => {
      const L = p.log || [];
      const dec = L.filter((e) => e.kind === 'Decision');
      const rolls = L.filter((e) => e.raw != null);
      const lv = R.levelFor(p.xp);
      const t = teamOf(p.team);
      rows.push([i + 1, p.name, R.CLASSES[p.cls].name, ...(teams ? [t ? t.name : ''] : []), p.xp, lv.level, lv.title,
        dec.filter((e) => e.grade !== 'none').length, dec.filter((e) => e.grade === 'best').length, dec.filter((e) => e.grade === 'ok').length,
        dec.filter((e) => e.grade === 'wrong').length, dec.filter((e) => e.grade === 'none').length,
        rolls.filter((e) => e.ok).length, rolls.length, rolls.filter((e) => e.crit === 'nat20').length, rolls.filter((e) => e.crit === 'nat1').length,
        stamp(new Date(p.joined))]);
    });
    if (teams) {
      rows.push([], ['Team', 'Rank', 'Members', 'Average XP', 'Total XP']);
      teamStandings().forEach((t, i) => rows.push([t.name, i + 1, t.members, t.avg, t.total]));
    }
    rows.push([], ['Party decisions'], ['Case', 'Step', 'Type', 'Party action', 'Grade', 'Result', 'DM ruling', 'Patient HP after']);
    for (const h of G.history) rows.push([h.caseTitle, h.title, h.kind, h.action, GRADE_TXT[h.grade] || '', h.ok == null ? '' : h.kind === 'Outcome' ? '' : h.ok ? 'Success' : 'Failure', h.forced ? 'Yes' : '', h.hp]);
    saveFile(`case-room-${G.room || 'room'}-${fileStamp()}-summary.csv`, toCsv(rows));
  }

  function exportLog() {
    const teams = teamList().length > 0;
    const rows = [['Name', 'Class', ...(teams ? ['Team'] : []), 'Case', 'Step', 'Type', 'Choice', 'Choice text', 'Grade', 'd20', 'Total', 'DC', 'Result', 'XP', 'Time']];
    for (const p of people()) {
      const t = teamOf(p.team);
      for (const e of p.log || []) {
        rows.push([p.name, R.CLASSES[p.cls].name, ...(teams ? [t ? t.name : ''] : []), e.caseTitle, e.title, e.kind, e.k, e.text, GRADE_TXT[e.grade] || '', e.raw, e.total, e.dc, resultTxt(e), e.xp, stamp(new Date(e.at))]);
      }
    }
    saveFile(`case-room-${G.room || 'room'}-${fileStamp()}-decisions.csv`, toCsv(rows));
  }

  function bindExport(root) {
    for (const b of $$('[data-export]', root)) b.onclick = () => (b.dataset.export === 'log' ? exportLog() : exportSummary());
  }

  /* ---------------- modals & keys ---------------- */

  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }

  function buildRollModal() {
    const m = $('#mRoll');
    m.innerHTML = `
      <div class="modal-card">
        <h2>Call for a roll</h2>
        <p class="muted">Everyone rolls on their phone. At least half must pass.</p>
        <div class="ab-grid">${R.AB_ORDER.map((ab) => `<button type="button" data-ab="${ab}"><b>${ab}</b><span>${esc(R.ABILITIES[ab].ems)}</span></button>`).join('')}</div>
        <div class="row"><span>DC</span><div class="seg" id="dcSeg">${[5, 8, 10, 12, 15, 18, 20].map((d) => `<button type="button" data-dc="${d}" class="${d === 12 ? 'on' : ''}">${d}</button>`).join('')}</div></div>
        <input id="rollText" placeholder="What are they attempting? (e.g., Carry him down the stairs)" maxlength="90">
        <div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="primary" id="btnCall">Roll!</button></div>
      </div>`;
    let ab = 'STR', dc = 12;
    const abBtns = $$('[data-ab]', m);
    abBtns[0].classList.add('on');
    abBtns.forEach((b) => { b.onclick = () => { ab = b.dataset.ab; abBtns.forEach((x) => x.classList.toggle('on', x === b)); }; });
    $$('[data-dc]', m).forEach((b) => { b.onclick = () => { dc = parseInt(b.dataset.dc, 10); $$('[data-dc]', m).forEach((x) => x.classList.toggle('on', x === b)); }; });
    $('[data-close]', m).onclick = () => closeModal('#mRoll');
    $('#btnCall').onclick = () => { closeModal('#mRoll'); startAdhoc(ab, dc, $('#rollText').value.trim()); $('#rollText').value = ''; };
  }

  // Remove a player for the rest of this game (their id is refused from now on)
  function kickPlayer(pid) {
    G.kicked.add(pid);
    G.players.delete(pid);
    if (G.ask) { G.ask.picks.delete(pid); G.ask.rolls.delete(pid); }
    viewKey = '';
    render();
    renderControls();
    renderBar();
    publish();
    scheduleSave();
  }
  function setLocked(on) {
    G.locked = !!on;
    if (G.phase === 'lobby') renderLobby();
    if (!$('#mSettings').hidden) buildSettingsModal();
    publish();
    scheduleSave();
  }
  function rosterHtml() {
    const list = ranked();
    if (!list.length) return '<p class="muted small">No one has joined yet.</p>';
    return `<div class="mini-roster">${list.map((p) => `
      <div class="mr" data-pid="${esc(p.pid)}"><span>${R.CLASSES[p.cls].icon}</span><b>${esc(p.name)}</b><span class="muted">${esc(R.CLASSES[p.cls].name)}${p.bot ? ' · bot' : ''} · ${p.xp} XP</span><button type="button" class="mr-x" title="Remove from the game">Remove</button></div>`).join('')}</div>`;
  }

  function buildSettingsModal() {
    const m = $('#mSettings');
    m.innerHTML = `
      <div class="modal-card">
        <h2>Settings</h2>
        <div class="settings">${settingsHtml()}</div>
        <p class="muted small">Join link: ${esc(G.room ? joinUrl() : 'open a room first')}</p>
        ${G.room ? `<div class="row"><span>New players</span><span class="seg"><button type="button" data-lock="0" class="${G.locked ? '' : 'on'}">Open</button><button type="button" data-lock="1" class="${G.locked ? 'on' : ''}">Locked</button></span></div>
        <details class="room-people"><summary>People in the room (${ranked().length})</summary>${rosterHtml()}</details>` : ''}
        ${people().length ? `<div class="row"><span>Export results</span><span class="exp-btns"><button type="button" class="ghost" data-export="summary">⬇ Summary (CSV)</button><button type="button" class="ghost" data-export="log">⬇ Decision log (CSV)</button></span></div>` : ''}
        <div class="modal-actions"><button type="button" class="primary" data-close>Done</button></div>
      </div>`;
    bindSettings(m);
    bindExport(m);
    for (const b of $$('[data-lock]', m)) b.onclick = () => setLocked(b.dataset.lock === '1');
    for (const b of $$('.mr-x', m)) {
      b.onclick = () => {
        const row = b.closest('.mr');
        kickPlayer(row.dataset.pid);
        const d = $('.room-people', m);
        buildSettingsModal();
        const d2 = $('.room-people', $('#mSettings'));
        if (d && d.open && d2) d2.open = true;
      };
    }
    $('[data-close]', m).onclick = () => closeModal('#mSettings');
  }

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea')) return;
      if (!$('#mRoll').hidden || !$('#mSettings').hidden) { if (e.key === 'Escape') { closeModal('#mRoll'); closeModal('#mSettings'); } return; }
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        if (G.phase === 'setup' || G.phase === 'final') return;
        e.preventDefault();
        if (e.repeat) return; // a held-down key or clicker button
        next();
      } else if (e.key === 'r' || e.key === 'R') { if (!$('#btnRoll').disabled && !$('#btnRoll').hidden) { buildRollModal(); openModal('#mRoll'); } }
      else if (e.key === 'f' || e.key === 'F') toggleFull();
      else if (e.key === 'm' || e.key === 'M') { G.settings.sound = !G.settings.sound; monitor.enableSound(G.settings.sound); }
    });
  }

  function toggleFull() {
    const d = document;
    if (d.fullscreenElement) d.exitFullscreen && d.exitFullscreen();
    else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => {});
  }

  async function keepAwake() {
    try { if (navigator.wakeLock) { G.wake = await navigator.wakeLock.request('screen'); } } catch (e) { /* not supported */ }
  }

  /* ---------------- boot ---------------- */
  function boot() {
    monitor = new window.CRMonitor.Monitor($('#monitor'), { showRhythm: G.settings.showRhythm });
    const hpEl = $('#hp');
    hpEl.innerHTML = '<span class="hp-l">♥ Patient</span><div class="hp-track"><div class="hp-fill"></div></div><span class="hp-num"></span>';
    $('#btnNext').onclick = () => next();
    $('#btnFull').onclick = toggleFull;
    $('#btnRoll').onclick = () => { buildRollModal(); openModal('#mRoll'); };
    $('#btnSettings').onclick = () => { buildSettingsModal(); openModal('#mSettings'); };
    for (const m of $$('.modal')) m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; });
    bindKeys();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
    keepAwake();
    render();
    setInterval(renderPeer, 2000);
    window.CRHost = { G, next, addBots, startAdhoc, closeChoice, closeRoll, exportSummary, exportLog, teamStandings, savedGame, resumeGame, makeOrder, applyOrder }; // handy for testing
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
