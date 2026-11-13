/* Case library structure.
   Top level: the National Registry's NCCP 2025 topics, so a case maps straight to recert credit.
   Inside each topic, an Adult and a Pediatric folder, then body-system (or body-region) headings
   modeled on how emergency medicine organizes its training.
   A case sets `topic`, `age`, and `subtopic` to ids from this file, and lives in
   js/cases/<topic>/<age>/. */
(function (w) {
  'use strict';
  w.CR_TOPICS = [
    { id: 'airway', name: 'Airway', subtopics: [
      { id: 'obstruction', name: 'Airway obstruction' },
      { id: 'asthma-copd', name: 'Asthma & COPD' },
      { id: 'respiratory-infection', name: 'Respiratory infections' },
      { id: 'respiratory-failure', name: 'Respiratory failure & ventilation' },
    ] },
    { id: 'cardiology', name: 'Cardiology', subtopics: [
      { id: 'acs', name: 'Acute coronary syndromes' },
      { id: 'dysrhythmias', name: 'Dysrhythmias' },
      { id: 'heart-failure', name: 'Heart failure & shock' },
      { id: 'arrest', name: 'Cardiac arrest & post-ROSC' },
      { id: 'vascular', name: 'Vascular emergencies' },
    ] },
    { id: 'trauma', name: 'Trauma', subtopics: [ // by body region, as ATLS and PHTLS teach it
      { id: 'head-spine', name: 'Head & spine' },
      { id: 'chest', name: 'Chest' },
      { id: 'abdomen-pelvis', name: 'Abdomen & pelvis' },
      { id: 'extremities', name: 'Extremities & hemorrhage' },
      { id: 'burns', name: 'Burns & soft tissue' },
      { id: 'multisystem', name: 'Multisystem' },
    ] },
    { id: 'medical', name: 'Medical', subtopics: [
      { id: 'neurologic', name: 'Neurologic' },
      { id: 'endocrine', name: 'Endocrine & metabolic' },
      { id: 'allergy', name: 'Allergy & immunology' },
      { id: 'toxicology', name: 'Toxicology' },
      { id: 'infectious', name: 'Infectious disease & sepsis' },
      { id: 'gi', name: 'Abdominal & GI' },
      { id: 'renal', name: 'Renal & GU' },
      { id: 'obgyn', name: 'OB & GYN' },
      { id: 'behavioral', name: 'Behavioral health' },
      { id: 'hematology', name: 'Hematology' },
      { id: 'environmental', name: 'Environmental' },
    ] },
    { id: 'operations', name: 'Operations', subtopics: [
      { id: 'mci', name: 'MCI & disaster' },
      { id: 'safety', name: 'Safety & wellness' },
      { id: 'communication', name: 'Communication & handoff' },
      { id: 'transport', name: 'Transport & destination' },
    ] },
  ];
  w.CR_AGES = [{ id: 'adult', name: 'Adult' }, { id: 'pediatric', name: 'Pediatric' }];
})(window);
