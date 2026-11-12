/* Case Room — player phone */
(function () {
  'use strict';
  const R = window.CRRules, N = window.CRNet;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);
  const GRADE = { best: ['Best call', '✓'], ok: ['Reasonable', '~'], wrong: ['Harmful call', '✗'] };

  const P = {
    room: cleanCode(params.get('r')),
    pid: null, name: '', cls: '',
    relay: null, st: null, hid: null, seq: 0, lastAt: 0, startedAt: 0,
    picks: {}, rolls: {}, rolling: false, key: '', net: { ok: 0, total: 0, local: false },
  };

  const lsKey = () => 'caseroom-p-' + P.room;
  function loadId() { try { return JSON.parse(localStorage.getItem(lsKey()) || 'null'); } catch (e) { return null; } }
  function saveId() {
    try { localStorage.setItem(lsKey(), JSON.stringify({ pid: P.pid, name: P.name, cls: P.cls, picks: P.picks, rolls: P.rolls, t: Date.now() })); } catch (e) { /* ignore */ }
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
    P.pid = prev && prev.pid ? prev.pid : 'p-' + N.rid(10);
    P.picks = (prev && prev.picks) || {};
    P.rolls = (prev && prev.rolls) || {};
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
    m.name = P.name;
    m.cls = P.cls;
    P.relay.send(m);
  }
  function sendJoin() { send({ t: 'join' }); }

  function onState(m) {
    if (!m || m.app !== 'caseroom' || m.room !== P.room) return;
    if (Date.now() - m.ts > 6 * 3600 * 1000) return;
    if (m.hid !== P.hid) {
      if (P.st && m.ts < P.st.ts - 5000) return; // an older host session
      P.hid = m.hid;
      P.seq = 0;
      sendJoin();
    }
    if (m.seq <= P.seq) return;
    P.seq = m.seq;
    P.st = m;
    P.lastAt = Date.now();
    if (m.ask && m.ask.rem != null) m.ask.deadline = Date.now() + m.ask.rem;
    // the host lost us (it restarted): say hello again
    if (m.phase !== 'setup' && m.xp && !m.xp[P.pid] && !(m.kicked || []).includes(P.pid) && Date.now() - (P.lastJoinAt || 0) > 4000) {
      P.lastJoinAt = Date.now();
      sendJoin();
      const a = m.ask;
      if (a && P.picks[a.sid]) send({ t: 'pick', sid: a.sid, k: P.picks[a.sid] });
      if (a && P.rolls[a.sid]) send({ t: 'roll', sid: a.sid, d: P.rolls[a.sid] });
    }
    render();
  }

  /* ---------------- rendering ---------------- */

  function me() {
    const s = P.st;
    const x = s && s.xp && s.xp[P.pid];
    return { xp: x ? x[0] : 0, rank: x ? x[1] : null, level: x ? x[2] : 1, last: x ? x[3] : 0, n: s ? s.n : 0 };
  }

  function render() {
    const s = P.st;
    const c = R.CLASSES[P.cls] || R.CLASSES.emt;
    $('.ph-room').textContent = P.room;
    $('.ph-me').innerHTML = `${c.icon} <b>${esc(P.name)}</b>`;
    const m = me();
    $('.ph-xp').textContent = s && s.phase !== 'setup' ? `Lv ${m.level} · ${m.xp} XP` : '';

    if (s && (s.kicked || []).includes(P.pid)) return setContent('kicked', `<div class="card center"><h2>You've been removed</h2><p class="muted">The DM removed you from room ${esc(P.room)}.</p></div>`);
    if (!s) {
      const late = Date.now() - P.startedAt > 9000;
      return setContent('wait' + late, `<div class="card center"><div class="spin">${R.d20Svg('')}</div><h2>Looking for room ${esc(P.room)}…</h2>${late ? `<p class="muted">Make sure the DM's screen is open and the code is right.</p><button type="button" class="ghost" id="btnRecode">Change room code</button>` : ''}</div>`, () => {
        const b = $('#btnRecode');
        if (b) b.onclick = () => { if (P.relay) P.relay.stop(); P.relay = null; P.room = ''; showJoin(); };
      });
    }

    const ph = s.phase;
    const a = s.ask;
    if (ph === 'setup') return setContent('setup', `<div class="card center"><div class="spin">${R.d20Svg('')}</div><h2>The DM is setting up</h2><p class="muted">Hang tight.</p></div>`);
    if (ph === 'lobby') return setContent('lobby' + P.cls + P.name, sheet() + `<p class="muted center">You're in. Watch the big screen for the adventure to begin.</p>`);
    if (ph === 'scene') {
      return setContent('scene' + (s.step && s.step.id), `<div class="card"><div class="kicker">Scene · ${esc(s.step.title)}</div><p class="story">${esc(s.step.text || '')}</p></div><p class="muted center">Listen to the DM.</p>`);
    }
    if ((ph === 'choose' || ph === 'roll') && a) {
      const picked = P.picks[a.sid];
      const rolled = P.rolls[a.sid];
      if (a.kind === 'choice' && !picked) return renderOptions(a);
      if (s.dice && !rolled) {
        const ab = a.kind === 'choice' ? (a.options.find((o) => o.k === picked) || {}).ab : a.ab;
        return renderRoll(a, ab, picked);
      }
      return renderWaiting(a, picked, rolled);
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
      $('#btnRoll').onclick = () => doRoll(a, ab, mod, insp);
    });
  }

  function doRoll(a, ab, mod, insp) {
    if (P.rolling || P.rolls[a.sid]) return;
    P.rolling = true;
    const btn = $('#btnRoll');
    btn.classList.add('rolling');
    $('.tap').textContent = 'Rolling…';
    const dice = insp ? [R.d20(), R.d20()] : [R.d20()];
    const faces = $$('.d20 text', btn);
    let n = 0;
    const iv = setInterval(() => {
      faces.forEach((f) => { f.textContent = 1 + Math.floor(Math.random() * 20); });
      if (++n > 13) {
        clearInterval(iv);
        faces.forEach((f, i) => { f.textContent = dice[i]; });
        btn.classList.remove('rolling');
        P.rolls[a.sid] = dice;
        P.rolling = false;
        saveId();
        send({ t: 'roll', sid: a.sid, d: dice });
        const kept = insp ? Math.max(dice[0], dice[1]) : dice[0];
        buzz(kept === 20 ? [40, 40, 90] : kept === 1 ? [220] : 20);
        setTimeout(render, 900);
      }
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
    setContent('board' + m.xp + m.rank + insp, `
      <div class="card center standing">
        <div class="kicker">Party standings</div>
        <div class="rank">${m.rank ? '#' + m.rank : '—'}<small>of ${m.n}</small></div>
        <div class="xp">${m.xp} XP ${m.last ? `<span class="up">+${m.last}</span>` : ''}</div>
        <div class="lv">Level ${lv.level} · ${esc(lv.title)}</div>
        <div class="lvbar"><div style="width:${pct}%"></div></div>
        ${insp ? '<div class="insp">✨ The DM granted you Inspiration. Advantage on your next roll.</div>' : ''}
      </div>`);
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
        if (P.rolls[a.sid]) send({ t: 'roll', sid: a.sid, d: P.rolls[a.sid] });
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
    if (saved && saved.pid && saved.name && saved.cls) {
      Object.assign(P, { pid: saved.pid, name: saved.name, cls: saved.cls, picks: saved.picks || {}, rolls: saved.rolls || {} });
      enter();
    } else {
      showJoin();
    }
    window.CRPlayer = P;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
