/* Case Room — player phone */
(function () {
  'use strict';
  const R = window.CRRules, N = window.CRNet;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => (typeof s === 'string' ? s : typeof s === 'number' && Number.isFinite(s) ? String(s) : '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const cleanName = (s) => (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);
  const GRADE = { best: ['Best call', '✓'], ok: ['Reasonable', '~'], wrong: ['Harmful call', '✗'] };

  const P = {
    room: cleanCode(params.get('r')),
    pid: null, name: '', cls: '', tok: null,
    relay: null, st: null, hid: null, seq: 0, lastAt: 0, startedAt: 0,
    picks: {}, rolls: {}, rolling: null, key: '', net: { ok: 0, total: 0, local: false },
  };

  // Saved per room code so a refresh puts you back in the game. Question ids include the host's game id,
  // so answers saved here can't be replayed into a later game on the same code.
  const ID_TTL = 12 * 3600 * 1000;
  const lsKey = () => 'caseroom-p-' + P.room;
  function loadId() { try { return JSON.parse(localStorage.getItem(lsKey()) || 'null'); } catch (e) { return null; } }
  function fresh(saved) { return !!(saved && Date.now() - (saved.t || 0) < ID_TTL); }
  function recent(o) {
    const ks = Object.keys(o || {});
    if (ks.length <= 40) return o || {};
    const out = {};
    for (const k of ks.slice(-40)) out[k] = o[k];
    return out;
  }
  function saveId() {
    P.picks = recent(P.picks);
    P.rolls = recent(P.rolls);
    try { localStorage.setItem(lsKey(), JSON.stringify({ pid: P.pid, tok: P.tok, name: P.name, cls: P.cls, picks: P.picks, rolls: P.rolls, t: Date.now() })); } catch (e) { /* ignore */ }
  }

  /* ---------------- join ---------------- */

  function showJoin(err) {
    $('#sMain').hidden = true;
    $('#sJoin').hidden = false;
    const code = $('#inCode');
    code.value = P.room || '';
    $('#inName').value = P.name || '';
    $('#joinErr').textContent = err || '';
    const pick = $('#clsPick');
    pick.innerHTML = R.CLASS_ORDER.map((k) => {
      const c = R.CLASSES[k];
      const top = R.AB_ORDER.filter((ab) => c.mods[ab] >= 2).map((ab) => `${ab} ${R.fmtMod(c.mods[ab])}`).join(' · ');
      return `<button type="button" class="cls ${P.cls === k ? 'on' : ''}" data-k="${k}"><span class="cls-i">${c.icon}</span><span class="cls-n">${esc(c.name)}</span><span class="cls-m">${esc(top)}</span><span class="cls-b">${esc(c.blurb)}</span></button>`;
    }).join('');
    for (const b of $$('.cls', pick)) b.onclick = () => { P.cls = b.dataset.k; $$('.cls', pick).forEach((x) => x.classList.toggle('on', x === b)); };
    (P.room ? $('#inName') : code).focus({ preventScroll: true });
  }

  function onJoinSubmit(e) {
    e.preventDefault();
    const room = cleanCode($('#inCode').value);
    const name = cleanName($('#inName').value);
    if (!room) return showJoinErr('Enter the room code from the big screen.');
    if (!name) return showJoinErr('Pick a name the class will recognize.');
    if (!P.cls) return showJoinErr('Choose your class.');
    if (room !== P.room) {
      P.room = room;
      const u = new URL(location.href);
      u.searchParams.set('r', room);
      history.replaceState(null, '', u.toString());
    }
    const prev = loadId();
    const keep = fresh(prev);
    P.pid = keep && prev.pid ? prev.pid : 'p-' + N.rid(10);
    // a secret only this phone and the DM screen know: it stops anyone else answering as you
    P.tok = keep && prev.tok && /^[A-Za-z0-9]{16,64}$/.test(prev.tok) && prev.pid === P.pid ? prev.tok : N.rid(24);
    P.picks = (keep && prev.picks) || {};
    P.rolls = (keep && prev.rolls) || {};
    P.name = name;
    saveId();
    enter();
  }
  function showJoinErr(t) { $('#joinErr').textContent = t; }

  function enter() {
    $('#sJoin').hidden = true;
    $('#sMain').hidden = false;
    P.startedAt = Date.now();
    connect();
    render();
    keepAwake();
  }

  /* ---------------- network ---------------- */

  function connect() {
    if (P.relay) P.relay.stop();
    P.relay = new N.Relay({
      room: P.room, role: 'player',
      onState,
      onStatus: (s) => { P.net = s; renderNet(); },
      onConnect: () => sendJoin(),
    }).start();
    sendJoin();
    clearInterval(P.hb);
    P.hb = setInterval(() => send({ t: 'hb' }), 15000);
    clearInterval(P.tick);
    P.tick = setInterval(renderDynamic, 250);
  }

  function send(m) {
    if (!P.relay) return;
    m.pid = P.pid;
    m.tok = P.tok;
    m.name = P.name;
    m.cls = P.cls;
    P.relay.send(m);
  }
  function sendJoin() { send({ t: 'join' }); }

  /* Everything from the relay is untrusted: anyone who knows the room code can publish to it.
     cleanState() rebuilds each message from scratch, keeping only expected fields with checked types,
     so nothing from the network reaches the page unchecked. Team names and colors come from our own list. */
  const KEY = /^[A-H]$/;
  const SID = /^[A-Za-z0-9_.-]{1,64}$/;
  const PID = /^(p|bot)-[A-Za-z0-9]{4,24}$/;
  const PHASES = ['setup', 'lobby', 'scene', 'choose', 'roll', 'reveal', 'rollReveal', 'board', 'final'];
  const GRADES = ['best', 'ok', 'wrong'];
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const int = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d);
  const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  const pids = (v) => arr(v, 400).filter((x) => typeof x === 'string' && PID.test(x));
  const ab = (v) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(R.ABILITIES, v) ? v : null);
  const die = (v) => Number.isInteger(v) && v >= 1 && v <= 20;
  const ownKeys = (o, max) => (isObj(o) ? Object.keys(o).slice(0, max) : []);
  function cleanState(m) {
    if (!isObj(m) || m.app !== 'caseroom' || m.room !== P.room) return null;
    const now = Date.now();
    const ts = int(m.ts, 0, 8.64e15, 0);
    if (!ts || ts > now + 10 * 60 * 1000 || now - ts > 6 * 3600 * 1000) return null; // stale, or from the future
    const hid = str(m.hid, 64);
    if (!SID.test(hid)) return null;
    const phase = PHASES.includes(m.phase) ? m.phase : 'setup';
    const s = {
      hid, ts, seq: int(m.seq, 0, 1e12, 0), phase,
      title: str(m.title, 200), dice: m.dice === true, locked: m.locked === true, n: int(m.n, 0, 100000, 0),
      kicked: pids(m.kicked), insp: pids(m.insp), got: pids(m.got), rolled: pids(m.rolled),
      step: isObj(m.step) ? { id: str(m.step.id, 64), title: str(m.step.title, 200), text: str(m.step.text, 5000) } : null,
      hp: Array.isArray(m.hp) ? [int(m.hp[0], -999, 999, 0), int(m.hp[1], 1, 999, 100)] : null,
      vit: isObj(m.vit) ? { hr: int(m.vit.hr, 0, 400, 0), bp: typeof m.vit.bp === 'string' && /^\d{1,3}\/\d{1,3}$/.test(m.vit.bp) ? m.vit.bp : '', spo2: int(m.vit.spo2, 0, 100, 0) } : null,
      xp: Object.create(null), teams: [], ask: null, rv: Object.create(null), res: null, fin: null,
    };
    for (const k of ownKeys(m.xp, 2000)) {
      const x = m.xp[k];
      if (!PID.test(k) || !Array.isArray(x)) continue;
      const team = R.TEAMS.find((t) => t.id === x[4]);
      s.xp[k] = [int(x[0], -1e7, 1e7, 0), int(x[1], 1, 100000, 1), int(x[2], 1, 99, 1), int(x[3], -1e7, 1e7, 0), team ? team.id : ''];
    }
    for (const t of arr(m.teams, 8)) {
      const def = Array.isArray(t) && R.TEAMS.find((x) => x.id === t[0]);
      if (def) s.teams.push([def.id, def.name, def.color, int(t[3], -1e7, 1e7, 0), int(t[4], 0, 100000, 0)]);
    }
    if (isObj(m.ask) && (phase === 'choose' || phase === 'roll')) {
      const a = m.ask;
      const kind = a.kind === 'choice' ? 'choice' : a.kind === 'roll' ? 'roll' : null;
      const sid = str(a.sid, 64);
      if (kind && SID.test(sid)) {
        s.ask = {
          sid, kind, title: str(a.title, 200), prompt: str(a.prompt, 3000),
          options: kind === 'choice' ? arr(a.options, 8).filter((o) => isObj(o) && typeof o.k === 'string' && KEY.test(o.k)).map((o) => ({ k: o.k, t: str(o.t, 500), ab: ab(o.ab) || 'INT' })) : null,
          ab: kind === 'roll' ? ab(a.ab) || 'WIS' : null,
          rem: a.rem == null ? null : int(a.rem, 0, 3600000, 0),
          dur: a.dur == null ? null : int(a.dur, 1, 3600000, null),
        };
        for (const k of ownKeys(m.rv, 2000)) {
          const d = arr(m.rv[k], 2).filter(die);
          if (PID.test(k) && d.length) s.rv[k] = d;
        }
      }
    }
    if (isObj(m.res) && (phase === 'reveal' || phase === 'rollReveal')) {
      const r = m.res;
      const per = Object.create(null);
      for (const k of ownKeys(r.per, 2000)) {
        const x = r.per[k];
        if (!PID.test(k) || !Array.isArray(x)) continue;
        per[k] = [typeof x[0] === 'string' && KEY.test(x[0]) ? x[0] : '', die(x[1]) ? x[1] : null, int(x[2], -99, 99, 0), int(x[3], -99, 999, 0), x[4] ? 1 : 0,
          x[5] === 20 ? 20 : x[5] === 1 ? 1 : 0, int(x[6], -1e6, 1e6, 0), GRADES.includes(x[7]) ? x[7] : '', ab(x[8]) || '', int(x[9], 0, 99, 0)];
      }
      const pa = isObj(r.party) ? r.party : null;
      s.res = {
        sid: str(r.sid, 64), kind: r.kind === 'choice' ? 'choice' : 'roll',
        best: arr(r.best, 8).filter((k) => typeof k === 'string' && KEY.test(k)),
        party: pa ? { k: typeof pa.k === 'string' && KEY.test(pa.k) ? pa.k : null, ok: !!pa.ok, passed: int(pa.passed, 0, 100000, 0), total: int(pa.total, 0, 100000, 0), dc: int(pa.dc, 0, 99, 0) } : null,
        partyText: str(r.partyText, 500), note: str(r.note, 3000), hp: int(r.hp, -999, 999, 0), per,
      };
    }
    if (phase === 'final' && isObj(m.fin)) s.fin = { win: !!m.fin.win };
    return s;
  }

  function onState(raw) {
    const m = cleanState(raw);
    if (!m) return;
    const quiet = Date.now() - P.lastAt > 8000; // our DM screen has gone quiet: accept whoever is alive
    if (m.hid !== P.hid) {
      if (P.st && m.ts < P.st.ts - 5000 && !quiet) return; // an older host session
      P.hid = m.hid;
      P.seq = 0;
      sendJoin();
    }
    if (m.seq <= P.seq && !quiet) return;
    P.seq = m.seq;
    P.st = m;
    P.lastAt = Date.now();
    if (m.ask && m.ask.rem != null) m.ask.deadline = Date.now() + m.ask.rem;
    // the host lost us (it restarted): say hello again
    if (m.phase !== 'setup' && !m.xp[P.pid] && !m.kicked.includes(P.pid) && Date.now() - (P.lastJoinAt || 0) > 4000) {
      P.lastJoinAt = Date.now();
      sendJoin();
      const a = m.ask;
      if (a && P.picks[a.sid]) send({ t: 'pick', sid: a.sid, k: P.picks[a.sid] });
      if (a && P.rolling === a.sid) send({ t: 'roll', sid: a.sid });
    }
    render();
  }

  /* ---------------- rendering ---------------- */

  function me() {
    const s = P.st;
    const x = s && s.xp && s.xp[P.pid];
    return { xp: x ? x[0] : 0, rank: x ? x[1] : null, level: x ? x[2] : 1, last: x ? x[3] : 0, team: x ? x[4] || '' : '', n: s ? s.n : 0 };
  }

  // [id, name, color, avgXp, members] in standings order
  function myTeam() {
    const s = P.st, m = me();
    if (!s || !s.teams || !s.teams.length || !m.team) return null;
    const i = s.teams.findIndex((t) => t[0] === m.team);
    if (i < 0) return null;
    const t = s.teams[i];
    return { id: t[0], name: t[1], color: t[2], avg: t[3], members: t[4], rank: i + 1, of: s.teams.length };
  }
  function teamBadge(t) { return t ? `<span class="tbadge" style="--tc:${t.color}">${esc(t.name)}</span>` : ''; }

  function render() {
    const s = P.st;
    const c = R.CLASSES[P.cls] || R.CLASSES.emt;
    $('.ph-room').textContent = P.room;
    $('.ph-me').innerHTML = `${c.icon} <b>${esc(P.name)}</b> ${teamBadge(myTeam())}`;
    const m = me();
    $('.ph-xp').textContent = s && s.phase !== 'setup' ? `Lv ${m.level} · ${m.xp} XP` : '';

    if (s && P.rolling && (!s.ask || s.ask.sid !== P.rolling)) { clearInterval(P.rollIv); P.rolling = null; } // the vote moved on
    if (s && (s.kicked || []).includes(P.pid)) return setContent('kicked', `<div class="card center"><h2>You've been removed</h2><p class="muted">The DM removed you from room ${esc(P.room)}.</p></div>`);
    if (!s) {
      const late = Date.now() - P.startedAt > 9000;
      return setContent('wait' + late, `<div class="card center"><div class="spin">${R.d20Svg('')}</div><h2>Looking for room ${esc(P.room)}…</h2>${late ? `<p class="muted">Make sure the DM's screen is open and the code is right.</p><button type="button" class="ghost" id="btnRecode">Change room code</button>` : ''}</div>`, () => {
        const b = $('#btnRecode');
        if (b) b.onclick = () => { if (P.relay) P.relay.stop(); P.relay = null; P.room = ''; showJoin(); };
      });
    }

    if (s.locked && !s.xp[P.pid]) return setContent('locked', `<div class="card center"><h2>This room is locked</h2><p class="muted">The DM has closed room ${esc(P.room)} to new players. Ask them to unlock it.</p></div>`);
    const ph = s.phase;
    const a = s.ask;
    if (ph === 'setup') return setContent('setup', `<div class="card center"><div class="spin">${R.d20Svg('')}</div><h2>The DM is setting up</h2><p class="muted">Hang tight.</p></div>`);
    if (ph === 'lobby') {
      const teams = s.teams || [];
      const mt = myTeam();
      const picker = teams.length ? `<div class="card"><div class="kicker">Your team</div><div class="team-pick">${teams.slice().sort((a, b) => a[0].localeCompare(b[0])).map((t) => `<button type="button" class="tp ${mt && mt.id === t[0] ? 'on' : ''}" data-team="${esc(t[0])}" style="--tc:${t[2]}"><b>${esc(t[1])}</b><span>${t[4]} ${t[4] === 1 ? 'member' : 'members'}</span></button>`).join('')}</div><p class="muted small">Tap to switch teams before the game starts.</p></div>` : '';
      return setContent('lobby' + P.cls + P.name + JSON.stringify(teams.map((t) => [t[0], t[4]])) + (mt ? mt.id : ''), sheet() + picker + `<p class="muted center">You're in. Watch the big screen for the adventure to begin.</p>`, () => {
        for (const b of $$('.tp')) b.onclick = () => { send({ t: 'team', team: b.dataset.team }); buzz(10); $$('.tp').forEach((x) => x.classList.toggle('on', x === b)); };
      });
    }
    if (ph === 'scene') {
      const stp = s.step || { id: '', title: '', text: '' };
      return setContent('scene' + stp.id, `<div class="card"><div class="kicker">Scene · ${esc(stp.title)}</div><p class="story">${esc(stp.text)}</p></div><p class="muted center">Listen to the DM.</p>`);
    }
    if ((ph === 'choose' || ph === 'roll') && a) {
      const picked = KEY.test(P.picks[a.sid] || '') ? P.picks[a.sid] : undefined;
      const dice = myDice(a);
      if (a.kind === 'choice' && !picked) return renderOptions(a);
      if (P.rolling === a.sid) return; // the die is tumbling: let it land
      if (s.dice && !dice) {
        const abl = a.kind === 'choice' ? (a.options.find((o) => o.k === picked) || {}).ab : a.ab;
        return renderRoll(a, abl, picked);
      }
      return renderWaiting(a, picked, dice);
    }
    if ((ph === 'reveal' || ph === 'rollReveal') && s.res) return renderResult(s.res);
    if (ph === 'board') return renderStanding();
    if (ph === 'final') return renderFinal();
    return setContent('idle' + ph, `<div class="card center"><p class="muted">Watch the big screen.</p></div>`);
  }

  function setContent(key, html, after) {
    if (P.key === key) { renderDynamic(); return; }
    P.key = key;
    $('#content').innerHTML = html;
    if (after) after();
    renderDynamic();
  }

  function sheet() {
    const c = R.CLASSES[P.cls] || R.CLASSES.emt;
    const m = me();
    const lv = R.levelFor(m.xp);
    return `<div class="card sheet">
      <div class="sheet-h"><span class="sheet-i">${c.icon}</span><div><h2>${esc(P.name)}</h2><div class="muted">${esc(c.name)} · Level ${lv.level} ${esc(lv.title)}</div></div></div>
      <div class="abs">${R.AB_ORDER.map((ab) => `<div class="ab ${c.mods[ab] >= 2 ? 'hi' : ''}"><b>${ab}</b><span>${R.fmtMod(c.mods[ab])}</span><i>${esc(R.ABILITIES[ab].ems)}</i></div>`).join('')}</div>
      <p class="muted small">${esc(c.blurb)}</p>
    </div>`;
  }

  function timerBar() { return '<div class="timer"><div class="fill" id="tFill"></div></div>'; }

  function renderOptions(a) {
    setContent('opts' + a.sid, `
      <div class="q"><div class="kicker">${esc(a.title || 'Decision')}</div><p class="prompt">${esc(a.prompt)}</p></div>
      ${timerBar()}
      <div class="opts">${a.options.map((o) => `<button type="button" class="opt k${o.k}" data-k="${o.k}"><span class="key">${o.k}</span><span class="txt">${esc(o.t)}</span></button>`).join('')}</div>`,
    () => {
      for (const b of $$('.opt')) {
        b.onclick = () => {
          if (P.picks[a.sid]) return;
          P.picks[a.sid] = b.dataset.k;
          saveId();
          send({ t: 'pick', sid: a.sid, k: b.dataset.k });
          buzz(15);
          render();
        };
      }
    });
  }

  function renderRoll(a, ab, picked) {
    const c = R.CLASSES[P.cls] || R.CLASSES.emt;
    const mod = c.mods[ab] || 0;
    const insp = (P.st.insp || []).includes(P.pid);
    const pickedTxt = picked ? (a.options.find((o) => o.k === picked) || {}).t : '';
    setContent('roll' + a.sid + insp, `
      ${picked ? `<div class="mine k${picked}"><span class="key">${picked}</span><span>${esc(pickedTxt)}</span></div>` : `<div class="q"><div class="kicker">${esc(a.title || 'Group check')}</div><p class="prompt">${esc(a.prompt)}</p></div>`}
      ${timerBar()}
      <div class="roller">
        <div class="ab-call">${esc(R.ABILITIES[ab].name)} check <b>${R.fmtMod(mod)}</b></div>
        <div class="muted small">${esc(R.ABILITIES[ab].ems)} · ${esc(c.name)} bonus</div>
        ${insp ? '<div class="insp">✨ Inspired: you roll with advantage</div>' : ''}
        <button type="button" class="die-btn" id="btnRoll">${R.d20Svg(20)}${insp ? R.d20Svg(20) : ''}</button>
        <div class="tap">Tap to roll</div>
      </div>`,
    () => {
      $('#btnRoll').onclick = () => doRoll(a);
    });
  }

  // The DM screen rolls the dice (so nobody can fake a natural 20). The phone asks, tumbles, and lands on
  // whatever the DM screen rolled.
  function myDice(a) {
    const s = P.st;
    return s && a && s.ask && s.ask.sid === a.sid && s.rolled.includes(P.pid) && s.rv[P.pid] ? s.rv[P.pid] : null;
  }
  function doRoll(a) {
    if (P.rolling || myDice(a)) return;
    P.rolling = a.sid;
    P.rollAt = Date.now();
    P.lastRollSend = Date.now();
    send({ t: 'roll', sid: a.sid });
    const btn = $('#btnRoll');
    btn.classList.add('rolling');
    $('.tap').textContent = 'Rolling…';
    const faces = $$('.d20 text', btn);
    clearInterval(P.rollIv);
    P.rollIv = setInterval(() => {
      faces.forEach((f) => { f.textContent = 1 + Math.floor(Math.random() * 20); });
      if (Date.now() - P.lastRollSend > 3500) { P.lastRollSend = Date.now(); send({ t: 'roll', sid: a.sid }); } // no answer yet: ask again
      const d = myDice(a);
      if (!d || Date.now() - P.rollAt < 900) return;
      clearInterval(P.rollIv);
      faces.forEach((f, i) => { if (d[i] != null) f.textContent = d[i]; });
      btn.classList.remove('rolling');
      P.rolls[a.sid] = d;
      P.rolling = null;
      saveId();
      const kept = d.length > 1 ? Math.max(d[0], d[1]) : d[0];
      buzz(kept === 20 ? [40, 40, 90] : kept === 1 ? [220] : 20);
      setTimeout(render, 900);
    }, 70);
  }

  function rollLine(dice, mod, insp) {
    const kept = insp && dice.length > 1 ? Math.max(dice[0], dice[1]) : dice[0];
    const crit = kept === 20 ? '<div class="crit">NATURAL 20!</div>' : kept === 1 ? '<div class="fumble">Natural 1…</div>' : '';
    return `<div class="rolled">
      <div class="rolled-dice">${dice.map((d) => `<span class="${d === kept ? 'kept' : 'drop'}">${R.d20Svg(d, d === 20 ? { fill: '#3a2c0a', stroke: '#f2c96b' } : d === 1 ? { fill: '#3a0d12', stroke: '#ff5d6c' } : {})}</span>`).join('')}</div>
      ${crit}
      <div class="rolled-t">${kept} ${R.fmtMod(mod)} = <b>${kept + mod}</b></div>
      <div class="muted small">The DM reveals the difficulty on the big screen.</div>
    </div>`;
  }

  function renderWaiting(a, picked, rolled) {
    const c = R.CLASSES[P.cls] || R.CLASSES.emt;
    const ab = a.kind === 'choice' ? (a.options.find((o) => o.k === picked) || {}).ab : a.ab;
    const mod = ab ? c.mods[ab] || 0 : 0;
    const pickedTxt = picked ? (a.options.find((o) => o.k === picked) || {}).t : '';
    setContent('wait' + a.sid + !!rolled, `
      ${picked ? `<div class="mine k${picked}"><span class="key">${picked}</span><span>${esc(pickedTxt)}</span></div>` : ''}
      ${timerBar()}
      ${rolled ? rollLine(rolled, mod, rolled.length > 1) : ''}
      <div class="card center"><p class="ack" id="ack">Sending…</p><p class="muted">Waiting for the rest of the party.</p></div>`);
  }

  function renderResult(res) {
    const c = R.CLASSES[P.cls] || R.CLASSES.emt;
    const x = res.per && res.per[P.pid];
    const party = res.party || {};
    let mine;
    if (!x) {
      mine = `<div class="card"><p class="muted">${res.kind === 'choice' ? 'You didn\'t choose in time.' : 'You sat this one out.'}</p></div>`;
    } else {
      const [k, raw, bonus, total, ok, crit, xp, grade, ab, dc] = x;
      const g = GRADE[grade];
      const judg = raw != null && ab ? bonus - (c.mods[ab] || 0) : 0;
      const verdict = ok ? (crit === 20 ? 'Critical success' : 'Success') : (crit === 1 ? 'Critical fail' : 'Fail');
      const harmNote = res.kind === 'choice' && grade === 'wrong' && raw != null
        ? `<div class="muted small">${ok ? 'You pulled it off. That\'s the problem.' : 'You fumbled it. Lucky for the patient.'}</div>` : '';
      const tone = res.kind === 'choice' ? ({ best: 'pass', ok: 'meh', wrong: 'miss' }[grade] || 'meh') : ok ? 'pass' : 'miss';
      mine = `<div class="card result ${tone}">
        ${res.kind === 'choice' ? `<div class="res-call g-${grade}"><span class="key k${k}">${k}</span><span>${g ? g[1] + ' ' + g[0] : ''}</span></div>` : ''}
        ${raw != null ? `<div class="res-roll">${R.d20Svg(raw, crit === 20 ? { fill: '#3a2c0a', stroke: '#f2c96b' } : crit === 1 ? { fill: '#3a0d12', stroke: '#ff5d6c' } : {})}
          <div><div class="res-v">${verdict}</div>
          <div class="muted small">${raw} ${R.fmtMod(bonus)}${judg > 0 ? ` (incl. +${judg} for a sound call)` : ''} = ${total} vs DC ${dc}</div>${harmNote}</div></div>` : ''}
        <div class="res-xp">${xp > 0 ? '+' + xp + ' XP' : '+0 XP'}</div>
      </div>`;
    }
    const best = res.best && res.best.length ? `<p class="muted small center">Best call: ${res.best.join(', ')}</p>` : '';
    setContent('res' + res.sid + (party.k || '') + party.ok + (x ? x[6] : ''), `
      ${mine}
      <div class="card party ${party.ok ? 'pass' : 'miss'} hp-${res.hp < 0 ? 'down' : res.hp > 0 ? 'up' : 'flat'}">
        <div class="kicker">${res.kind === 'choice' ? 'The party' : 'Group check'}${res.hp ? `<span class="php ${res.hp > 0 ? 'up' : 'down'}">${res.hp > 0 ? '+' : ''}${res.hp} HP</span>` : ''}</div>
        ${res.partyText ? `<div class="party-a"><span class="key k${party.k}">${party.k}</span> ${esc(res.partyText)}</div>` : ''}
        <div class="party-v">${party.ok ? 'SUCCESS' : 'FAILURE'}${party.total ? ` <small>${party.passed}/${party.total} passed · DC ${party.dc}</small>` : ''}</div>
        ${res.note ? `<p>${esc(res.note)}</p>` : ''}
      </div>
      ${best}`);
  }
  function renderStanding() {
    const m = me();
    const lv = R.levelFor(m.xp);
    const pct = lv.next ? Math.round((100 * (m.xp - lv.floor)) / (lv.next - lv.floor)) : 100;
    const insp = (P.st.insp || []).includes(P.pid);
    const tk = myTeam();
    setContent('board' + m.xp + m.rank + insp + (tk ? tk.rank + '-' + tk.avg : ''), `
      <div class="card center standing">
        <div class="kicker">Party standings</div>
        <div class="rank">${m.rank ? '#' + m.rank : '—'}<small>of ${m.n}</small></div>
        <div class="xp">${m.xp} XP ${m.last ? `<span class="up">+${m.last}</span>` : ''}</div>
        <div class="lv">Level ${lv.level} · ${esc(lv.title)}</div>
        <div class="lvbar"><div style="width:${pct}%"></div></div>
        ${insp ? '<div class="insp">✨ The DM granted you Inspiration. Advantage on your next roll.</div>' : ''}
      </div>
      ${teamCard()}`);
  }

  function teamCard() {
    const t = myTeam();
    if (!t) return '';
    return `<div class="card center team-card" style="--tc:${t.color}"><div class="kicker">Your team</div><div class="team-rank">${esc(t.name)} · #${t.rank} of ${t.of}</div><div class="muted">${t.avg} average XP · ${t.members} ${t.members === 1 ? 'member' : 'members'}</div></div>`;
  }

  function renderFinal() {
    const m = me();
    const lv = R.levelFor(m.xp);
    const win = P.st.fin && P.st.fin.win;
    setContent('final' + m.xp + win, `
      <div class="card center fate ${win ? 'win' : 'lose'}"><h2>${win ? 'The patient survived' : 'The patient crashed'}</h2><p class="muted">${esc(P.st.title || '')}</p></div>
      <div class="card center standing">
        <div class="rank">${m.rank ? '#' + m.rank : '—'}<small>of ${m.n}</small></div>
        <div class="xp">${m.xp} XP</div>
        <div class="lv">Level ${lv.level} · ${esc(lv.title)}</div>
      </div>
      ${teamCard()}
      <p class="muted center">Thanks for playing. Watch the big screen for the debrief.</p>`);
  }

  function renderDynamic() {
    const s = P.st;
    // status strip: patient HP + vitals
    const stEl = $('#status');
    if (s && s.hp && !['setup', 'lobby'].includes(s.phase)) {
      const [hp, max] = s.hp;
      const pct = max ? Math.round((100 * hp) / max) : 0;
      const v = s.vit;
      const html = `<span class="hp ${pct <= 30 ? 'low' : ''}">♥ <b>${hp}</b>/${max}<i style="width:${pct}%"></i></span>${v ? `<span>HR <b>${v.hr}</b></span>${v.bp ? `<span>BP <b>${esc(v.bp)}</b></span>` : ''}<span>SpO₂ <b>${v.spo2}</b></span>` : ''}`;
      if (stEl.dataset.h !== html) { stEl.innerHTML = html; stEl.dataset.h = html; }
      stEl.hidden = false;
    } else stEl.hidden = true;

    const a = s && s.ask;
    const fill = $('#tFill');
    if (fill && a) {
      if (a.dur && a.deadline) {
        const p = Math.max(0, Math.min(1, (a.deadline - Date.now()) / a.dur));
        fill.style.width = (p * 100).toFixed(1) + '%';
        fill.classList.toggle('low', p < 0.2);
      } else fill.style.width = '100%';
    }
    const ack = $('#ack');
    if (ack && a && s) {
      const got = (s.got || []).includes(P.pid) || a.kind === 'roll';
      const rolled = (s.rolled || []).includes(P.pid);
      ack.textContent = s.dice ? (rolled ? '✓ The DM has your roll' : got ? '✓ Choice received · sending roll…' : 'Sending…') : got ? '✓ Choice received' : 'Sending…';
      ack.classList.toggle('ok', s.dice ? rolled : got);
      // resend if the host hasn't acknowledged within a few seconds
      if (!(s.dice ? rolled : got) && Date.now() - (P.lastResend || 0) > 3500) {
        P.lastResend = Date.now();
        if (P.picks[a.sid]) send({ t: 'pick', sid: a.sid, k: P.picks[a.sid] });
      }
    }
    if (!s) { const late = Date.now() - P.startedAt > 9000; if (late && P.key === 'waitfalse') render(); }
  }

  function renderNet() {
    const n = P.net;
    const dot = $('#netDot');
    const ok = n.ok > 0;
    dot.className = 'dot ' + (ok ? 'ok' : n.local ? 'warn' : 'bad');
    $('#netTxt').textContent = ok ? `Connected · ${n.ok}/${n.total} relays` : n.total ? 'Connecting…' : 'Local only';
  }

  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }
  async function keepAwake() { try { if (navigator.wakeLock) P.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } }

  /* ---------------- boot ---------------- */
  function boot() {
    $('#fJoin').addEventListener('submit', onJoinSubmit);
    $('#btnLeave').onclick = () => {
      if (P.relay) P.relay.stop();
      P.relay = null;
      try { localStorage.removeItem(lsKey()); } catch (e) { /* ignore */ }
      P.pid = null; P.st = null; P.hid = null; P.seq = 0; P.key = '';
      showJoin();
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); if (P.pid) sendJoin(); } });
    const saved = P.room ? loadId() : null;
    if (saved && saved.pid && saved.name && saved.cls && fresh(saved)) {
      Object.assign(P, { pid: saved.pid, name: saved.name, cls: saved.cls, picks: saved.picks || {}, rolls: saved.rolls || {}, tok: /^[A-Za-z0-9]{16,64}$/.test(saved.tok || '') ? saved.tok : N.rid(24) });
      saveId();
      enter();
    } else {
      // a day-old visit to a reused room code: start fresh, but keep the name and class filled in
      if (saved) { P.name = saved.name || ''; P.cls = R.CLASSES[saved.cls] ? saved.cls : ''; }
      showJoin();
    }
    window.CRPlayer = P;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
