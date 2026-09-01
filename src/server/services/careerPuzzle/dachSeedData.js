/**
 * Curated DACH Career Puzzle catalog seed.
 * Pieces use stable `key` slugs; edges reference keys (resolved to ObjectIds at seed time).
 * Occupations may set escoId later via enrichment; left null in V1 seed.
 */

/** @typedef {{ key: string, category: string, title: { en: string, de: string }, shortDescription?: { en: string, de: string }, visual?: { icon?: string, colorToken?: string }, metadata?: object, tags?: string[] }} SeedPiece */
/** @typedef {{ fromKey: string, toKey: string, relationType?: string, weight?: number }} SeedEdge */

/** @type {SeedPiece[]} */
const SEED_PIECES = [
  // --- Education (profile seeds + ladder) ---
  {
    key: 'edu.none',
    category: 'school',
    title: { en: 'No formal qualification yet', de: 'Noch kein formaler Abschluss' },
    shortDescription: {
      en: 'Starting point before a school-leaving certificate.',
      de: 'Startpunkt vor einem Schulabschluss.',
    },
    visual: { icon: 'school', colorToken: 'education' },
    tags: ['seed', 'education'],
  },
  {
    key: 'edu.hauptschulabschluss',
    category: 'school',
    title: { en: 'Hauptschulabschluss', de: 'Hauptschulabschluss' },
    shortDescription: {
      en: 'Lower secondary school leaving certificate.',
      de: 'Erster allgemeinbildender Schulabschluss.',
    },
    visual: { icon: 'school', colorToken: 'education' },
    tags: ['seed', 'education'],
  },
  {
    key: 'edu.realschulabschluss',
    category: 'school',
    title: { en: 'Realschulabschluss', de: 'Realschulabschluss' },
    shortDescription: {
      en: 'Intermediate secondary school leaving certificate.',
      de: 'Mittlerer Schulabschluss.',
    },
    visual: { icon: 'school', colorToken: 'education' },
    tags: ['seed', 'education'],
  },
  {
    key: 'edu.abitur',
    category: 'school',
    title: { en: 'Abitur (university entrance)', de: 'Abitur' },
    shortDescription: {
      en: 'General higher education entrance qualification.',
      de: 'Allgemeine Hochschulreife.',
    },
    visual: { icon: 'school', colorToken: 'education' },
    tags: ['seed', 'education'],
  },
  {
    key: 'edu.fachabitur',
    category: 'school',
    title: { en: 'Fachabitur', de: 'Fachabitur' },
    shortDescription: {
      en: 'Entrance qualification for universities of applied sciences.',
      de: 'Fachhochschulreife.',
    },
    visual: { icon: 'school', colorToken: 'education' },
    tags: ['seed', 'education'],
  },
  {
    key: 'edu.ausbildung',
    category: 'apprenticeship',
    title: { en: 'Completed vocational training', de: 'Abgeschlossene Ausbildung' },
    shortDescription: {
      en: 'You already completed an apprenticeship.',
      de: 'Du hast bereits eine Ausbildung abgeschlossen.',
    },
    visual: { icon: 'build', colorToken: 'apprenticeship' },
    tags: ['seed', 'education'],
  },
  {
    key: 'edu.associate',
    category: 'further_education',
    title: { en: 'Associate / short cycle degree', de: 'Kurzstudiengang / Associate' },
    shortDescription: {
      en: 'Short-cycle tertiary education.',
      de: 'Kurzzyklus-Hochschulbildung.',
    },
    visual: { icon: 'school', colorToken: 'education' },
    tags: ['seed', 'education'],
  },
  {
    key: 'edu.bachelors',
    category: 'university',
    title: { en: "Bachelor's degree", de: 'Bachelor' },
    shortDescription: {
      en: 'Undergraduate university degree.',
      de: 'Erster Hochschulabschluss.',
    },
    visual: { icon: 'university', colorToken: 'university' },
    tags: ['seed', 'education'],
  },
  {
    key: 'edu.masters',
    category: 'university',
    title: { en: "Master's degree", de: 'Master' },
    shortDescription: {
      en: 'Graduate university degree.',
      de: 'Zweiter Hochschulabschluss.',
    },
    visual: { icon: 'university', colorToken: 'university' },
    tags: ['seed', 'education'],
  },
  {
    key: 'edu.phd',
    category: 'university',
    title: { en: 'Doctorate / PhD', de: 'Promotion / Doktortitel' },
    shortDescription: {
      en: 'Doctoral degree.',
      de: 'Wissenschaftliche Promotion.',
    },
    visual: { icon: 'university', colorToken: 'university' },
    tags: ['seed', 'education'],
  },
  {
    key: 'edu.staatsexamen',
    category: 'university',
    title: { en: 'Staatsexamen', de: 'Staatsexamen' },
    shortDescription: {
      en: 'State examination for regulated professions.',
      de: 'Staatliche Prüfung für reglementierte Berufe.',
    },
    visual: { icon: 'university', colorToken: 'university' },
    tags: ['seed', 'education'],
  },
  {
    key: 'edu.professional',
    category: 'further_education',
    title: { en: 'Professional degree', de: 'Berufsqualifizierender Abschluss' },
    shortDescription: {
      en: 'Profession-specific higher qualification.',
      de: 'Berufsspezifische höhere Qualifikation.',
    },
    visual: { icon: 'school', colorToken: 'education' },
    tags: ['seed', 'education'],
  },

  // --- Experience (narrative locked seeds) ---
  {
    key: 'exp.none',
    category: 'occupation',
    title: { en: 'No professional experience yet', de: 'Noch keine Berufserfahrung' },
    shortDescription: {
      en: 'You are at the start of your working life.',
      de: 'Du stehst am Anfang deines Berufslebens.',
    },
    visual: { icon: 'work', colorToken: 'experience' },
    tags: ['seed', 'experience'],
  },
  {
    key: 'exp.intern',
    category: 'occupation',
    title: { en: 'Internship experience', de: 'Praktikumserfahrung' },
    shortDescription: {
      en: 'You have internship-level experience.',
      de: 'Du hast Erfahrung auf Praktikums-Niveau.',
    },
    visual: { icon: 'work', colorToken: 'experience' },
    tags: ['seed', 'experience'],
  },
  {
    key: 'exp.entry_level',
    category: 'occupation',
    title: { en: 'Entry-level experience', de: 'Berufseinsteiger-Niveau' },
    shortDescription: {
      en: 'You have worked at entry level.',
      de: 'Du hast auf Einsteiger-Niveau gearbeitet.',
    },
    visual: { icon: 'work', colorToken: 'experience' },
    tags: ['seed', 'experience'],
  },
  {
    key: 'exp.mid_level',
    category: 'occupation',
    title: { en: 'Mid-level experience', de: 'Mittleres Erfahrungsniveau' },
    shortDescription: {
      en: 'You have solid mid-level professional experience.',
      de: 'Du hast solide Berufserfahrung auf mittlerem Niveau.',
    },
    visual: { icon: 'work', colorToken: 'experience' },
    tags: ['seed', 'experience'],
  },
  {
    key: 'exp.senior',
    category: 'occupation',
    title: { en: 'Senior experience', de: 'Senior-Niveau' },
    shortDescription: {
      en: 'You have senior-level professional experience.',
      de: 'Du hast Berufserfahrung auf Senior-Niveau.',
    },
    visual: { icon: 'work', colorToken: 'experience' },
    tags: ['seed', 'experience'],
  },
  {
    key: 'exp.lead',
    category: 'occupation',
    title: { en: 'Lead experience', de: 'Lead-Erfahrung' },
    shortDescription: {
      en: 'You have led projects or people.',
      de: 'Du hast Projekte oder Menschen geführt.',
    },
    visual: { icon: 'work', colorToken: 'experience' },
    tags: ['seed', 'experience'],
  },
  {
    key: 'exp.manager',
    category: 'occupation',
    title: { en: 'Manager experience', de: 'Manager-Erfahrung' },
    shortDescription: {
      en: 'You have managed teams or functions.',
      de: 'Du hast Teams oder Bereiche geleitet.',
    },
    visual: { icon: 'work', colorToken: 'experience' },
    tags: ['seed', 'experience'],
  },
  {
    key: 'exp.director',
    category: 'occupation',
    title: { en: 'Director experience', de: 'Director-Erfahrung' },
    shortDescription: {
      en: 'You have director-level responsibility.',
      de: 'Du hast Verantwortung auf Director-Niveau.',
    },
    visual: { icon: 'work', colorToken: 'experience' },
    tags: ['seed', 'experience'],
  },
  {
    key: 'exp.vp',
    category: 'occupation',
    title: { en: 'VP experience', de: 'VP-Erfahrung' },
    shortDescription: {
      en: 'You have vice-president-level experience.',
      de: 'Du hast Erfahrung auf VP-Niveau.',
    },
    visual: { icon: 'work', colorToken: 'experience' },
    tags: ['seed', 'experience'],
  },
  {
    key: 'exp.c_suite',
    category: 'occupation',
    title: { en: 'C-suite experience', de: 'C-Level-Erfahrung' },
    shortDescription: {
      en: 'You have executive / C-suite experience.',
      de: 'Du hast Erfahrung auf C-Level.',
    },
    visual: { icon: 'work', colorToken: 'experience' },
    tags: ['seed', 'experience'],
  },

  // Placeholder for user-authored locked profile steps (display via node snapshot)
  {
    key: 'profile.custom',
    category: 'occupation',
    title: { en: 'Custom profile step', de: 'Eigener Profilschritt' },
    shortDescription: {
      en: 'A profile step you added yourself.',
      de: 'Ein Profilschritt, den du selbst hinzugefügt hast.',
    },
    visual: { icon: 'person', colorToken: 'experience' },
    tags: ['seed', 'profile', 'custom'],
  },

  // --- Next education / pathway nodes (user-selectable) ---
  {
    key: 'path.vocational_school',
    category: 'school',
    title: { en: 'Vocational school', de: 'Berufsschule / Berufsfachschule' },
    shortDescription: {
      en: 'School-based vocational preparation.',
      de: 'Schulische berufliche Vorbereitung.',
    },
    visual: { icon: 'school', colorToken: 'education' },
    metadata: { estimatedDurationMonths: 24 },
    tags: ['pathway'],
  },
  {
    key: 'path.high_school',
    category: 'school',
    title: { en: 'Upper secondary / Gymnasium track', de: 'Gymnasiale Oberstufe' },
    shortDescription: {
      en: 'Path toward Abitur.',
      de: 'Weg zum Abitur.',
    },
    visual: { icon: 'school', colorToken: 'education' },
    metadata: { estimatedDurationMonths: 24 },
    tags: ['pathway'],
  },
  {
    key: 'path.technical_college',
    category: 'school',
    title: { en: 'Technical college (Fachoberschule)', de: 'Fachoberschule' },
    shortDescription: {
      en: 'Path toward Fachabitur / applied sciences.',
      de: 'Weg zum Fachabitur / zur Fachhochschule.',
    },
    visual: { icon: 'school', colorToken: 'education' },
    metadata: { estimatedDurationMonths: 24 },
    tags: ['pathway'],
  },
  {
    key: 'path.university',
    category: 'university',
    title: { en: 'University studies', de: 'Studium an der Universität' },
    shortDescription: {
      en: 'Begin a university degree program.',
      de: 'Ein Universitätsstudium beginnen.',
    },
    visual: { icon: 'university', colorToken: 'university' },
    metadata: { estimatedDurationMonths: 36 },
    tags: ['pathway'],
  },
  {
    key: 'path.applied_sciences',
    category: 'university',
    title: { en: 'University of applied sciences', de: 'Fachhochschule / HAW' },
    shortDescription: {
      en: 'Practice-oriented higher education.',
      de: 'Praxisorientiertes Hochschulstudium.',
    },
    visual: { icon: 'university', colorToken: 'university' },
    metadata: { estimatedDurationMonths: 36 },
    tags: ['pathway'],
  },

  // --- Electrician chain ---
  {
    key: 'appr.electrician',
    category: 'apprenticeship',
    title: { en: 'Apprenticeship as electrician', de: 'Ausbildung zum Elektriker / zur Elektrikerin' },
    shortDescription: {
      en: 'Dual vocational training in electrical trades.',
      de: 'Duale Ausbildung im Elektrohandwerk.',
    },
    visual: { icon: 'bolt', colorToken: 'apprenticeship' },
    metadata: { estimatedDurationMonths: 42 },
    tags: ['electrician', 'trade'],
  },
  {
    key: 'occ.electrician',
    category: 'occupation',
    title: { en: 'Electrician', de: 'Elektriker / Elektrikerin' },
    shortDescription: {
      en: 'Qualified electrician after completing training.',
      de: 'Fachkraft nach abgeschlossener Elektro-Ausbildung.',
    },
    visual: { icon: 'bolt', colorToken: 'occupation' },
    metadata: {
      estimatedDurationMonths: null,
      estimatedSalary: { min: 28000, max: 42000, currency: 'EUR' },
    },
    tags: ['electrician', 'trade'],
  },
  {
    key: 'promo.master_craftsman_electrical',
    category: 'occupation',
    title: { en: 'Master craftsman (electrical)', de: 'Meister im Elektrohandwerk' },
    shortDescription: {
      en: 'Meisterbrief — lead teams and run a craft business.',
      de: 'Meisterbrief — Teams führen und einen Betrieb leiten.',
    },
    visual: { icon: 'workspace', colorToken: 'occupation' },
    metadata: { estimatedDurationMonths: 18 },
    tags: ['electrician', 'trade'],
  },
  {
    key: 'occ.building_technician',
    category: 'occupation',
    title: { en: 'Building technician', de: 'Gebäudetechniker / Gebäudetechnikerin' },
    shortDescription: {
      en: 'Technical specialist for building systems.',
      de: 'Technische Fachkraft für Gebäudesysteme.',
    },
    visual: { icon: 'home', colorToken: 'occupation' },
    tags: ['electrician', 'building'],
  },
  {
    key: 'occ.business_owner_trade',
    category: 'occupation',
    title: { en: 'Business owner (trade)', de: 'Selbstständige/r im Handwerk' },
    shortDescription: {
      en: 'Run your own craft business.',
      de: 'Einen eigenen Handwerksbetrieb führen.',
    },
    visual: { icon: 'store', colorToken: 'occupation' },
    tags: ['trade', 'entrepreneur'],
  },

  // --- Mechanical / engineering chain ---
  {
    key: 'appr.it_specialist',
    category: 'apprenticeship',
    title: { en: 'IT specialist apprenticeship', de: 'Ausbildung Fachinformatiker/in' },
    shortDescription: {
      en: 'Dual training as an IT specialist.',
      de: 'Duale Ausbildung zur Fachinformatikerin / zum Fachinformatiker.',
    },
    visual: { icon: 'computer', colorToken: 'apprenticeship' },
    metadata: { estimatedDurationMonths: 36 },
    tags: ['it'],
  },
  {
    key: 'appr.carpenter',
    category: 'apprenticeship',
    title: { en: 'Carpenter apprenticeship', de: 'Ausbildung zum Zimmermann / zur Zimmerin' },
    shortDescription: {
      en: 'Dual training in carpentry.',
      de: 'Duale Ausbildung im Zimmererhandwerk.',
    },
    visual: { icon: 'build', colorToken: 'apprenticeship' },
    metadata: { estimatedDurationMonths: 36 },
    tags: ['trade'],
  },
  {
    key: 'study.mechanical_engineering',
    category: 'university',
    title: { en: 'Mechanical engineering studies', de: 'Studium Maschinenbau' },
    shortDescription: {
      en: 'Degree program in mechanical engineering.',
      de: 'Studiengang Maschinenbau.',
    },
    visual: { icon: 'university', colorToken: 'university' },
    metadata: { estimatedDurationMonths: 42 },
    tags: ['engineering'],
  },
  {
    key: 'occ.mechanical_engineer',
    category: 'occupation',
    title: { en: 'Mechanical engineer', de: 'Maschinenbauingenieur / Maschinenbauingenieurin' },
    shortDescription: {
      en: 'Professional mechanical engineer role.',
      de: 'Beruf als Maschinenbauingenieur/in.',
    },
    visual: { icon: 'engineering', colorToken: 'occupation' },
    metadata: {
      estimatedSalary: { min: 45000, max: 70000, currency: 'EUR' },
    },
    tags: ['engineering'],
  },
  {
    key: 'promo.engineering_manager',
    category: 'occupation',
    title: { en: 'Engineering manager', de: 'Engineering Manager' },
    shortDescription: {
      en: 'Lead engineering teams and delivery.',
      de: 'Engineering-Teams und Lieferung führen.',
    },
    visual: { icon: 'groups', colorToken: 'occupation' },
    tags: ['engineering', 'leadership'],
  },
  {
    key: 'cert.further_edu_trade',
    category: 'further_education',
    title: { en: 'Further trade education', de: 'Weiterbildung im Handwerk' },
    shortDescription: {
      en: 'Additional certified trade upskilling.',
      de: 'Zusätzliche zertifizierte Weiterbildung im Handwerk.',
    },
    visual: { icon: 'school', colorToken: 'further_education' },
    tags: ['trade'],
  },
];

/**
 * Directed progressions. Education seeds open pathway choices;
 * experience seeds are narrative-only (no outgoing edges in V1).
 * @type {SeedEdge[]}
 */
const SEED_EDGES = [
  // From no formal qualification
  { fromKey: 'edu.none', toKey: 'path.vocational_school', weight: 10 },
  { fromKey: 'edu.none', toKey: 'edu.hauptschulabschluss', weight: 8 },
  { fromKey: 'edu.none', toKey: 'path.high_school', weight: 6 },

  // Hauptschule
  { fromKey: 'edu.hauptschulabschluss', toKey: 'path.vocational_school', weight: 12 },
  { fromKey: 'edu.hauptschulabschluss', toKey: 'appr.electrician', weight: 10 },
  { fromKey: 'edu.hauptschulabschluss', toKey: 'appr.carpenter', weight: 9 },
  { fromKey: 'edu.hauptschulabschluss', toKey: 'appr.it_specialist', weight: 8 },
  { fromKey: 'edu.hauptschulabschluss', toKey: 'edu.realschulabschluss', weight: 7 },

  // Realschule
  { fromKey: 'edu.realschulabschluss', toKey: 'path.vocational_school', weight: 11 },
  { fromKey: 'edu.realschulabschluss', toKey: 'path.technical_college', weight: 10 },
  { fromKey: 'edu.realschulabschluss', toKey: 'path.high_school', weight: 9 },
  { fromKey: 'edu.realschulabschluss', toKey: 'appr.electrician', weight: 10 },
  { fromKey: 'edu.realschulabschluss', toKey: 'appr.it_specialist', weight: 9 },
  { fromKey: 'edu.realschulabschluss', toKey: 'appr.carpenter', weight: 8 },

  // Fachabitur / Abitur
  { fromKey: 'edu.fachabitur', toKey: 'path.applied_sciences', weight: 12 },
  { fromKey: 'edu.fachabitur', toKey: 'appr.it_specialist', weight: 8 },
  { fromKey: 'edu.fachabitur', toKey: 'study.mechanical_engineering', weight: 9 },
  { fromKey: 'edu.abitur', toKey: 'path.university', weight: 12 },
  { fromKey: 'edu.abitur', toKey: 'path.applied_sciences', weight: 10 },
  { fromKey: 'edu.abitur', toKey: 'study.mechanical_engineering', weight: 11 },
  { fromKey: 'edu.abitur', toKey: 'appr.it_specialist', weight: 6 },

  // Already completed Ausbildung
  { fromKey: 'edu.ausbildung', toKey: 'occ.electrician', weight: 8 },
  { fromKey: 'edu.ausbildung', toKey: 'cert.further_edu_trade', weight: 9 },
  { fromKey: 'edu.ausbildung', toKey: 'promo.master_craftsman_electrical', weight: 7 },
  { fromKey: 'edu.ausbildung', toKey: 'path.technical_college', weight: 8 },
  { fromKey: 'edu.ausbildung', toKey: 'path.applied_sciences', weight: 7 },

  // Higher education seeds
  { fromKey: 'edu.associate', toKey: 'path.applied_sciences', weight: 10 },
  { fromKey: 'edu.associate', toKey: 'edu.bachelors', weight: 9 },
  { fromKey: 'edu.bachelors', toKey: 'edu.masters', weight: 10 },
  { fromKey: 'edu.bachelors', toKey: 'occ.mechanical_engineer', weight: 9 },
  { fromKey: 'edu.bachelors', toKey: 'promo.engineering_manager', weight: 6 },
  { fromKey: 'edu.masters', toKey: 'edu.phd', weight: 8 },
  { fromKey: 'edu.masters', toKey: 'occ.mechanical_engineer', weight: 10 },
  { fromKey: 'edu.masters', toKey: 'promo.engineering_manager', weight: 9 },
  { fromKey: 'edu.phd', toKey: 'promo.engineering_manager', weight: 8 },
  { fromKey: 'edu.staatsexamen', toKey: 'path.university', weight: 5 },
  { fromKey: 'edu.professional', toKey: 'cert.further_edu_trade', weight: 7 },
  { fromKey: 'edu.professional', toKey: 'path.applied_sciences', weight: 6 },

  // Pathway nodes → next
  { fromKey: 'path.vocational_school', toKey: 'appr.electrician', weight: 12 },
  { fromKey: 'path.vocational_school', toKey: 'appr.carpenter', weight: 10 },
  { fromKey: 'path.vocational_school', toKey: 'appr.it_specialist', weight: 10 },
  { fromKey: 'path.high_school', toKey: 'edu.abitur', weight: 12 },
  { fromKey: 'path.technical_college', toKey: 'edu.fachabitur', weight: 12 },
  { fromKey: 'path.technical_college', toKey: 'path.applied_sciences', weight: 8 },
  { fromKey: 'path.university', toKey: 'study.mechanical_engineering', weight: 11 },
  { fromKey: 'path.university', toKey: 'edu.bachelors', weight: 10 },
  { fromKey: 'path.applied_sciences', toKey: 'study.mechanical_engineering', weight: 10 },
  { fromKey: 'path.applied_sciences', toKey: 'edu.bachelors', weight: 9 },

  // Electrician progression
  { fromKey: 'appr.electrician', toKey: 'occ.electrician', weight: 14 },
  { fromKey: 'occ.electrician', toKey: 'promo.master_craftsman_electrical', weight: 12 },
  { fromKey: 'occ.electrician', toKey: 'occ.building_technician', weight: 10 },
  { fromKey: 'occ.electrician', toKey: 'cert.further_edu_trade', weight: 8 },
  { fromKey: 'promo.master_craftsman_electrical', toKey: 'occ.business_owner_trade', weight: 12 },
  { fromKey: 'promo.master_craftsman_electrical', toKey: 'occ.building_technician', weight: 7 },
  { fromKey: 'occ.building_technician', toKey: 'path.applied_sciences', weight: 8 },
  { fromKey: 'cert.further_edu_trade', toKey: 'promo.master_craftsman_electrical', weight: 9 },

  // IT / carpenter apprenticeships
  { fromKey: 'appr.it_specialist', toKey: 'path.applied_sciences', weight: 8 },
  { fromKey: 'appr.it_specialist', toKey: 'cert.further_edu_trade', weight: 6 },
  { fromKey: 'appr.carpenter', toKey: 'promo.master_craftsman_electrical', weight: 5 },
  { fromKey: 'appr.carpenter', toKey: 'cert.further_edu_trade', weight: 8 },
  { fromKey: 'appr.carpenter', toKey: 'occ.business_owner_trade', weight: 7 },

  // Mechanical engineering
  { fromKey: 'study.mechanical_engineering', toKey: 'edu.bachelors', weight: 10 },
  { fromKey: 'study.mechanical_engineering', toKey: 'occ.mechanical_engineer', weight: 12 },
  { fromKey: 'occ.mechanical_engineer', toKey: 'promo.engineering_manager', weight: 12 },
  { fromKey: 'occ.mechanical_engineer', toKey: 'edu.masters', weight: 8 },
];

module.exports = {
  SEED_PIECES,
  SEED_EDGES,
  CATALOG_VERSION: 2,
};
