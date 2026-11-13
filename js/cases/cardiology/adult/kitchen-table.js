/* Case: Pressure at the Kitchen Table — inferior STEMI with right-ventricle involvement.
   Teaching simulation. Doses and destinations follow common practice; follow your local protocols.

   Step types
     scene   — read-aloud story. Optional vitals (monitor), hp change.
     roll    — everyone rolls a check (group check: at least half must pass).
     choice  — everyone picks an action, then rolls that action's check.
               The party's action is the most popular pick; its group check decides the outcome.
     debrief — wrap-up.
   Effects (success / fail): note, hp (+/-), vitals (partial), next (step id), pause (sec of no QRS), ecg (strip to show)
   grade: best | ok | wrong  — drives XP and a hidden judgment bonus on the roll.
   Options are shuffled each game, so write them in any order, never refer to one by its letter,
   and keep them similar in length and form. Step titles show during the vote: don't hint at the answer. */
(function () {
  const start = { rhythm: 'sinus', hr: 56, st: 0.2, sbp: 100, dbp: 64, spo2: 96, rr: 20, etco2: 34 };

  window.CR_CASES = window.CR_CASES || [];
  window.CR_CASES.push({
    id: 'kitchen-table',
    title: 'Pressure at the Kitchen Table',
    tagline: 'Chest pain at home',
    level: 'ALS',
    topic: 'cardiology', // National Registry (NCCP 2025) topic: airway | cardiology | trauma | medical
    age: 'adult', // adult | pediatric
    subtopic: 'acs', // a heading id from js/topics.js
    minutes: 20,
    hp: 100,
    steps: [
      {
        id: 'dispatch', type: 'scene', title: 'The Call',
        text: '06:12. The call comes in: a 61-year-old man with chest pain at home. The caller says he "doesn\'t look right." A light rain is falling as your party climbs aboard.',
        vitals: { rhythm: 'none' },
      },
      {
        id: 'arrival', type: 'scene', title: 'The Kitchen',
        text: 'He\'s at the kitchen table, gray and slick with sweat, one fist pressed to his sternum. "Like an elephant sitting on me." It started 40 minutes ago while he made coffee. He\'s nauseated. History: hypertension, type 2 diabetes, a pack a day. Meds: metformin, lisinopril. No allergies. Your partner gets him on the monitor.',
        vitals: start,
      },
      {
        id: 'look', type: 'roll', title: 'Take a Closer Look',
        prompt: 'Perception check. You kneel beside him. What do you notice?',
        check: { ab: 'WIS', dc: 12 },
        success: { note: 'His neck veins are distended even sitting upright, and his lungs are clear. File that away.' },
        fail: { note: 'Nothing beyond the obvious. Something was there, though.' },
      },
      {
        id: 'q1', type: 'choice', title: 'First Move',
        prompt: 'Airway open. Breathing unlabored. Radial pulse slow. What\'s your first priority?',
        options: [
          { k: 'A', text: '12-lead ECG within 10 minutes of contact', grade: 'best', check: { ab: 'DEX', dc: 8 },
            success: { note: 'Clean tracing on the first try. Ten minutes from the door, you have your answer.', hp: 5 },
            fail: { note: 'Sweat lifts the electrodes and the tracing is garbage. You dry the skin and redo it. Two minutes lost.', hp: -5 } },
          { k: 'B', text: 'Oxygen by non-rebreather at 15 L/min', grade: 'wrong', check: { ab: 'DEX', dc: 5 },
            success: { note: 'Mask on. SpO₂ climbs to 100%. Nothing else changes, and the 12-lead still isn\'t done.', vitals: { spo2: 100 }, hp: -5 },
            fail: { note: 'He pushes the mask away. "I can breathe fine." He\'s right.' } },
          { k: 'C', text: 'Load and go. Do the 12-lead at the hospital', grade: 'wrong', check: { ab: 'STR', dc: 10 },
            success: { note: 'You\'re rolling in four minutes. The ED does the ECG and pages the cath lab 25 minutes later than you could have.', hp: -15 },
            fail: { note: 'The stair chair jams in the doorframe. While you wrestle it, your partner does the 12-lead anyway.', hp: -5 } },
          { k: 'D', text: 'Full head-to-toe secondary first', grade: 'ok', check: { ab: 'WIS', dc: 10 },
            success: { note: 'Thorough. You find JVD and clear lungs. But the 12-lead waits eight more minutes.', hp: -5 },
            fail: { note: 'Eight minutes of exam and you learn very little. The clock keeps running.', hp: -10 } },
        ],
        teach: 'The 12-lead is the test that changes everything downstream. A STEMI found in the field gets the cath lab moving before you arrive, and minutes are myocardium. Goal: 12-lead within 10 minutes of first contact. Oxygen only if he\'s hypoxemic. Extra O₂ in a normoxic MI adds no benefit and may enlarge the infarct.',
      },
      {
        id: 'q2', type: 'choice', title: 'Read It',
        prompt: 'Here\'s your 12-lead. What does it show?',
        ecg: { preset: 'inferiorRV', layout: '12' },
        options: [
          { k: 'A', text: 'Inferior STEMI', grade: 'best', check: { ab: 'INT', dc: 10 },
            success: { note: 'Called it. Your partner transmits the ECG and the cath lab gets the page.', hp: 5 },
            fail: { note: 'You see it but fumble the radio call. The hospital asks you to re-send.', hp: -5 } },
          { k: 'B', text: 'Anterior STEMI', grade: 'wrong', check: { ab: 'INT', dc: 10 },
            success: { note: 'You confidently report an anterior STEMI. The reading cardiologist corrects you. The lab still comes in.', hp: -5 },
            fail: { note: 'You hesitate and look again. Wait. Those are the inferior leads.' } },
          { k: 'C', text: 'Pericarditis', grade: 'wrong', check: { ab: 'INT', dc: 10 },
            success: { note: 'You talk yourself into pericarditis and hold the alert. Fifteen minutes later the repeat looks worse.', hp: -15 },
            fail: { note: 'Something nags you. Pericarditis doesn\'t cause reciprocal depression. You send the alert.' } },
          { k: 'D', text: 'Early repolarization', grade: 'wrong', check: { ab: 'INT', dc: 10 },
            success: { note: 'You call it benign. No alert. The infarct keeps growing.', hp: -20 },
            fail: { note: 'You almost call it normal, then spot the ST depression in aVL. You send the alert.' } },
        ],
        teach: 'ST elevation in II, III, and aVF: the leads that look at the inferior wall. The mirror image, ST depression in I and aVL, is reciprocal change: the same injury seen from the other side. Reciprocal depression argues hard against pericarditis and early repol. ST elevation in III greater than II points to the right coronary artery.',
      },
      {
        id: 'q3', type: 'choice', title: 'One More Test',
        prompt: 'Inferior STEMI. BP 100/64, HR 56. Before any medication, which test changes your treatment the most?',
        options: [
          { k: 'A', text: 'Right-sided ECG (V4R)', grade: 'best', check: { ab: 'DEX', dc: 8 },
            success: { note: 'V4R shows 1.5 mm of ST elevation. The right ventricle is involved.', hp: 5, ecg: { preset: 'inferiorRV', layout: 'strips', leads: ['V4R'] } },
            fail: { note: 'First try, the lead lands on the wrong side. Second try: 1.5 mm of ST elevation in V4R.', ecg: { preset: 'inferiorRV', layout: 'strips', leads: ['V4R'] } } },
          { k: 'B', text: 'Posterior leads (V7–V9)', grade: 'ok', check: { ab: 'DEX', dc: 8 },
            success: { note: 'No posterior ST elevation. Good to know, but you still don\'t know about the right ventricle.' },
            fail: { note: 'The leads won\'t stick to his sweaty back. Nothing learned.', hp: -5 } },
          { k: 'C', text: 'Blood glucose', grade: 'ok', check: { ab: 'DEX', dc: 5 },
            success: { note: 'Glucose 168 mg/dL (9.3 mmol/L). Worth knowing, but it doesn\'t change your next drug.' },
            fail: { note: 'The glucometer errors out twice.', hp: -2 } },
          { k: 'D', text: 'Point-of-care troponin', grade: 'wrong', check: { ab: 'DEX', dc: 8 },
            success: { note: 'Troponin is normal. It\'s only been 50 minutes, so a normal result means nothing.', hp: -5 },
            fail: { note: 'The device needs 15 minutes. You give up on it.', hp: -2 } },
        ],
        teach: 'Up to half of inferior MIs take the right ventricle down too, because the right coronary artery feeds both. A stunned RV can\'t push blood through the lungs, so the left heart depends on venous return (preload). ST elevation of 1 mm or more in V4R flags it, and that flag changes your drug choices. JVD with clear lungs and a soft pressure is the bedside version of the same clue.',
      },
      {
        id: 'q4', type: 'choice', title: 'The Drug Box',
        prompt: 'V4R: 1.5 mm ST elevation. The RV is involved. Pain is 8/10, BP 98/62. Which drug now?',
        options: [
          { k: 'A', text: 'Aspirin, chewed', grade: 'best', check: { ab: 'CHA', dc: 8 },
            success: { note: 'He chews it down. Aspirin is on board.', hp: 10 },
            fail: { note: 'He gags on it. A minute of coaching gets it down.', hp: 5 } },
          { k: 'B', text: 'Nitroglycerin (GTN) under the tongue', grade: 'wrong', check: { ab: 'DEX', dc: 5 },
            success: { note: 'Two minutes later: BP 72/40. He\'s gray and mumbling that he\'s going to pass out.', vitals: { sbp: 72, dbp: 40, hr: 50, spo2: 94, etco2: 28 }, hp: -30, next: 'q4b' },
            fail: { note: 'The tablet skitters under the table. While you hunt for it, your partner reads the V4R out loud. You put the bottle away.' } },
          { k: 'C', text: 'Fentanyl for the pain', grade: 'ok', check: { ab: 'INT', dc: 10 },
            success: { note: 'Pain eases a little. BP drifts to 90/58. Opioids lower preload too.', vitals: { sbp: 90, dbp: 58 }, hp: -5 },
            fail: { note: 'You second-guess the dose and hold it. Pain stays 8/10.' } },
          { k: 'D', text: 'Oxygen by non-rebreather', grade: 'wrong', check: { ab: 'DEX', dc: 5 },
            success: { note: 'SpO₂ 100%. Nothing else changes.', vitals: { spo2: 100 }, hp: -5 },
            fail: { note: 'He fights the mask. You let him be.' } },
        ],
        teach: 'Aspirin first, at your protocol\'s dose. It permanently blocks thromboxane A₂ in platelets and slows clot growth on the ruptured plaque. Chewing gets it absorbed faster. Nitro is a venodilator. It pools blood in the veins and drops preload, the one thing a failing RV can\'t live without. Most protocols avoid nitrates when RV involvement is suspected.',
      },
      {
        id: 'q4b', type: 'choice', title: 'The Crash', branch: true,
        prompt: 'BP 72/40 after the nitro. He\'s gray and confused. What now?',
        options: [
          { k: 'A', text: 'Lay him flat and give a fluid bolus', grade: 'best', check: { ab: 'DEX', dc: 12 },
            success: { note: 'Line in on the first stick. After 400 mL: BP 94/60, lungs still clear.', vitals: { sbp: 94, dbp: 60, hr: 56, spo2: 96, etco2: 33 }, hp: 20 },
            fail: { note: 'The first IV blows. The second works, three minutes later. BP climbs to 90/58.', vitals: { sbp: 90, dbp: 58, hr: 55, spo2: 95, etco2: 32 }, hp: 10 } },
          { k: 'B', text: 'Another nitroglycerin for his chest pain', grade: 'wrong', check: { ab: 'DEX', dc: 5 },
            success: { note: 'BP 64/38. He stops answering questions. Your partner hangs a bolus without asking.', vitals: { sbp: 64, dbp: 38, hr: 48, spo2: 92, etco2: 24 }, hp: -25 },
            fail: { note: 'Your partner grabs your wrist before the tablet reaches his mouth. Good partner.' } },
          { k: 'C', text: 'Furosemide for heart failure', grade: 'wrong', check: { ab: 'INT', dc: 10 },
            success: { note: 'A diuretic drains what preload he has left. BP 64/36.', vitals: { sbp: 64, dbp: 36, etco2: 25 }, hp: -25 },
            fail: { note: 'You can\'t find it in the drug box. Lucky.' } },
          { k: 'D', text: 'Start a pressor before any fluid', grade: 'ok', check: { ab: 'INT', dc: 12 },
            success: { note: 'Pressure comes up to 86/54, but you\'re squeezing an empty tank. Fluid first would have done more.', vitals: { sbp: 86, dbp: 54, hr: 64 }, hp: 5 },
            fail: { note: 'Mixing the drip eats time you don\'t have. BP stays 72/40.', hp: -10 } },
        ],
        teach: 'Refill the tank. The RV is preload-dependent, so volume is the fix: a cautious bolus, then listen for crackles. Pressors and inotropes come next if fluid alone doesn\'t restore perfusion.',
      },
      {
        id: 'enroute', type: 'scene', title: 'Four Minutes Out',
        text: 'The ambulance pulls onto the main road. The monitor alarms. He\'s sweating through the sheets, confused, and his radial pulse is almost gone.',
        vitals: { rhythm: 'avb3', hr: 38, ar: 82, st: 0.2, sbp: 78, dbp: 46, spo2: 94, rr: 22, etco2: 29 },
        hp: -10,
      },
      {
        id: 'q5', type: 'choice', title: 'Name That Rhythm',
        prompt: 'Look at the monitor. What\'s the rhythm?',
        options: [
          { k: 'A', text: 'Third-degree AV block', grade: 'best', check: { ab: 'INT', dc: 10 },
            success: { note: 'P waves march at 82. QRS complexes march at 38. No relationship. Complete heart block.', hp: 5 },
            fail: { note: 'It takes a long strip and some caliper work, but you get there: complete heart block.' } },
          { k: 'B', text: 'Second-degree AV block, type I', grade: 'wrong', check: { ab: 'INT', dc: 10 },
            success: { note: 'You call Wenckebach. But the PR isn\'t lengthening. There\'s no PR relationship at all.', hp: -5 },
            fail: { note: 'You look for a lengthening PR and can\'t find one. You rethink it.' } },
          { k: 'C', text: 'Sinus bradycardia', grade: 'wrong', check: { ab: 'INT', dc: 10 },
            success: { note: 'You call sinus brady and miss the extra P waves.', hp: -5 },
            fail: { note: 'You notice extra P waves. Not sinus brady.' } },
          { k: 'D', text: 'Junctional rhythm', grade: 'ok', check: { ab: 'INT', dc: 12 },
            success: { note: 'The escape is junctional. But the P waves marching through mean the real problem is complete block.' },
            fail: { note: 'You call it junctional and move on.', hp: -5 } },
        ],
        teach: 'P waves at their own rate. QRS complexes at their own, slower rate. No relationship between them: complete heart block. In an inferior MI the block usually sits in the AV node, because the RCA feeds the AV nodal artery in most people. That\'s why the escape is often narrow.',
      },
      {
        id: 'q6', type: 'choice', title: 'Too Slow to Live',
        prompt: 'Complete heart block. HR 38, BP 78/46, confused. Atropine three minutes ago did nothing. Next?',
        options: [
          { k: 'A', text: 'Transcutaneous pacing', grade: 'best', check: { ab: 'DEX', dc: 12 },
            success: { note: 'Capture at 70 mA, rate 70. The pleth rises with every spike. BP 102/64. He\'s talking again.', vitals: { rhythm: 'paced', hr: 70, ar: 82, sbp: 102, dbp: 64, spo2: 96, etco2: 34 }, hp: 25 },
            fail: { note: 'No capture at first. You reposition the pads and climb to 90 mA. Capture. BP 96/60.', vitals: { rhythm: 'paced', hr: 70, ar: 82, sbp: 96, dbp: 60, spo2: 95, etco2: 33 }, hp: 15 } },
          { k: 'B', text: 'Repeat atropine', grade: 'ok', check: { ab: 'INT', dc: 10 },
            success: { note: 'The rate creeps to 42. Still hypotensive. Still confused.', vitals: { hr: 42, sbp: 80, dbp: 48 }, next: 'rescue' },
            fail: { note: 'No change at all.', hp: -5, next: 'rescue' } },
          { k: 'C', text: 'Adenosine, rapid IV push', grade: 'wrong', check: { ab: 'DEX', dc: 5 },
            success: { note: 'Four seconds of P waves with no QRS. Everyone\'s heart rate went up except his.', pause: 4, vitals: { sbp: 70, dbp: 40 }, hp: -20, next: 'rescue' },
            fail: { note: 'Your partner reads the label out loud before you push. You put it back.', next: 'rescue' } },
          { k: 'D', text: 'Amiodarone IV', grade: 'wrong', check: { ab: 'INT', dc: 10 },
            success: { note: 'The escape rhythm slows to 28. BP 64/36. You just suppressed his backup pacemaker.', vitals: { hr: 28, sbp: 64, dbp: 36, spo2: 90, etco2: 24 }, hp: -30, next: 'rescue' },
            fail: { note: 'You start drawing it up, then stop. Why suppress the only rhythm he has?', next: 'rescue' } },
        ],
        teach: 'Atropine works by blocking vagal tone at the AV node. When it doesn\'t fix the rate, bypass the node with transcutaneous pacing. Set the rate around 60–70 and raise the mA until you see electrical capture. Confirm mechanical capture with a pulse or the pleth, and treat the pacing pain per protocol. Amiodarone and adenosine both suppress the rhythm that\'s keeping him alive.',
      },
      {
        id: 'rescue', type: 'scene', title: 'Your Partner Steps In', branch: true,
        text: 'Your partner slaps the pads on and dials in a rate of 70. Capture at 80 mA. The pleth rises with every spike.',
        vitals: { rhythm: 'paced', hr: 70, ar: 82, sbp: 96, dbp: 60, spo2: 95, etco2: 33 },
        hp: 10,
      },
      {
        id: 'q7', type: 'choice', title: 'Destination',
        prompt: 'He\'s paced and perfusing. Where\'s he going?',
        options: [
          { k: 'A', text: 'PCI center, cath lab activated from the field', grade: 'best', check: { ab: 'CHA', dc: 8 },
            success: { note: 'The lab is activated off your 12-lead. The team will be waiting.', hp: 10 },
            fail: { note: 'Your first call goes to the wrong desk. The lab still gets activated, three minutes later.', hp: 5 } },
          { k: 'B', text: 'Closest ED to stabilize first', grade: 'wrong', check: { ab: 'STR', dc: 5 },
            success: { note: 'The closest ED stabilizes him, then transfers him. The transfer adds 70 minutes to reperfusion.', hp: -25 },
            fail: { note: 'Your partner points out the PCI center is only nine minutes farther. You reroute.' } },
          { k: 'C', text: 'Closest ED. Transmit the ECG and let them decide', grade: 'wrong', check: { ab: 'CHA', dc: 10 },
            success: { note: 'They decide, after you arrive. Then they arrange a transfer.', hp: -20 },
            fail: { note: 'Your clinical support line tells you to go straight to the PCI center.' } },
        ],
        teach: 'Every minute until the artery opens costs heart muscle. Systems set time targets from first contact to reperfusion, often around 90 minutes for primary PCI. Going straight to a PCI-capable center with the lab activated from the field removes the transfer, the biggest delay in the system. Where PCI can\'t happen in time, your protocol may call for fibrinolysis instead. Follow your regional destination protocol.',
      },
      {
        id: 'radio', type: 'roll', title: 'The Radio Report',
        prompt: 'Charisma check. Give the receiving hospital a crisp STEMI report.',
        check: { ab: 'CHA', dc: 10 },
        success: { note: '"Inferior STEMI with RV involvement, complete heart block, paced at 70, ETA nine minutes." The cath team meets you at the door.', hp: 5 },
        fail: { note: 'Your report rambles. The receiving nurse asks for the ETA twice.', hp: -5 },
      },
      {
        id: 'debrief', type: 'debrief', title: 'What the Cath Lab Found',
        text: '100% occlusion of the proximal right coronary artery. One artery explains the whole call.',
        points: [
          'Inferior wall: ST elevation in II, III, aVF',
          'RV branches: V4R elevation, preload dependence, the nitro trap',
          'AV nodal artery (in most people): complete heart block',
          'Field activation: the lab was ready at the door',
        ],
        win: 'He walks out of the hospital four days later.',
        lose: 'He arrests on the table. They get him back, but it\'s a long ICU stay.',
      },
    ],
  });
})();
