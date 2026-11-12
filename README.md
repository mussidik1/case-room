# Case Room

Live EMS patient cases, played like a tabletop RPG. The instructor runs the DM screen on the projector. Students join on their phones, pick a class, choose what to do, and roll a d20 to see if they pull it off. The patient's monitor and HP respond to the party's choices.

**DM screen:** https://mussidik1.github.io/case-room/host.html
**Students join at:** https://mussidik1.github.io/case-room (or scan the QR code)

No accounts, no app installs, no server to run.

## Cases

| Case | Topic | Level | Time |
|---|---|---|---|
| Pressure at the Kitchen Table | Inferior STEMI with right-ventricle involvement: read the 12-lead, V4R, the nitro trap, complete heart block, pacing | ALS | ~20 min |
| Down on Route 40 | Motorcycle crash: tourniquet, pelvic binder, shock index and EtCO₂, whole blood vs. saline, the lethal triad, tension pneumothorax en route | ALS | ~25 min |
| Words Won't Come | Stroke with a large vessel occlusion: last known well, the glucose mimic, AF as the clot source, LAMS scoring, localization, the penumbra, airway after vomiting, destination | BLS/ALS | ~24 min |
| The Birthday Party | Pediatric anaphylaxis: shark-fin capnography, IM epinephrine, the stridor trap, weight-based dose math with a tenfold-error branch, biphasic reactions | BLS/ALS | ~18 min |

## Running a game

1. Open the DM screen on the computer connected to the projector.
2. Pick a case, adjust settings, and tap **Open the room**.
3. Students scan the QR code, enter a name, and pick a class.
4. Tap **Begin the adventure**.

| Key | Action |
|---|---|
| → / Space / Enter / PageDown | Next (presentation clickers work) |
| R | Call for a roll |
| F | Full screen |
| M | Monitor beep on/off |

**Fixed room code (for a Canva or PowerPoint slide):** open `host.html?r=MEDIC` and the room is always `MEDIC`. Students' QR code: `https://mussidik1.github.io/case-room/?r=MEDIC`.

**Teams:** in Settings, set Teams to 2, 3, or 4 (A Shift through D Shift). Students are auto-balanced as they join. They can switch teams on their phones in the lobby, and you can tap a name in the lobby to move that player. Teams are ranked by average XP, so team size doesn't decide the winner.

**Running several cases back to back:** at the end of a case, **Next case, keep XP** returns to setup with everyone's XP intact, so a full refresher day plays like a campaign. **New game, reset XP** starts everyone over.

**Exporting results:** the final screen (and Settings, any time) has two downloads. Practice bots are left out of both.
- **Summary (CSV):** each player's rank, class, team, XP, level, best, reasonable, and harmful calls, missed decisions, rolls, and join time. It also lists the party's decision at every step and the patient's HP afterward. This is useful for CE attendance records.
- **Decision log (CSV):** one row per player per step, with their choice, its grade, their d20 roll, total, DC, the result, and the XP earned.

**Practicing alone:** in the lobby, tap **+ Practice party** to add 6 bots. To play as a student on the same device, open the join link in another tab.

If you refresh the DM screen by accident, reopen it and tap **Resume**. Students keep their place.

## The rules

**Classes.** Every class gets the same +6 in ability bonuses, spread differently.

| Class | STR | DEX | CON | INT | WIS | CHA |
|---|---|---|---|---|---|---|
| 💉 Paramedic | +0 | +2 | +0 | +3 | +1 | +0 |
| 🚑 EMT | +2 | +0 | +1 | +0 | +2 | +1 |
| 🚒 Firefighter | +3 | +1 | +2 | +0 | +0 | +0 |
| 🚁 Flight Medic | +0 | +3 | +1 | +2 | +0 | +0 |
| 🩺 Nurse | +0 | +0 | +0 | +1 | +2 | +3 |

STR is lifting, CPR, and extrication. DEX is IVs, leads, and procedures. CON is stamina on long calls. INT is pharmacology and ECGs. WIS is assessment and judgment. CHA is talking to patients, families, and the radio.

**Decisions.**
- Each student picks an action, then rolls a d20.
- The roll adds their class bonus for that action's ability, plus a hidden bonus for a sound call: +3 for the best call, +1 for a reasonable one.
- The most popular action becomes the party's action. It succeeds if at least half of the students who chose it pass the check.
- A natural 20 always succeeds and a natural 1 always fails.
- A harmful call can still "succeed." That means they carried it out, and the patient pays for it.

**XP.**
- Best call: 100 XP. Reasonable call: 50 XP. Harmful call: 0 XP.
- A passed check on a best or reasonable call adds 50 XP. A natural 20 adds 50 more.
- Passing a group roll is worth 25 XP.
- Everyone gets 200 XP if the patient survives.
- Levels run Probie → Rookie → Seasoned → Veteran → Legend.

**Patient HP.** Good care heals and bad calls hurt. If HP hits 0 the patient is coding, but the DM can keep going.

**DM powers (on the result screen):**
- Tap any vote bar to play out that action instead ("What if we'd given the nitro?").
- **Rule success / Rule failure** overrides the dice.
- **🎲 Call for a roll** works from any story screen: pick an ability and a DC, then everyone rolls.
- On the standings screen, tap **✧** to grant Inspiration. That player rolls with advantage next time.

## Writing a new case

Copy `js/cases/kitchen-table.js` to a new file, edit it, and add a `<script>` line for it in `host.html` next to the existing case. Each case is a list of steps:

- `scene`: read-aloud text. Optional `vitals` (sets the monitor) and `hp` (+/-).
- `roll`: everyone rolls one check, e.g. `{ ab: 'WIS', dc: 12 }`, with `success` and `fail` outcomes.
- `choice`: a decision with options. Each option has `grade` (`best` / `ok` / `wrong`), a `check`, and `success` / `fail` outcomes. Add `teach` for the lesson shown after the vote. An `ecg` field shows a 12-lead.
- `debrief`: the wrap-up.

An outcome can include:
- `note`: what happens
- `hp`: the change in patient HP
- `vitals`: the monitor target, e.g. `{ sbp: 72, dbp: 40 }`
- `next`: jump to a step
- `pause`: seconds of no QRS
- `ecg`: a strip to show

A step marked `branch: true` is skipped unless an outcome jumps to it with `next`.

Monitor rhythms: `sinus`, `avb3` (complete heart block), `paced`, `afib`, `vtach`, `vfib`, `asystole`, `junctional`, `none`. Set `st` for ST elevation in lead II (in mV) and `ar` for the atrial rate in heart block.

## How it connects

The DM screen holds the game. It sends the current screen to the phones through three free public message relays at once (EMQX, HiveMQ, and Eclipse), and phones use whichever ones they can reach. Messages pass through public servers, so use first names or call signs, and never enter patient information. If a building's Wi-Fi blocks the relays, phones on cellular data still work, and so does a phone hotspot for the DM laptop.

*Teaching simulation. Follow your local protocols.*
