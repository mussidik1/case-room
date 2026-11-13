# Case Room

Live EMS patient cases, played like a tabletop RPG. The instructor runs the DM screen on the projector. Students join on their phones, pick a class, choose what to do, and roll a d20 to see if they pull it off. The patient's monitor and HP respond to the party's choices.

**DM screen:** https://mussidik1.github.io/case-room/host.html
**Students join at:** https://mussidik1.github.io/case-room (or scan the QR code)

No accounts, no app installs, no server to run.

The cases are written to work anywhere. They don't name real places. Destinations are described by what a hospital can do (PCI, thrombectomy, major trauma) rather than by local designation. Glucose is given in mg/dL and mmol/L. Drug doses appear only where the dose itself is the question, and the lessons point back to local protocol.

## Cases

The setup screen groups cases into folders by National Registry recertification topic (the NCCP 2025 model's clinical topics: Airway, Cardiology, Trauma, Medical), so each case maps straight to recert credit. The fifth Registry topic, Operations, is left out. Each topic has an Adult and a Pediatric folder. Inside those, cases sit under body-system headings, the way emergency medicine organizes its training; trauma is grouped by body region, as in ATLS and PHTLS. Empty headings show dimmed, ready for new cases. The full list of headings lives in `js/topics.js`.

| Folder | Case | What it covers | Level | Time |
|---|---|---|---|---|
| Airway › Asthma & COPD · Adult | Third Floor, No Elevator | Life-threatening asthma: the silent chest, a "normal" CO₂ in a fast breather, nebs then magnesium, no sedation, assisting a tiring patient instead of CPAP, slow bagging, and letting trapped air out when the pressure crashes | BLS/ALS | ~20 min |
| Cardiology › Acute coronary syndromes · Adult | Pressure at the Kitchen Table | Inferior STEMI with right-ventricle involvement: read the 12-lead, V4R, the nitro trap, complete heart block, pacing | ALS | ~20 min |
| Cardiology › Cardiac arrest & post-ROSC · Adult | Match Point | Witnessed VF arrest: pads on during CPR, shock then straight back on the chest, reading EtCO₂ during CPR, refractory VF, the EtCO₂ surge at ROSC, ventilation and oxygen targets, an anterior STEMI on the post-ROSC 12-lead, and post-arrest low blood pressure | ALS | ~25 min |
| Medical › Neurologic · Adult | Words Won't Come | Stroke with a large vessel occlusion: last known well, the glucose mimic, AF as the clot source, LAMS scoring, localization, the penumbra, airway after vomiting, destination | BLS/ALS | ~24 min |
| Medical › Toxicology · Adult | Locked Door | Opioid overdose: breathing before naloxone, naloxone titrated to breathing rather than waking, a mixed-in sedative that naloxone can't reverse, no flumazenil, and a patient with capacity who wants to leave before it wears off | BLS/ALS | ~16 min |
| Medical › Environmental · Adult | Mile 25 | Exertional heat stroke at a marathon: a confused runner who's still sweating, a rectal temperature, cool first and transport second in an ice-water tub, stopping at about 39°C (102°F), and why fever drugs don't help | BLS/ALS | ~15 min |
| Trauma › Multisystem · Adult | Down at the Barrier | Motorcycle crash: tourniquet, pelvic binder, shock index and EtCO₂, whole blood vs. saline, the lethal triad, tension pneumothorax en route | ALS | ~25 min |
| Airway › Airway obstruction · Pediatric | Snack Time | A choking toddler: letting an effective cough work, back blows and abdominal thrusts when he goes silent, CPR with a look in the mouth when he goes limp, Magill forceps under direct view, and why he still goes to hospital | BLS/ALS | ~16 min |
| Cardiology › Dysrhythmias · Pediatric | Won't Feed | Infant SVT: telling it from sinus tachycardia, ice to the face, adenosine technique and the expected pause, why it comes back, then synchronized cardioversion when she crashes | ALS | ~20 min |
| Medical › Allergy & immunology · Pediatric | The Birthday Party | Pediatric anaphylaxis: IM epinephrine, positioning, shark-fin capnography, the stridor trap, weight-based dose math with a tenfold-error branch, biphasic reactions | BLS/ALS | ~18 min |
| Trauma › Abdomen & pelvis · Pediatric | Handlebars | A child's handlebar injury: compensated shock with a normal blood pressure, the spleen and referred shoulder pain, choosing a center that treats injured children, fluid by weight, pain relief, and a falling heart rate as the sign of collapse | BLS/ALS | ~20 min |

The 2025 model names only broad topics, with no required subtopics, and counts pediatric content inside them. The results CSV lists the folder for each case played.

## Running a game

1. Open the DM screen on the computer connected to the projector.
2. Pick a case, adjust settings, and tap **Open the room**.
3. Students scan the QR code, enter a name, and pick a class.
4. Tap **Begin the adventure**.

| Key | Action |
|---|---|
| → / Space / Enter / PageDown | Next (presentation clickers work; a double press counts once, and closing a vote before everyone has answered takes a second press) |
| R | Call for a roll |
| F | Full screen |
| M | Monitor beep on/off |

**Fixed room code (for a Canva or PowerPoint slide):** open `host.html?r=MEDIC` and the room is always `MEDIC`. Students' QR code: `https://mussidik1.github.io/case-room/?r=MEDIC`. Codes are shared by everyone who uses this site, so pick one that's yours (your initials plus a number works). If another DM screen goes live on the same code, your screen shows a warning. Each game starts fresh, so phones never carry answers over from an earlier session on the same code.

**Answer order:** the options are shuffled for every game, and the best answer lands evenly across A to D. Every phone sees the same order as the big screen.

**Refreshed by accident?** Reopen the DM screen and tap **Resume**. You land on the same screen, with any open vote and the answers already in. Nothing is scored twice.

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

Copy `js/cases/cardiology/adult/kitchen-table.js` into the folder for your case's topic and age group, for example `js/cases/trauma/pediatric/`. Set `topic` (`airway`, `cardiology`, `trauma`, or `medical`) and `age` (`adult` or `pediatric`) to match the folder, and set `subtopic` to one of that topic's heading ids in `js/topics.js` (for example `neurologic` or `toxicology` under Medical). Then add a `<script>` line for the file in `host.html` next to the others. The case shows up under its heading on the setup screen. Each case is a list of steps:

- `scene`: read-aloud text. Optional `vitals` (sets the monitor) and `hp` (+/-).
- `roll`: everyone rolls one check, e.g. `{ ab: 'WIS', dc: 12 }`, with `success` and `fail` outcomes.
- `choice`: a decision with options. Each option has `grade` (`best` / `ok` / `wrong`), a `check`, and `success` / `fail` outcomes. Add `teach` for the lesson shown after the vote. An `ecg` field shows a 12-lead. Write the options in any order, since they're shuffled each game. Never refer to an option by its letter, and keep options similar in length and form so the right one doesn't stand out. Keep step titles from hinting at the answer, because they show during the vote.
- `debrief`: the wrap-up.

A case can set `alarms` for the monitor, e.g. `{ hr: [100, 180], rr: [20, 55], sbp: 70 }` for an infant, so normal numbers for that age don't flash red. Adult limits are the default.

An outcome can include:
- `note`: what happens
- `hp`: the change in patient HP
- `vitals`: the monitor target, e.g. `{ sbp: 72, dbp: 40 }`
- `next`: jump to a step
- `pause`: seconds of no QRS
- `ecg`: a strip to show

A step marked `branch: true` is skipped unless an outcome jumps to it with `next`. Every path through a case should leave the monitor matching the next prompt, so after a branch, set any numbers the next step quotes.

Monitor rhythms: `sinus`, `avb3` (complete heart block), `paced`, `afib`, `vtach`, `vfib`, `asystole`, `junctional`, `none`. Set `st` for ST elevation in lead II (in mV) and `ar` for the atrial rate in heart block.

## How it connects

The DM screen holds the game. It sends the current screen to the phones through three free public message relays at once (EMQX, HiveMQ, and Eclipse), and phones use whichever ones they can reach. Messages pass through public servers, so use first names or call signs, and never enter patient information. If a building's Wi-Fi blocks the relays, phones on cellular data still work, and so does a phone hotspot for the DM laptop.

**Security.** Anyone who knows a room code can reach the public relays, so the game treats every message as untrusted:

- Phones rebuild each message into a known-safe shape before showing anything, and both screens shrug off malformed or oversized messages.
- Each phone makes a secret token when it joins. The DM screen ignores messages for that player without it, so nobody can answer as someone else.
- The DM screen rolls every die. Phones only ask for a roll and show the result.
- Joins are capped at 150 and rate-limited. **Lock the room** (lobby button or Settings) once your class is in, and remove anyone from Settings → People in the room, at any point in the game.
- A security policy in each page only lets the site's own scripts run and only lets the page talk to the game relays.
- `?relay=` works only for a relay on your own computer (local testing), and the join QR never includes it.

A private relay with a login would add the last layer: it would keep outsiders off the room's channel entirely.

Type is set in Cardo by David J. Perry, bundled with the site under the SIL Open Font License (`fonts/OFL.txt`), so it loads even where font services are blocked.

*Teaching simulation. Follow your local protocols.*
