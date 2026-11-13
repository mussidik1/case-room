/* Case Room — Dungeon Master rules: classes, abilities, d20 checks, XP, levels */
(function (root) {
  'use strict';

  const ABILITIES = {
    STR: { name: 'Strength', ems: 'lifting, CPR, extrication' },
    DEX: { name: 'Dexterity', ems: 'IVs, leads, procedures' },
    CON: { name: 'Constitution', ems: 'stamina on long calls' },
    INT: { name: 'Intelligence', ems: 'pharmacology, ECGs' },
    WIS: { name: 'Wisdom', ems: 'assessment, judgment' },
    CHA: { name: 'Charisma', ems: 'patients, families, radio' },
  };
  const AB_ORDER = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

  // Every class gets the same +6 budget, spread differently.
  const CLASSES = {
    paramedic: { name: 'Paramedic', icon: '💉', mods: { STR: 0, DEX: 2, CON: 0, INT: 3, WIS: 1, CHA: 0 }, blurb: 'Drugs, rhythms, and the hard calls.' },
    emt: { name: 'EMT', icon: '🚑', mods: { STR: 2, DEX: 0, CON: 1, INT: 0, WIS: 2, CHA: 1 }, blurb: 'Eyes on the patient, hands on the stretcher.' },
    firefighter: { name: 'Firefighter', icon: '🚒', mods: { STR: 3, DEX: 1, CON: 2, INT: 0, WIS: 0, CHA: 0 }, blurb: 'Lifts, compressions, forcible entry.' },
    flight: { name: 'Flight Medic', icon: '🚁', mods: { STR: 0, DEX: 3, CON: 1, INT: 2, WIS: 0, CHA: 0 }, blurb: 'Airways and lines at 2,000 feet.' },
    nurse: { name: 'Nurse', icon: '🩺', mods: { STR: 0, DEX: 0, CON: 0, INT: 1, WIS: 2, CHA: 3 }, blurb: 'Reads the room. Calms the family.' },
  };
  const CLASS_ORDER = ['paramedic', 'emt', 'firefighter', 'flight', 'nurse'];

  // Hidden judgment bonus: a sound call is easier to pull off.
  const JUDGMENT_BONUS = { best: 3, ok: 1, wrong: 0 };

  const XP = {
    choice: { best: 100, ok: 50, wrong: 0 },
    successBonus: 50,      // a passed check on a best/ok call
    critBonus: 50,         // natural 20 on a best/ok call
    rollPass: 25,          // passed group roll (no choice involved)
    rollCrit: 25,
    survive: 200,          // patient alive at the end
  };

  const LEVELS = [0, 300, 700, 1200, 1800, 2600];
  const TITLES = ['Probie', 'Rookie', 'Seasoned', 'Veteran', 'Legend', 'Mythic'];
  function levelFor(xp) {
    let l = 0;
    for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i]) l = i;
    return { level: l + 1, title: TITLES[l], next: LEVELS[l + 1] || null, floor: LEVELS[l] };
  }

  function mod(cls, ab) {
    const c = CLASSES[cls] || CLASSES.emt;
    return (c.mods && c.mods[ab]) || 0;
  }
  function fmtMod(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }

  function d20() {
    const a = new Uint32Array(1);
    (root.crypto || window.crypto).getRandomValues(a);
    return (a[0] % 20) + 1;
  }

  /* Resolve one check.
     raw: the kept d20 face; bonus: class + judgment + anything else.
     Returns {total, ok, crit: 'nat20' | 'nat1' | null} */
  function resolve(raw, bonus, dc) {
    if (raw === 20) return { total: raw + bonus, ok: true, crit: 'nat20' };
    if (raw === 1) return { total: raw + bonus, ok: false, crit: 'nat1' };
    const total = raw + bonus;
    return { total, ok: total >= dc, crit: null };
  }

  // A d20 drawn as an SVG (hexagon silhouette with facet lines). Color by state.
  function d20Svg(value, opts) {
    opts = opts || {};
    const fill = opts.fill || '#262b36';
    const stroke = opts.stroke || '#d9a441';
    const ink = opts.ink || '#f4ead2';
    // only a whole number ever reaches the SVG: the value can come from a network message
    const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d{1,3}$/.test(value) ? +value : NaN);
    const v = Number.isInteger(n) && n >= 0 && n <= 999 ? String(n) : '';
    return `<svg class="d20" viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
      <polygon points="50,22 76,66 24,66" fill="none" stroke="${stroke}" stroke-opacity=".55" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M50 3 L50 22 M93 27 L76 66 M7 27 L24 66 M50 97 L24 66 M50 97 L76 66 M7 73 L24 66 M93 73 L76 66 M7 27 L50 22 L93 27" fill="none" stroke="${stroke}" stroke-opacity=".38" stroke-width="1.8"/>
      <text x="50" y="${v.length > 1 ? 57 : 58}" text-anchor="middle" dominant-baseline="middle" font-size="${v.length > 1 ? 26 : 30}" font-weight="800" fill="${ink}" font-family="Cardo, Georgia, serif">${v}</text>
    </svg>`;
  }

  // Team mode: fire/EMS shifts compete. Score = average XP per member.
  const TEAMS = [
    { id: 'A', name: 'A Shift', color: '#ff6b6b' },
    { id: 'B', name: 'B Shift', color: '#4dabf7' },
    { id: 'C', name: 'C Shift', color: '#ffd43b' },
    { id: 'D', name: 'D Shift', color: '#69db7c' },
  ];

  root.CRRules = { TEAMS, ABILITIES, AB_ORDER, CLASSES, CLASS_ORDER, JUDGMENT_BONUS, XP, LEVELS, levelFor, mod, fmtMod, d20, resolve, d20Svg };
})(window);
