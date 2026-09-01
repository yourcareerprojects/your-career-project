/**
 * Configuration-driven identity trait catalog.
 * Traits are identity facets — never careers. Careers contribute evidence only.
 *
 * Each trait may declare:
 * - keywords: enrichment terms for trait embedding text
 * - relatedTraitIds: soft graph connections (strength grows with confidence)
 *
 * Semantic trait embeddings (text-embedding-3-large) are precomputed offline.
 * After changing traits here, regenerate: npm run build:identity-trait-embeddings
 * (see scripts/buildIdentityTraitEmbeddings.js)
 */

const { isIdentityCategory } = require('./identityCategories');

/** @typedef {{ en: string, de: string }} LocalizedString */

/**
 * @typedef {Object} IdentityTraitDefinition
 * @property {string} id
 * @property {string} category
 * @property {LocalizedString} name
 * @property {LocalizedString} description
 * @property {string[]} keywords
 * @property {string[]} relatedTraitIds
 */

/** @type {IdentityTraitDefinition[]} */
const IDENTITY_TRAIT_CATALOG = [
  {
    id: 'helping_others',
    category: 'values',
    name: { en: 'Helping Others', de: 'Anderen helfen' },
    description: {
      en: 'You feel fulfilled when your work supports, cares for, or improves life for other people.',
      de: 'Du fühlst dich erfüllt, wenn deine Arbeit andere Menschen unterstützt, betreut oder ihr Leben verbessert.',
    },
    keywords: [
      'help', 'helping', 'care', 'caring', 'support', 'nursing', 'patient', 'community',
      'volunteer', 'social', 'empathy', 'helfen', 'pflege', 'betreu', 'unterstütz', 'sozial',
    ],
    relatedTraitIds: ['empathy', 'teamwork', 'communication', 'making_impact'],
  },
  {
    id: 'empathy',
    category: 'social_orientation',
    name: { en: 'Empathy', de: 'Empathie' },
    description: {
      en: 'You naturally sense how others feel and factor that into decisions.',
      de: 'Du spürst natürlich, wie andere sich fühlen, und beziehst das in Entscheidungen ein.',
    },
    keywords: [
      'empathy', 'empath', 'listen', 'understanding people', 'emotional', 'compassion',
      'einfühl', 'zuhören', 'mitgefühl', 'verstehen',
    ],
    relatedTraitIds: ['helping_others', 'communication', 'teamwork'],
  },
  {
    id: 'teamwork',
    category: 'social_orientation',
    name: { en: 'Teamwork', de: 'Teamarbeit' },
    description: {
      en: 'You thrive when collaborating closely with others toward a shared goal.',
      de: 'Du blühst auf, wenn du eng mit anderen auf ein gemeinsames Ziel hinarbeitest.',
    },
    keywords: [
      'team', 'collaborate', 'collaboration', 'together', 'group', 'cooperation',
      'teamwork', 'teamarbeit', 'zusammenarbeit', 'gemeinsam', 'gruppe',
    ],
    relatedTraitIds: ['communication', 'leadership', 'helping_others'],
  },
  {
    id: 'working_independently',
    category: 'work_style',
    name: { en: 'Working Independently', de: 'Selbstständiges Arbeiten' },
    description: {
      en: 'You prefer autonomy and deep focus without constant coordination.',
      de: 'Du bevorzugst Autonomie und tiefes Arbeiten ohne ständige Abstimmung.',
    },
    keywords: [
      'independent', 'alone', 'autonomy', 'self-directed', 'solo', 'remote focus',
      'selbstständig', 'eigenständig', 'allein', 'autonom',
    ],
    relatedTraitIds: ['precision', 'analytical_thinking', 'continuous_learning'],
  },
  {
    id: 'communication',
    category: 'communication',
    name: { en: 'Communicating Ideas', de: 'Ideen vermitteln' },
    description: {
      en: 'You enjoy explaining, presenting, writing, or translating ideas for others.',
      de: 'Du erklärst, präsentierst, schreibst oder übersetzt gern Ideen für andere.',
    },
    keywords: [
      'communicate', 'communication', 'present', 'writing', 'explain', 'storytell',
      'speak', 'teach', 'mediate', 'kommuniz', 'präsentieren', 'schreiben', 'erklären',
      'vortragen', 'vermitteln',
    ],
    relatedTraitIds: ['empathy', 'leadership', 'creativity'],
  },
  {
    id: 'leadership',
    category: 'leadership',
    name: { en: 'Leading Others', de: 'Andere führen' },
    description: {
      en: 'You like setting direction, coordinating people, and taking responsibility.',
      de: 'Du gibst gern Richtung vor, koordinierst Menschen und übernimmst Verantwortung.',
    },
    keywords: [
      'lead', 'leadership', 'manage', 'manager', 'mentor', 'coordinate', 'responsibility',
      'direct', 'führen', 'leitung', 'führen', 'verantwortung', 'koordinieren', 'mentor',
    ],
    relatedTraitIds: ['communication', 'teamwork', 'making_impact', 'long_term_planning'],
  },
  {
    id: 'analytical_thinking',
    category: 'thinking_style',
    name: { en: 'Analytical Thinking', de: 'Analytisches Denken' },
    description: {
      en: 'You enjoy breaking problems into parts, spotting patterns, and reasoning carefully.',
      de: 'Du zerlegst Probleme gern, erkennst Muster und denkst sorgfältig nach.',
    },
    keywords: [
      'analy', 'logic', 'data', 'research', 'investigate', 'pattern', 'math', 'statistics',
      'reason', 'analytisch', 'logik', 'daten', 'forschung', 'mathematik', 'statistik',
    ],
    relatedTraitIds: ['complex_problem_solving', 'precision', 'technology'],
  },
  {
    id: 'complex_problem_solving',
    category: 'problem_solving',
    name: { en: 'Solving Complex Problems', de: 'Komplexe Probleme lösen' },
    description: {
      en: 'You are energized by hard, multi-step challenges without an obvious answer.',
      de: 'Dich motivieren schwierige, mehrstufige Herausforderungen ohne offensichtliche Lösung.',
    },
    keywords: [
      'problem', 'challenge', 'complex', 'troubleshoot', 'debug', 'solve', 'puzzle',
      'problem lösen', 'herausforderung', 'komplex', 'lösen', 'kniffelig',
    ],
    relatedTraitIds: ['analytical_thinking', 'practical_work', 'creativity'],
  },
  {
    id: 'practical_work',
    category: 'work_style',
    name: { en: 'Practical Work', de: 'Praktische Arbeit' },
    description: {
      en: 'You prefer hands-on, tangible work over purely abstract tasks.',
      de: 'Du bevorzugst praktische, greifbare Arbeit gegenüber rein abstrakten Aufgaben.',
    },
    keywords: [
      'practical', 'hands-on', 'manual', 'build', 'craft', 'fix', 'workshop', 'physical',
      'praktisch', 'handwerk', 'bauen', 'greifen', 'werkstatt', 'körperlich',
    ],
    relatedTraitIds: ['building_things', 'working_outdoors', 'precision'],
  },
  {
    id: 'building_things',
    category: 'interests',
    name: { en: 'Building Things', de: 'Dinge erschaffen' },
    description: {
      en: 'You enjoy creating products, structures, systems, or artifacts that did not exist before.',
      de: 'Du schaffst gern Produkte, Strukturen, Systeme oder Artefakte, die es vorher nicht gab.',
    },
    keywords: [
      'build', 'create', 'make', 'construct', 'develop', 'prototype', 'craft',
      'bauen', 'erschaffen', 'herstellen', 'entwickeln', 'prototyp',
    ],
    relatedTraitIds: ['creativity', 'practical_work', 'technology'],
  },
  {
    id: 'creativity',
    category: 'thinking_style',
    name: { en: 'Creativity', de: 'Kreativität' },
    description: {
      en: 'You need room to invent, design, or express original ideas in your work.',
      de: 'Du brauchst Raum, um zu erfinden, zu gestalten oder eigene Ideen auszudrücken.',
    },
    keywords: [
      'creat', 'design', 'art', 'imagin', 'innov', 'original', 'visual', 'aesthetic',
      'kreativ', 'gestaltung', 'kunst', 'idee', 'innovativ', 'visuell', 'ästhetik',
    ],
    relatedTraitIds: ['building_things', 'exploring_ideas', 'communication', 'creative_problem_solving', 'creative_studio', 'creative_expression_motivation'],
  },
  {
    id: 'structure_and_order',
    category: 'work_style',
    name: { en: 'Structure & Order', de: 'Struktur & Ordnung' },
    description: {
      en: 'You prefer clear processes, predictable systems, and well-organized work.',
      de: 'Du bevorzugst klare Prozesse, vorhersehbare Systeme und gut organisierte Arbeit.',
    },
    keywords: [
      'structure', 'order', 'organiz', 'process', 'system', 'routine', 'plan', 'checklist',
      'struktur', 'ordnung', 'organisieren', 'prozess', 'system', 'routine', 'planen',
    ],
    relatedTraitIds: ['organizing', 'precision', 'long_term_planning'],
  },
  {
    id: 'organizing',
    category: 'strengths',
    name: { en: 'Organizing', de: 'Organisieren' },
    description: {
      en: 'You are strong at coordinating details, schedules, and moving parts into coherence.',
      de: 'Du bist stark darin, Details, Termine und bewegliche Teile in Einklang zu bringen.',
    },
    keywords: [
      'organiz', 'coordinate', 'schedule', 'logistics', 'admin', 'arrange',
      'organisieren', 'koordinieren', 'planen', 'logistik', 'verwaltung',
    ],
    relatedTraitIds: ['structure_and_order', 'leadership', 'precision'],
  },
  {
    id: 'precision',
    category: 'strengths',
    name: { en: 'Precision', de: 'Präzision' },
    description: {
      en: 'You care about accuracy, quality, and getting the details right.',
      de: 'Dir liegen Genauigkeit, Qualität und die richtigen Details am Herzen.',
    },
    keywords: [
      'precision', 'accurate', 'detail', 'quality', 'exact', 'careful', 'meticulous',
      'präzis', 'genau', 'detail', 'qualität', 'sorgfältig', 'exakt',
    ],
    relatedTraitIds: ['analytical_thinking', 'structure_and_order', 'practical_work'],
  },
  {
    id: 'technology',
    category: 'interests',
    name: { en: 'Technology', de: 'Technologie' },
    description: {
      en: 'You are drawn to digital tools, systems, and technical craft.',
      de: 'Dich ziehen digitale Werkzeuge, Systeme und technische Arbeit an.',
    },
    keywords: [
      'tech', 'software', 'code', 'digital', 'computer', 'IT', 'programming', 'system',
      'technologie', 'software', 'programm', 'digital', 'computer', 'informatik',
    ],
    relatedTraitIds: ['analytical_thinking', 'building_things', 'continuous_learning'],
  },
  {
    id: 'continuous_learning',
    category: 'learning',
    name: { en: 'Continuous Learning', de: 'Kontinuierliches Lernen' },
    description: {
      en: 'You stay curious and enjoy growing skills throughout your career.',
      de: 'Du bleibst neugierig und entwickelst deine Fähigkeiten gern weiter.',
    },
    keywords: [
      'learn', 'learning', 'curious', 'study', 'grow', 'develop', 'knowledge', 'explore',
      'lernen', 'neugierig', 'studieren', 'entwickeln', 'wissen', 'weiterbildung',
    ],
    relatedTraitIds: ['exploring_ideas', 'technology', 'analytical_thinking'],
  },
  {
    id: 'exploring_ideas',
    category: 'interests',
    name: { en: 'Exploring New Ideas', de: 'Neue Ideen erkunden' },
    description: {
      en: 'You like open-ended discovery, novelty, and intellectual exploration.',
      de: 'Du magst offene Entdeckung, Neues und intellektuelle Erkundung.',
    },
    keywords: [
      'explor', 'idea', 'novel', 'curious', 'discover', 'experiment', 'open-ended',
      'erkunden', 'idee', 'neu', 'entdecken', 'experiment', 'neugierig',
    ],
    relatedTraitIds: ['creativity', 'continuous_learning', 'complex_problem_solving'],
  },
  {
    id: 'making_impact',
    category: 'motivation',
    name: { en: 'Making an Impact', de: 'Wirkung erzielen' },
    description: {
      en: 'You want your work to matter — to change outcomes for people, society, or the planet.',
      de: 'Deine Arbeit soll Wirkung haben — für Menschen, Gesellschaft oder den Planeten.',
    },
    keywords: [
      'impact', 'change', 'purpose', 'meaning', 'difference', 'mission', 'cause', 'society',
      'wirkung', 'sinn', 'zweck', 'verändern', 'gesellschaft', 'beitrag', 'mission',
    ],
    relatedTraitIds: ['helping_others', 'leadership', 'long_term_planning'],
  },
  {
    id: 'working_outdoors',
    category: 'environment',
    name: { en: 'Working Outdoors', de: 'Arbeit im Freien' },
    description: {
      en: 'You prefer environments outside an office — nature, field work, or open spaces.',
      de: 'Du bevorzugst Umgebungen außerhalb des Büros — Natur, Feldarbeit oder Freiraum.',
    },
    keywords: [
      'outdoor', 'nature', 'field', 'outside', 'fresh air', 'environment', 'garden',
      'draußen', 'natur', 'feld', 'umwelt', 'garten', 'freiluft',
    ],
    relatedTraitIds: ['practical_work', 'working_under_pressure'],
  },
  {
    id: 'working_under_pressure',
    category: 'work_style',
    name: { en: 'Working Under Pressure', de: 'Arbeit unter Druck' },
    description: {
      en: 'You stay effective in urgent, high-stakes, or fast-changing situations.',
      de: 'Du bleibst in dringenden, risikoreichen oder schnell wechselnden Situationen handlungsfähig.',
    },
    keywords: [
      'pressure', 'urgent', 'emergency', 'fast', 'stress', 'crisis', 'deadline', 'intense',
      'druck', 'notfall', 'schnell', 'stress', 'krise', 'frist', 'intensiv',
    ],
    relatedTraitIds: ['practical_work', 'helping_others', 'teamwork'],
  },
  {
    id: 'long_term_planning',
    category: 'thinking_style',
    name: { en: 'Long-Term Planning', de: 'Langfristige Planung' },
    description: {
      en: 'You think ahead, sequence milestones, and design for the future.',
      de: 'Du denkst voraus, setzt Meilensteine und gestaltest für die Zukunft.',
    },
    keywords: [
      'plan', 'strategy', 'long-term', 'future', 'roadmap', 'vision', 'foresight',
      'planen', 'strategie', 'langfristig', 'zukunft', 'vision', 'fahrplan',
    ],
    relatedTraitIds: ['structure_and_order', 'leadership', 'making_impact'],
  },
  {
    id: 'spatial_thinking',
    category: 'thinking_style',
    name: { en: 'Spatial Thinking', de: 'Räumliches Denken' },
    description: {
      en: 'You visualize spaces, forms, and how things fit together in three dimensions.',
      de: 'Du visualisierst Räume, Formen und wie Dinge dreidimensional zusammenpassen.',
    },
    keywords: [
      'spatial', 'space', '3d', 'geometry', 'layout', 'architecture', 'visual', 'map',
      'räumlich', 'raum', 'geometrie', 'architektur', 'layout', 'visuell',
    ],
    relatedTraitIds: ['creativity', 'building_things', 'analytical_thinking'],
  },
  {
    id: 'visual_communication',
    category: 'communication',
    name: { en: 'Visual Communication', de: 'Visuelle Kommunikation' },
    description: {
      en: 'You express ideas through images, layouts, diagrams, or visual design.',
      de: 'Du vermittelst Ideen durch Bilder, Layouts, Diagramme oder visuelles Design.',
    },
    keywords: [
      'visual', 'design', 'graphic', 'image', 'illustration', 'diagram', 'ui', 'ux',
      'visuell', 'design', 'grafik', 'bild', 'illustration', 'diagramm',
    ],
    relatedTraitIds: ['creativity', 'communication', 'spatial_thinking'],
  },
  {
    id: 'integrity',
    category: 'values',
    name: { en: 'Integrity', de: 'Integrität' },
    description: {
      en: 'You act with honesty and ethical consistency in professional decisions.',
      de: 'Du handelst ehrlich und ethisch konsequent in beruflichen Entscheidungen.',
    },
    keywords: [
      'integrity', 'honest', 'ethics', 'ethical', 'trustworthy', 'principle', 'moral',
      'integrität', 'ehrlich', 'ethik', 'vertrauenswürdig', 'prinzip', 'moral',
    ],
    relatedTraitIds: ['accountability', 'transparency', 'helping_others'],
  },
  {
    id: 'fairness',
    category: 'values',
    name: { en: 'Fairness', de: 'Gerechtigkeit' },
    description: {
      en: 'You value equitable treatment and balanced outcomes for everyone involved.',
      de: 'Dir sind faire Behandlung und ausgewogene Ergebnisse für alle Beteiligten wichtig.',
    },
    keywords: [
      'fair', 'fairness', 'equitable', 'equal', 'impartial', 'just', 'balance',
      'fair', 'gerecht', 'gleich', 'unparteiisch', 'ausgewogen',
    ],
    relatedTraitIds: ['respect_for_diversity', 'inclusive_leadership', 'helping_others'],
  },
  {
    id: 'excellence',
    category: 'values',
    name: { en: 'Excellence', de: 'Exzellenz' },
    description: {
      en: 'You strive for high standards and quality in everything you deliver.',
      de: 'Du strebst hohe Standards und Qualität in allem an, was du lieferst.',
    },
    keywords: [
      'excellence', 'quality', 'high standard', 'best', 'strive', 'master', 'top',
      'exzellenz', 'qualität', 'hoher standard', 'beste', 'streben', 'spitze',
    ],
    relatedTraitIds: ['precision', 'achievement_drive', 'mastery_motivation'],
  },
  {
    id: 'stewardship',
    category: 'values',
    name: { en: 'Stewardship', de: 'Verantwortungsvolle Führung' },
    description: {
      en: 'You take responsible care of resources, people, or missions entrusted to you.',
      de: 'Du übernimmst verantwortungsvoll die Pflege von Ressourcen, Menschen oder Aufträgen.',
    },
    keywords: [
      'stewardship', 'responsible', 'custody', 'guardian', 'trust', 'care for',
      'verantwortung', 'verantwortungsvoll', 'hüten', 'vertrauen', 'sorgen',
    ],
    relatedTraitIds: ['accountability', 'sustainability_values', 'leadership'],
  },
  {
    id: 'sustainability_values',
    category: 'values',
    name: { en: 'Sustainability', de: 'Nachhaltigkeit' },
    description: {
      en: 'You care about long-term environmental and social responsibility in your work.',
      de: 'Dir liegt langfristige ökologische und soziale Verantwortung in deiner Arbeit am Herzen.',
    },
    keywords: [
      'sustainab', 'environment', 'green', 'climate', 'eco', 'social responsibility', 'long-term',
      'nachhaltig', 'umwelt', 'klima', 'ökolog', 'soziale verantwortung', 'langfristig',
    ],
    relatedTraitIds: ['making_impact', 'stewardship', 'sustainability_topics'],
  },
  {
    id: 'customer_focus',
    category: 'values',
    name: { en: 'Customer Focus', de: 'Kundenorientierung' },
    description: {
      en: 'You put user or client needs at the center of your decisions and work.',
      de: 'Du stellst Nutzer- oder Kundenbedürfnisse in den Mittelpunkt deiner Entscheidungen.',
    },
    keywords: [
      'customer', 'client', 'user', 'service', 'user-centric', 'client-focused', 'stakeholder',
      'kunde', 'kunden', 'nutzer', 'service', 'kundenorientiert', 'nutzerzentriert',
    ],
    relatedTraitIds: ['helping_others', 'service_orientation', 'customer_relations'],
  },
  {
    id: 'accountability',
    category: 'values',
    name: { en: 'Accountability', de: 'Verantwortlichkeit' },
    description: {
      en: 'You take ownership of outcomes and follow through on your commitments.',
      de: 'Du übernimmst Verantwortung für Ergebnisse und hältst deine Zusagen ein.',
    },
    keywords: [
      'accountab', 'ownership', 'responsible', 'commitment', 'follow through', 'answerable',
      'verantwortlich', 'eigenverantwortung', 'zusage', 'verpflichtung', 'rechenschaft',
    ],
    relatedTraitIds: ['integrity', 'reliability', 'accountability_leadership'],
  },
  {
    id: 'respect_for_diversity',
    category: 'values',
    name: { en: 'Respect for Diversity', de: 'Respekt vor Vielfalt' },
    description: {
      en: 'You value different backgrounds, perspectives, and experiences in the workplace.',
      de: 'Du schätzt unterschiedliche Hintergründe, Perspektiven und Erfahrungen am Arbeitsplatz.',
    },
    keywords: [
      'divers', 'inclusion', 'inclusive', 'multicultural', 'respect', 'different background',
      'vielfalt', 'inklusion', 'inklusiv', 'multikulturell', 'respekt', 'unterschied',
    ],
    relatedTraitIds: ['fairness', 'inclusive_leadership', 'cultural_sensitivity'],
  },
  {
    id: 'transparency',
    category: 'values',
    name: { en: 'Transparency', de: 'Transparenz' },
    description: {
      en: 'You prefer open, honest sharing of information and intent with colleagues.',
      de: 'Du bevorzugst offene, ehrliche Weitergabe von Informationen und Absichten.',
    },
    keywords: [
      'transparen', 'open', 'honest', 'clear', 'visible', 'share information',
      'transparenz', 'offen', 'ehrlich', 'klar', 'sichtbar', 'information teilen',
    ],
    relatedTraitIds: ['integrity', 'communication', 'accountability'],
  },
  {
    id: 'work_life_balance',
    category: 'values',
    name: { en: 'Work-Life Balance', de: 'Work-Life-Balance' },
    description: {
      en: 'You value a sustainable pace and healthy boundaries between work and personal life.',
      de: 'Dir sind ein nachhaltiges Tempo und gesunde Grenzen zwischen Arbeit und Privatleben wichtig.',
    },
    keywords: [
      'work-life', 'balance', 'boundaries', 'sustainable pace', 'wellbeing', 'flexible hours',
      'work-life-balance', 'balance', 'grenzen', 'nachhaltig', 'wohlbefinden', 'flexibel',
    ],
    relatedTraitIds: ['security_stability', 'hybrid_flexibility', 'remote_flexibility'],
  },
  {
    id: 'community_contribution',
    category: 'values',
    name: { en: 'Community Contribution', de: 'Gemeinschaftlicher Beitrag' },
    description: {
      en: 'You want your work to benefit the broader community beyond your immediate team.',
      de: 'Du möchtest, dass deine Arbeit der breiteren Gemeinschaft über dein Team hinaus nützt.',
    },
    keywords: [
      'community', 'contribute', 'civic', 'public good', 'society', 'volunteer', 'local',
      'gemeinschaft', 'beitrag', 'zivil', 'gesellschaft', 'öffentlich', 'lokal',
    ],
    relatedTraitIds: ['helping_others', 'making_impact', 'community_engagement'],
  },
  {
    id: 'dedication',
    category: 'values',
    name: { en: 'Dedication', de: 'Hingabe' },
    description: {
      en: 'You commit deeply to missions and causes you believe in at work.',
      de: 'Du engagierst dich tief für Aufträge und Anliegen, an die du bei der Arbeit glaubst.',
    },
    keywords: [
      'dedicat', 'commitment', 'devoted', 'passionate', 'loyal', 'invested', 'purpose',
      'hingabe', 'engagement', 'hingebungsvoll', 'leidenschaft', 'loyal', 'zielstrebig',
    ],
    relatedTraitIds: ['making_impact', 'mastery_motivation', 'reliability'],
  },
  {
    id: 'business_strategy',
    category: 'interests',
    name: { en: 'Business Strategy', de: 'Unternehmensstrategie' },
    description: {
      en: 'You are interested in markets, competition, and how organizations grow.',
      de: 'Dich interessieren Märkte, Wettbewerb und wie Organisationen wachsen.',
    },
    keywords: [
      'business', 'strategy', 'market', 'competition', 'growth', 'commercial', 'enterprise',
      'geschäft', 'strategie', 'markt', 'wettbewerb', 'wachstum', 'unternehmen',
    ],
    relatedTraitIds: ['strategic_thinking', 'finance_economics', 'leadership'],
  },
  {
    id: 'science_research',
    category: 'interests',
    name: { en: 'Science & Research', de: 'Wissenschaft & Forschung' },
    description: {
      en: 'You are drawn to scientific inquiry and evidence-based discovery.',
      de: 'Dich zieht wissenschaftliche Forschung und evidenzbasierte Entdeckung an.',
    },
    keywords: [
      'science', 'research', 'laboratory', 'experiment', 'hypothesis', 'scientific', 'study',
      'wissenschaft', 'forschung', 'labor', 'experiment', 'hypothese', 'wissenschaftlich',
    ],
    relatedTraitIds: ['analytical_thinking', 'experimentation', 'exploring_ideas'],
  },
  {
    id: 'education_training',
    category: 'interests',
    name: { en: 'Education & Training', de: 'Bildung & Training' },
    description: {
      en: 'You are interested in teaching, coaching, and developing others professionally.',
      de: 'Dich interessieren Unterricht, Coaching und die berufliche Entwicklung anderer.',
    },
    keywords: [
      'education', 'teach', 'training', 'coach', 'learning', 'instruction', 'mentor',
      'bildung', 'lehren', 'training', 'coaching', 'lernen', 'unterricht', 'mentor',
    ],
    relatedTraitIds: ['teaching_others', 'mentoring_leadership', 'communication'],
  },
  {
    id: 'health_wellbeing',
    category: 'interests',
    name: { en: 'Health & Wellbeing', de: 'Gesundheit & Wohlbefinden' },
    description: {
      en: 'You are interested in health, wellness, and care for human wellbeing.',
      de: 'Dich interessieren Gesundheit, Wohlbefinden und die Fürsorge für Menschen.',
    },
    keywords: [
      'health', 'wellness', 'wellbeing', 'care', 'medical', 'therapy', 'nutrition',
      'gesundheit', 'wohlbefinden', 'pflege', 'medizin', 'therapie', 'ernährung',
    ],
    relatedTraitIds: ['helping_others', 'science_research', 'service_orientation'],
  },
  {
    id: 'finance_economics',
    category: 'interests',
    name: { en: 'Finance & Economics', de: 'Finanzen & Wirtschaft' },
    description: {
      en: 'You are interested in money, markets, and economic systems.',
      de: 'Dich interessieren Geld, Märkte und wirtschaftliche Zusammenhänge.',
    },
    keywords: [
      'finance', 'economic', 'money', 'investment', 'budget', 'accounting', 'banking',
      'finanz', 'wirtschaft', 'geld', 'investition', 'budget', 'buchhaltung', 'bank',
    ],
    relatedTraitIds: ['quantitative_thinking', 'business_strategy', 'risk_assessment'],
  },
  {
    id: 'law_regulation',
    category: 'interests',
    name: { en: 'Law & Regulation', de: 'Recht & Regulierung' },
    description: {
      en: 'You are interested in rules, compliance, and legal frameworks.',
      de: 'Dich interessieren Regeln, Compliance und rechtliche Rahmenbedingungen.',
    },
    keywords: [
      'law', 'legal', 'regulation', 'compliance', 'policy', 'contract', 'governance',
      'recht', 'legal', 'regulierung', 'compliance', 'richtlinie', 'vertrag', 'governance',
    ],
    relatedTraitIds: ['policy_governance', 'integrity', 'critical_thinking'],
  },
  {
    id: 'media_storytelling',
    category: 'interests',
    name: { en: 'Media & Storytelling', de: 'Medien & Storytelling' },
    description: {
      en: 'You are interested in content creation, journalism, and narrative.',
      de: 'Dich interessieren Content-Erstellung, Journalismus und Erzählformen.',
    },
    keywords: [
      'media', 'journalism', 'content', 'story', 'broadcast', 'publish', 'editorial',
      'medien', 'journalismus', 'content', 'story', 'veröffentlichen', 'redaktion',
    ],
    relatedTraitIds: ['storytelling', 'creativity', 'communication'],
  },
  {
    id: 'sustainability_topics',
    category: 'interests',
    name: { en: 'Sustainability Topics', de: 'Nachhaltigkeitsthemen' },
    description: {
      en: 'You are interested in environmental and social sustainability work.',
      de: 'Dich interessiert Arbeit zu ökologischer und sozialer Nachhaltigkeit.',
    },
    keywords: [
      'sustainab', 'environment', 'climate', 'renewable', 'circular', 'ESG', 'green',
      'nachhaltig', 'umwelt', 'klima', 'erneuerbar', 'kreislauf', 'grün',
    ],
    relatedTraitIds: ['sustainability_values', 'making_impact', 'science_research'],
  },
  {
    id: 'data_insights',
    category: 'interests',
    name: { en: 'Data & Insights', de: 'Daten & Erkenntnisse' },
    description: {
      en: 'You are interested in finding patterns and insights in information.',
      de: 'Dich interessiert es, Muster und Erkenntnisse in Informationen zu finden.',
    },
    keywords: [
      'data', 'insight', 'analytics', 'dashboard', 'metrics', 'reporting', 'BI',
      'daten', 'erkenntnis', 'analytik', 'dashboard', 'kennzahl', 'reporting',
    ],
    relatedTraitIds: ['analytical_thinking', 'quantitative_thinking', 'technology'],
  },
  {
    id: 'policy_governance',
    category: 'interests',
    name: { en: 'Policy & Governance', de: 'Politik & Governance' },
    description: {
      en: 'You are interested in public policy and institutional governance.',
      de: 'Dich interessieren öffentliche Politik und institutionelle Governance.',
    },
    keywords: [
      'policy', 'governance', 'public sector', 'government', 'institution', 'regulation',
      'politik', 'governance', 'öffentlich', 'regierung', 'institution', 'regulierung',
    ],
    relatedTraitIds: ['law_regulation', 'stakeholder_analysis', 'making_impact'],
  },
  {
    id: 'reliability',
    category: 'strengths',
    name: { en: 'Reliability', de: 'Zuverlässigkeit' },
    description: {
      en: 'You consistently deliver on commitments and meet deadlines others can count on.',
      de: 'Du hältst Zusagen zuverlässig ein und erfüllst Fristen, auf die andere zählen können.',
    },
    keywords: [
      'reliab', 'dependable', 'consistent', 'trustworthy', 'deadline', 'deliver', 'commitment',
      'zuverlässig', 'verlässlich', 'konsequent', 'frist', 'liefern', 'zusage',
    ],
    relatedTraitIds: ['accountability', 'consistency', 'precision'],
  },
  {
    id: 'adaptability',
    category: 'strengths',
    name: { en: 'Adaptability', de: 'Anpassungsfähigkeit' },
    description: {
      en: 'You adjust quickly when priorities, tools, or conditions change.',
      de: 'Du passt dich schnell an, wenn Prioritäten, Werkzeuge oder Bedingungen sich ändern.',
    },
    keywords: [
      'adapt', 'flexible', 'adjust', 'change', 'versatile', 'agile', 'pivot',
      'anpassungsfähig', 'flexibel', 'anpassen', 'wandel', 'vielseitig', 'agil',
    ],
    relatedTraitIds: ['resilience', 'fast_paced_work', 'working_under_pressure'],
  },
  {
    id: 'resilience',
    category: 'strengths',
    name: { en: 'Resilience', de: 'Resilienz' },
    description: {
      en: 'You bounce back from setbacks and stay productive through difficulty.',
      de: 'Du erholst dich von Rückschlägen und bleibst auch in schwierigen Phasen produktiv.',
    },
    keywords: [
      'resilien', 'bounce back', 'recover', 'persever', 'endur', 'grit', 'setback',
      'resilienz', 'erholen', 'durchhalten', 'ausdauer', 'rückschlag', 'durchziehen',
    ],
    relatedTraitIds: ['calm_composure', 'working_under_pressure', 'learning_from_failure'],
  },
  {
    id: 'persuasion',
    category: 'strengths',
    name: { en: 'Persuasion', de: 'Überzeugungskraft' },
    description: {
      en: 'You influence others through compelling reasoning and clear benefits.',
      de: 'Du beeinflusst andere durch überzeugende Argumente und klare Vorteile.',
    },
    keywords: [
      'persuad', 'convinc', 'influence', 'win over', 'sell', 'advocate', 'pitch',
      'überzeugen', 'beeinflussen', 'verkaufen', 'vertreten', 'pitch', 'argument',
    ],
    relatedTraitIds: ['persuasive_communication', 'negotiation', 'communication'],
  },
  {
    id: 'negotiation',
    category: 'strengths',
    name: { en: 'Negotiation', de: 'Verhandlung' },
    description: {
      en: 'You find workable agreements between parties with different interests.',
      de: 'Du findest tragfähige Vereinbarungen zwischen Parteien mit unterschiedlichen Interessen.',
    },
    keywords: [
      'negotiat', 'bargain', 'deal', 'agreement', 'compromise', 'mediate', 'terms',
      'verhandeln', 'einigung', 'kompromiss', 'vermitteln', 'bedingungen', 'deal',
    ],
    relatedTraitIds: ['persuasion', 'diplomatic_communication', 'consensus_building'],
  },
  {
    id: 'mentoring_strength',
    category: 'strengths',
    name: { en: 'Mentoring', de: 'Mentoring' },
    description: {
      en: 'You develop others through guidance, feedback, and shared experience.',
      de: 'Du entwickelst andere durch Anleitung, Feedback und gemeinsame Erfahrung.',
    },
    keywords: [
      'mentor', 'guide', 'develop others', 'coach', 'advise', 'support growth', 'teach',
      'mentor', 'anleiten', 'entwickeln', 'coachen', 'beraten', 'wachstum', 'lehren',
    ],
    relatedTraitIds: ['mentoring_leadership', 'coaching', 'teaching_others'],
  },
  {
    id: 'time_management',
    category: 'strengths',
    name: { en: 'Time Management', de: 'Zeitmanagement' },
    description: {
      en: 'You use time effectively and prioritize what matters most.',
      de: 'Du nutzt Zeit effektiv und priorisierst, was am wichtigsten ist.',
    },
    keywords: [
      'time management', 'priorit', 'schedule', 'deadline', 'efficient', 'organize time',
      'zeitmanagement', 'priorisieren', 'termin', 'frist', 'effizient', 'planen',
    ],
    relatedTraitIds: ['organizing', 'prioritization', 'reliability'],
  },
  {
    id: 'resourcefulness',
    category: 'strengths',
    name: { en: 'Resourcefulness', de: 'Einfallsreichtum' },
    description: {
      en: 'You find practical solutions even when resources or information are limited.',
      de: 'Du findest praktische Lösungen, auch wenn Ressourcen oder Informationen begrenzt sind.',
    },
    keywords: [
      'resourceful', 'ingenious', 'workaround', 'make do', 'creative solution', 'improvise',
      'einfallsreich', 'findig', 'lösung', 'improvisieren', 'kreativ', 'workaround',
    ],
    relatedTraitIds: ['initiative', 'pragmatic_solutions', 'creativity'],
  },
  {
    id: 'calm_composure',
    category: 'strengths',
    name: { en: 'Calm Composure', de: 'Gelassenheit' },
    description: {
      en: 'You stay steady and clear-headed when situations become stressful.',
      de: 'Du bleibst ruhig und klar im Kopf, wenn Situationen stressig werden.',
    },
    keywords: [
      'calm', 'composure', 'steady', 'poised', 'level-headed', 'unflappable', 'cool',
      'gelassen', 'ruhig', 'ausgeglichen', 'besonnen', 'cool', 'standhaft',
    ],
    relatedTraitIds: ['working_under_pressure', 'resilience', 'diplomatic_communication'],
  },
  {
    id: 'consistency',
    category: 'strengths',
    name: { en: 'Consistency', de: 'Beständigkeit' },
    description: {
      en: 'You deliver steady quality over time without big swings in performance.',
      de: 'Du lieferst über die Zeit hinweg gleichbleibende Qualität ohne große Leistungsschwankungen.',
    },
    keywords: [
      'consisten', 'steady', 'reliable', 'uniform', 'predictable quality', 'stable output',
      'beständig', 'konstant', 'gleichmäßig', 'stabil', 'verlässlich', 'qualität',
    ],
    relatedTraitIds: ['reliability', 'precision', 'methodical_pace'],
  },
  {
    id: 'initiative',
    category: 'strengths',
    name: { en: 'Initiative', de: 'Eigeninitiative' },
    description: {
      en: 'You spot opportunities and act without waiting to be told what to do.',
      de: 'Du erkennst Chancen und handelst, ohne darauf zu warten, dass dir gesagt wird, was zu tun ist.',
    },
    keywords: [
      'initiative', 'proactive', 'self-starter', 'take charge', 'act first', 'drive',
      'initiative', 'proaktiv', 'selbststarter', 'übernehmen', 'antreiben', 'anpacken',
    ],
    relatedTraitIds: ['leadership', 'resourcefulness', 'achievement_drive'],
  },
  {
    id: 'fast_paced_work',
    category: 'work_style',
    name: { en: 'Fast-Paced Work', de: 'Hohes Arbeitstempo' },
    description: {
      en: 'You thrive in dynamic environments with rapid change and tight timelines.',
      de: 'Du blühst in dynamischen Umgebungen mit schnellem Wandel und engen Zeitplänen auf.',
    },
    keywords: [
      'fast-paced', 'dynamic', 'rapid', 'quick', 'speed', 'agile', 'high tempo',
      'schnell', 'dynamisch', 'hohes tempo', 'agil', 'zügig', 'hektisch',
    ],
    relatedTraitIds: ['adaptability', 'working_under_pressure', 'startup_culture'],
  },
  {
    id: 'methodical_pace',
    category: 'work_style',
    name: { en: 'Methodical Pace', de: 'Methodisches Tempo' },
    description: {
      en: 'You prefer careful, step-by-step progress over rushing to finish.',
      de: 'Du bevorzugst sorgfältigen, schrittweisen Fortschritt statt hetzenden Abschluss.',
    },
    keywords: [
      'methodical', 'step-by-step', 'careful', 'deliberate', 'thorough', 'measured',
      'methodisch', 'schrittweise', 'sorgfältig', 'bedacht', 'gründlich', 'gemessen',
    ],
    relatedTraitIds: ['structure_and_order', 'precision', 'consistency'],
  },
  {
    id: 'remote_flexibility',
    category: 'work_style',
    name: { en: 'Remote Flexibility', de: 'Remote-Flexibilität' },
    description: {
      en: 'You work effectively from varied locations without losing focus or output.',
      de: 'Du arbeitest effektiv von verschiedenen Orten aus, ohne Fokus oder Leistung zu verlieren.',
    },
    keywords: [
      'remote', 'work from home', 'distributed', 'virtual', 'telecommute', 'anywhere',
      'remote', 'homeoffice', 'verteilt', 'virtuell', 'mobil', 'ortsunabhängig',
    ],
    relatedTraitIds: ['working_independently', 'hybrid_flexibility', 'self_directed_learning'],
  },
  {
    id: 'routine_preference',
    category: 'work_style',
    name: { en: 'Routine Preference', de: 'Routineorientierung' },
    description: {
      en: 'You prefer predictable daily patterns that let you build efficient habits.',
      de: 'Du bevorzugst vorhersehbare Tagesabläufe, die effiziente Gewohnheiten ermöglichen.',
    },
    keywords: [
      'routine', 'predictable', 'habit', 'regular', 'pattern', 'repeatable', 'stable day',
      'routine', 'vorhersehbar', 'gewohnheit', 'regelmäßig', 'wiederholbar', 'stabil',
    ],
    relatedTraitIds: ['structure_and_order', 'consistency', 'security_stability'],
  },
  {
    id: 'project_based_work',
    category: 'work_style',
    name: { en: 'Project-Based Work', de: 'Projektbasiertes Arbeiten' },
    description: {
      en: 'You enjoy defined projects with a clear start, milestones, and completion.',
      de: 'Du magst klar abgegrenzte Projekte mit Anfang, Meilensteinen und Abschluss.',
    },
    keywords: [
      'project', 'milestone', 'deliverable', 'scope', 'kickoff', 'closure', 'sprint',
      'projekt', 'meilenstein', 'liefergegenstand', 'umfang', 'start', 'abschluss',
    ],
    relatedTraitIds: ['organizing', 'long_term_planning', 'achievement_drive'],
  },
  {
    id: 'iterative_refinement',
    category: 'work_style',
    name: { en: 'Iterative Refinement', de: 'Iterative Verfeinerung' },
    description: {
      en: 'You prefer improving work through repeated cycles of feedback and revision.',
      de: 'Du verbesserst Arbeit gern durch wiederholte Feedback- und Überarbeitungszyklen.',
    },
    keywords: [
      'iterat', 'refine', 'revise', 'feedback loop', 'incremental', 'improve', 'cycle',
      'iterativ', 'verfeinern', 'überarbeiten', 'feedback', 'inkrementell', 'zyklus',
    ],
    relatedTraitIds: ['continuous_improvement', 'feedback_seeking', 'creativity'],
  },
  {
    id: 'client_facing_work',
    category: 'work_style',
    name: { en: 'Client-Facing Work', de: 'Kundenorientierte Arbeit' },
    description: {
      en: 'You enjoy direct, ongoing interaction with external clients or users.',
      de: 'Du magst direkten, fortlaufenden Austausch mit externen Kunden oder Nutzern.',
    },
    keywords: [
      'client-facing', 'customer-facing', 'external', 'stakeholder meeting', 'account',
      'kundenkontakt', 'kundenorientiert', 'extern', 'account', 'kundentermin',
    ],
    relatedTraitIds: ['customer_relations', 'communication', 'service_orientation'],
  },
  {
    id: 'big_picture_focus',
    category: 'work_style',
    name: { en: 'Big-Picture Focus', de: 'Blick fürs Ganze' },
    description: {
      en: 'You prefer working at the overview level rather than fine-grained details.',
      de: 'Du arbeitest lieber auf Übersichtsebene als in feinsten Details.',
    },
    keywords: [
      'big picture', 'overview', 'strategic view', 'macro', 'holistic view', 'forest not trees',
      'ganzbild', 'überblick', 'strategisch', 'makro', 'holistisch', 'gesamtblick',
    ],
    relatedTraitIds: ['holistic_thinking', 'strategic_thinking', 'leadership'],
  },
  {
    id: 'deep_focus',
    category: 'work_style',
    name: { en: 'Deep Focus', de: 'Tiefe Konzentration' },
    description: {
      en: 'You sustain long periods of concentration on demanding, complex tasks.',
      de: 'Du hältst lange Konzentrationsphasen bei anspruchsvollen, komplexen Aufgaben durch.',
    },
    keywords: [
      'deep focus', 'concentration', 'flow', 'immersed', 'uninterrupted', 'deep work',
      'tiefe konzentration', 'fokus', 'flow', 'vertieft', 'ungestört', 'deep work',
    ],
    relatedTraitIds: ['working_independently', 'precision', 'analytical_thinking'],
  },
  {
    id: 'strategic_thinking',
    category: 'thinking_style',
    name: { en: 'Strategic Thinking', de: 'Strategisches Denken' },
    description: {
      en: 'You connect decisions to broader goals, context, and competitive dynamics.',
      de: 'Du verknüpfst Entscheidungen mit übergeordneten Zielen, Kontext und Wettbewerbslage.',
    },
    keywords: [
      'strategic', 'strategy', 'long-range', 'competitive', 'positioning', 'big bet',
      'strategisch', 'strategie', 'langfristig', 'wettbewerb', 'positionierung',
    ],
    relatedTraitIds: ['long_term_planning', 'business_strategy', 'holistic_thinking'],
  },
  {
    id: 'critical_thinking',
    category: 'thinking_style',
    name: { en: 'Critical Thinking', de: 'Kritisches Denken' },
    description: {
      en: 'You question assumptions and evaluate evidence before reaching conclusions.',
      de: 'Du hinterfragst Annahmen und prüfst Evidenz, bevor du zu Schlussfolgerungen kommst.',
    },
    keywords: [
      'critical', 'question', 'assumption', 'evaluate', 'skeptic', 'evidence', 'reasoning',
      'kritisch', 'hinterfragen', 'annahme', 'bewerten', 'evidenz', 'schlussfolgerung',
    ],
    relatedTraitIds: ['analytical_thinking', 'root_cause_analysis', 'decision_making'],
  },
  {
    id: 'conceptual_thinking',
    category: 'thinking_style',
    name: { en: 'Conceptual Thinking', de: 'Konzeptuelles Denken' },
    description: {
      en: 'You work comfortably with abstract ideas, models, and frameworks.',
      de: 'Du arbeitest gern mit abstrakten Ideen, Modellen und Frameworks.',
    },
    keywords: [
      'conceptual', 'abstract', 'framework', 'model', 'theory', 'idea', 'concept',
      'konzeptuell', 'abstrakt', 'framework', 'modell', 'theorie', 'konzept',
    ],
    relatedTraitIds: ['exploring_ideas', 'systems_thinking', 'creativity'],
  },
  {
    id: 'practical_thinking',
    category: 'thinking_style',
    name: { en: 'Practical Thinking', de: 'Praktisches Denken' },
    description: {
      en: 'You focus on what works in real-world constraints rather than ideal theory.',
      de: 'Du konzentrierst dich auf das, was unter realen Bedingungen funktioniert, statt auf Idealtheorie.',
    },
    keywords: [
      'practical', 'pragmatic', 'real-world', 'feasible', 'workable', 'grounded', 'applied',
      'praktisch', 'pragmatisch', 'realität', 'machbar', 'umsetzbar', 'angewandt',
    ],
    relatedTraitIds: ['practical_work', 'pragmatic_solutions', 'resourcefulness'],
  },
  {
    id: 'systems_thinking',
    category: 'thinking_style',
    name: { en: 'Systems Thinking', de: 'Systemisches Denken' },
    description: {
      en: 'You see how parts connect and interact within larger systems.',
      de: 'Du siehst, wie Teile in größeren Systemen zusammenhängen und interagieren.',
    },
    keywords: [
      'systems', 'interconnect', 'ecosystem', 'feedback loop', 'holistic system', 'network',
      'systemisch', 'zusammenhang', 'ökosystem', 'feedback', 'netzwerk', 'gefüge',
    ],
    relatedTraitIds: ['holistic_thinking', 'analytical_thinking', 'complex_problem_solving'],
  },
  {
    id: 'intuitive_thinking',
    category: 'thinking_style',
    name: { en: 'Intuitive Thinking', de: 'Intuitives Denken' },
    description: {
      en: 'You trust pattern recognition and experience-informed instincts in decisions.',
      de: 'Du vertraust Mustern und erfahrungsgeprägter Intuition bei Entscheidungen.',
    },
    keywords: [
      'intuit', 'instinct', 'gut feel', 'pattern recognition', 'experience-based', 'sense',
      'intuitiv', 'instinkt', 'bauchgefühl', 'muster', 'erfahrung', 'spüren',
    ],
    relatedTraitIds: ['creativity', 'decision_making', 'adaptability'],
  },
  {
    id: 'quantitative_thinking',
    category: 'thinking_style',
    name: { en: 'Quantitative Thinking', de: 'Quantitatives Denken' },
    description: {
      en: 'You prefer numbers, metrics, and measurable reasoning in your work.',
      de: 'Du bevorzugst Zahlen, Kennzahlen und messbare Argumentation in deiner Arbeit.',
    },
    keywords: [
      'quantitative', 'numbers', 'metrics', 'measure', 'statistic', 'data-driven', 'KPI',
      'quantitativ', 'zahlen', 'kennzahl', 'messen', 'statistik', 'datenbasiert',
    ],
    relatedTraitIds: ['analytical_thinking', 'data_insights', 'finance_economics'],
  },
  {
    id: 'holistic_thinking',
    category: 'thinking_style',
    name: { en: 'Holistic Thinking', de: 'Ganzheitliches Denken' },
    description: {
      en: 'You consider the whole picture rather than isolated parts.',
      de: 'Du betrachtest das Gesamtbild statt isolierter Einzelteile.',
    },
    keywords: [
      'holistic', 'whole picture', 'integrated', 'comprehensive', 'all angles', 'entire',
      'ganzheitlich', 'gesamtbild', 'integriert', 'umfassend', 'alle aspekte', 'gesamt',
    ],
    relatedTraitIds: ['systems_thinking', 'big_picture_focus', 'stakeholder_analysis'],
  },
  {
    id: 'comparative_thinking',
    category: 'thinking_style',
    name: { en: 'Comparative Thinking', de: 'Vergleichendes Denken' },
    description: {
      en: 'You evaluate options by weighing trade-offs and relative advantages.',
      de: 'Du bewertest Optionen, indem du Abwägungen und relative Vorteile gegeneinander stellst.',
    },
    keywords: [
      'compar', 'trade-off', 'weigh', 'pros and cons', 'benchmark', 'alternative', 'option',
      'vergleich', 'abwägung', 'vor- und nachteile', 'benchmark', 'alternative', 'option',
    ],
    relatedTraitIds: ['decision_frameworks', 'critical_thinking', 'prioritization'],
  },
  {
    id: 'achievement_drive',
    category: 'motivation',
    name: { en: 'Achievement Drive', de: 'Leistungsmotivation' },
    description: {
      en: 'You are motivated by hitting goals and measurable success.',
      de: 'Du wirst motiviert durch das Erreichen von Zielen und messbarem Erfolg.',
    },
    keywords: [
      'achievement', 'goal', 'success', 'target', 'perform', 'win', 'accomplish',
      'leistung', 'ziel', 'erfolg', 'erreichen', 'leisten', 'gewinnen',
    ],
    relatedTraitIds: ['excellence', 'initiative', 'recognition_motivation'],
  },
  {
    id: 'recognition_motivation',
    category: 'motivation',
    name: { en: 'Recognition', de: 'Anerkennung' },
    description: {
      en: 'You are motivated when your contributions are acknowledged and appreciated.',
      de: 'Du wirst motiviert, wenn deine Beiträge anerkannt und gewürdigt werden.',
    },
    keywords: [
      'recognition', 'acknowledge', 'appreciat', 'praise', 'credit', 'visible impact',
      'anerkennung', 'würdigen', 'lob', 'sichtbar', 'beitrag', 'wertschätzung',
    ],
    relatedTraitIds: ['achievement_drive', 'leadership', 'communication'],
  },
  {
    id: 'autonomy_motivation',
    category: 'motivation',
    name: { en: 'Autonomy', de: 'Autonomie' },
    description: {
      en: 'You are motivated by freedom to choose how and when you do your work.',
      de: 'Du wirst motiviert durch die Freiheit, zu wählen, wie und wann du arbeitest.',
    },
    keywords: [
      'autonomy', 'freedom', 'self-directed', 'independence', 'own pace', 'choice',
      'autonomie', 'freiheit', 'selbstbestimmt', 'unabhängig', 'eigenes tempo', 'wahl',
    ],
    relatedTraitIds: ['working_independently', 'remote_flexibility', 'self_directed_learning'],
  },
  {
    id: 'mastery_motivation',
    category: 'motivation',
    name: { en: 'Mastery', de: 'Meisterschaft' },
    description: {
      en: 'You are motivated by becoming exceptionally skilled in your craft.',
      de: 'Du wirst motiviert durch das Werden außergewöhnlich gut in deinem Fach.',
    },
    keywords: [
      'mastery', 'expertise', 'skill', 'craft', 'proficiency', 'deep skill', 'specialist',
      'meisterschaft', 'expertise', 'fähigkeit', 'handwerk', 'kompetenz', 'spezialist',
    ],
    relatedTraitIds: ['continuous_learning', 'excellence', 'precision'],
  },
  {
    id: 'healthy_competition',
    category: 'motivation',
    name: { en: 'Healthy Competition', de: 'Gesunder Wettbewerb' },
    description: {
      en: 'You are motivated by outperforming benchmarks, standards, or peers.',
      de: 'Du wirst motiviert durch das Übertreffen von Benchmarks, Standards oder Mitstreitern.',
    },
    keywords: [
      'competit', 'benchmark', 'outperform', 'rival', 'challenge', 'ranking', 'compare',
      'wettbewerb', 'benchmark', 'übertreffen', 'herausforderung', 'ranking', 'vergleich',
    ],
    relatedTraitIds: ['achievement_drive', 'strategic_thinking', 'initiative'],
  },
  {
    id: 'security_stability',
    category: 'motivation',
    name: { en: 'Security & Stability', de: 'Sicherheit & Stabilität' },
    description: {
      en: 'You are motivated by stable, predictable career paths and dependable conditions.',
      de: 'Du wirst motiviert durch stabile, vorhersehbare Karrierewege und verlässliche Rahmenbedingungen.',
    },
    keywords: [
      'security', 'stability', 'stable', 'predictable', 'steady job', 'reliable income',
      'sicherheit', 'stabilität', 'stabil', 'vorhersehbar', 'festanstellung', 'verlässlich',
    ],
    relatedTraitIds: ['routine_preference', 'consistency', 'large_organization'],
  },
  {
    id: 'variety_seeking',
    category: 'motivation',
    name: { en: 'Variety Seeking', de: 'Abwechslungsbedürfnis' },
    description: {
      en: 'You are motivated by diverse tasks and changing challenges in your work.',
      de: 'Du wirst motiviert durch vielfältige Aufgaben und wechselnde Herausforderungen.',
    },
    keywords: [
      'variety', 'diverse', 'change', 'different tasks', 'novelty', 'mix', 'rotation',
      'abwechslung', 'vielfalt', 'wechsel', 'unterschiedliche aufgaben', 'neues', 'mix',
    ],
    relatedTraitIds: ['exploring_ideas', 'adaptability', 'fast_paced_work'],
  },
  {
    id: 'intellectual_challenge',
    category: 'motivation',
    name: { en: 'Intellectual Challenge', de: 'Intellektuelle Herausforderung' },
    description: {
      en: 'You are motivated by mentally demanding work that stretches your thinking.',
      de: 'Du wirst motiviert durch geistig anspruchsvolle Arbeit, die dein Denken fordert.',
    },
    keywords: [
      'intellectual', 'mental challenge', 'stimulating', 'demanding', 'complex', 'brain',
      'intellektuell', 'geistig', 'anspruchsvoll', 'stimulierend', 'komplex', 'denken',
    ],
    relatedTraitIds: ['complex_problem_solving', 'analytical_thinking', 'exploring_ideas'],
  },
  {
    id: 'service_orientation',
    category: 'motivation',
    name: { en: 'Service Orientation', de: 'Serviceorientierung' },
    description: {
      en: 'You are motivated by serving clients, users, or beneficiaries effectively.',
      de: 'Du wirst motiviert durch effektive Betreuung von Kunden, Nutzern oder Begünstigten.',
    },
    keywords: [
      'service', 'serve', 'client service', 'customer care', 'support', 'help users',
      'service', 'betreuung', 'kundenservice', 'kundenbetreuung', 'unterstützung', 'nutzer',
    ],
    relatedTraitIds: ['helping_others', 'customer_focus', 'customer_relations'],
  },
  {
    id: 'financial_reward',
    category: 'motivation',
    name: { en: 'Financial Reward', de: 'Finanzielle Belohnung' },
    description: {
      en: 'You are motivated by compensation, financial growth, and economic reward.',
      de: 'Du wirst motiviert durch Vergütung, finanzielles Wachstum und wirtschaftliche Belohnung.',
    },
    keywords: [
      'financial', 'salary', 'compensation', 'bonus', 'income', 'reward', 'earn',
      'finanziell', 'gehalt', 'vergütung', 'bonus', 'einkommen', 'belohnung', 'verdienen',
    ],
    relatedTraitIds: ['achievement_drive', 'finance_economics', 'business_strategy'],
  },
  {
    id: 'creative_expression_motivation',
    category: 'motivation',
    name: { en: 'Creative Expression', de: 'Kreativer Ausdruck' },
    description: {
      en: 'You are motivated by outlets for original ideas and creative work.',
      de: 'Du wirst motiviert durch Möglichkeiten für eigene Ideen und kreative Arbeit.',
    },
    keywords: [
      'creative expression', 'original', 'invent', 'design', 'artistic', 'express',
      'kreativer ausdruck', 'originell', 'erfinden', 'gestalten', 'künstlerisch', 'ausdruck',
    ],
    relatedTraitIds: ['creativity', 'building_things', 'media_storytelling'],
  },
  {
    id: 'growth_opportunity',
    category: 'motivation',
    name: { en: 'Growth Opportunity', de: 'Wachstumschancen' },
    description: {
      en: 'You are motivated by roles that offer clear paths to advance and expand scope.',
      de: 'Du wirst motiviert durch Rollen mit klaren Wegen zum Aufstieg und mehr Verantwortung.',
    },
    keywords: [
      'growth', 'advancement', 'promotion', 'career path', 'expand', 'progress', 'upward',
      'wachstum', 'aufstieg', 'beförderung', 'karriereweg', 'erweitern', 'fortschritt',
    ],
    relatedTraitIds: ['mastery_motivation', 'leadership', 'continuous_learning'],
  },
  {
    id: 'office_environment',
    category: 'environment',
    name: { en: 'Office Environment', de: 'Büroumgebung' },
    description: {
      en: 'You prefer structured office settings with dedicated workspaces and facilities.',
      de: 'Du bevorzugst strukturierte Büroumgebungen mit festen Arbeitsplätzen und Ausstattung.',
    },
    keywords: [
      'office', 'desk', 'workplace', 'corporate office', 'on-site', 'headquarters',
      'büro', 'schreibtisch', 'arbeitsplatz', 'firmensitz', 'vor ort', 'hauptsitz',
    ],
    relatedTraitIds: ['structure_and_order', 'large_organization', 'teamwork'],
  },
  {
    id: 'quiet_workspace',
    category: 'environment',
    name: { en: 'Quiet Workspace', de: 'Ruhiger Arbeitsplatz' },
    description: {
      en: 'You prefer low-noise environments that support deep concentration.',
      de: 'Du bevorzugst ruhige Umgebungen, die tiefe Konzentration ermöglichen.',
    },
    keywords: [
      'quiet', 'low noise', 'silent', 'peaceful', 'focus room', 'library', 'calm space',
      'ruhig', 'leise', 'still', 'friedlich', 'fokusraum', 'konzentration', 'ruhe',
    ],
    relatedTraitIds: ['deep_focus', 'working_independently', 'precision'],
  },
  {
    id: 'dynamic_environment',
    category: 'environment',
    name: { en: 'Dynamic Environment', de: 'Dynamische Umgebung' },
    description: {
      en: 'You prefer lively, changing surroundings with constant activity and energy.',
      de: 'Du bevorzugst lebendige, wechselnde Umgebungen mit ständiger Aktivität und Energie.',
    },
    keywords: [
      'dynamic', 'lively', 'bustling', 'energetic', 'active', 'vibrant', 'busy',
      'dynamisch', 'lebendig', 'belebt', 'energiegeladen', 'aktiv', 'reges treiben',
    ],
    relatedTraitIds: ['fast_paced_work', 'startup_culture', 'social_energy'],
  },
  {
    id: 'international_context',
    category: 'environment',
    name: { en: 'International Context', de: 'Internationaler Kontext' },
    description: {
      en: 'You prefer multicultural or global settings in your professional work.',
      de: 'Du bevorzugst multikulturelle oder globale Rahmenbedingungen in deiner Arbeit.',
    },
    keywords: [
      'international', 'global', 'multicultural', 'cross-border', 'worldwide', 'diverse team',
      'international', 'global', 'multikulturell', 'grenzüberschreitend', 'weltweit',
    ],
    relatedTraitIds: ['cross_cultural_communication', 'travel_opportunities', 'respect_for_diversity'],
  },
  {
    id: 'small_team_setting',
    category: 'environment',
    name: { en: 'Small Team Setting', de: 'Kleines Team' },
    description: {
      en: 'You prefer close-knit team environments with direct collaboration.',
      de: 'Du bevorzugst überschaubare Teams mit direkter Zusammenarbeit.',
    },
    keywords: [
      'small team', 'close-knit', 'tight group', 'startup team', 'few people', 'intimate team',
      'kleines team', 'überschaubar', 'eng', 'startup', 'wenige leute', 'nah',
    ],
    relatedTraitIds: ['teamwork', 'startup_culture', 'relationship_building'],
  },
  {
    id: 'large_organization',
    category: 'environment',
    name: { en: 'Large Organization', de: 'Große Organisation' },
    description: {
      en: 'You are comfortable in big, structured organizations with established processes.',
      de: 'Du fühlst dich in großen, strukturierten Organisationen mit etablierten Prozessen wohl.',
    },
    keywords: [
      'large company', 'enterprise', 'corporation', 'big org', 'established', 'global firm',
      'großunternehmen', 'konzern', 'unternehmen', 'etabliert', 'organisation', 'firma',
    ],
    relatedTraitIds: ['structure_and_order', 'office_environment', 'security_stability'],
  },
  {
    id: 'startup_culture',
    category: 'environment',
    name: { en: 'Startup Culture', de: 'Startup-Kultur' },
    description: {
      en: 'You are drawn to early-stage, agile environments with rapid iteration.',
      de: 'Dich ziehen frühe, agile Umgebungen mit schneller Iteration an.',
    },
    keywords: [
      'startup', 'early-stage', 'agile', 'founder', 'scale-up', 'venture', 'fast-growing',
      'startup', 'frühphase', 'agil', 'gründer', 'scale-up', 'schnell wachsend',
    ],
    relatedTraitIds: ['fast_paced_work', 'initiative', 'variety_seeking'],
  },
  {
    id: 'travel_opportunities',
    category: 'environment',
    name: { en: 'Travel Opportunities', de: 'Reisemöglichkeiten' },
    description: {
      en: 'You prefer work that includes travel to different places and contexts.',
      de: 'Du bevorzugst Arbeit, die Reisen an verschiedene Orte und Kontexte einschließt.',
    },
    keywords: [
      'travel', 'on the road', 'field trip', 'site visit', 'mobile', 'international travel',
      'reisen', 'unterwegs', 'auswärtstermin', 'besichtigung', 'mobil', 'dienstreise',
    ],
    relatedTraitIds: ['international_context', 'variety_seeking', 'client_facing_work'],
  },
  {
    id: 'hands_on_environment',
    category: 'environment',
    name: { en: 'Hands-On Environment', de: 'Praktische Umgebung' },
    description: {
      en: 'You prefer workshops, labs, field sites, or other tangible work settings.',
      de: 'Du bevorzugst Werkstätten, Labore, Baustellen oder andere greifbare Arbeitsumgebungen.',
    },
    keywords: [
      'hands-on', 'workshop', 'lab', 'field site', 'factory floor', 'tangible', 'physical space',
      'praktisch', 'werkstatt', 'labor', 'baustelle', 'werkstattboden', 'greifbar',
    ],
    relatedTraitIds: ['practical_work', 'building_things', 'working_outdoors'],
  },
  {
    id: 'creative_studio',
    category: 'environment',
    name: { en: 'Creative Studio', de: 'Kreatives Studio' },
    description: {
      en: 'You prefer design-oriented, aesthetic workspaces that inspire creative output.',
      de: 'Du bevorzugst designorientierte, ästhetische Arbeitsräume, die kreative Arbeit inspirieren.',
    },
    keywords: [
      'studio', 'creative space', 'design office', 'aesthetic', 'inspiring space', 'maker space',
      'studio', 'kreativraum', 'designbüro', 'ästhetisch', 'inspirierend', 'maker space',
    ],
    relatedTraitIds: ['creativity', 'visual_communication', 'building_things'],
  },
  {
    id: 'hybrid_flexibility',
    category: 'environment',
    name: { en: 'Hybrid Flexibility', de: 'Hybride Flexibilität' },
    description: {
      en: 'You prefer a mix of remote and in-person work settings.',
      de: 'Du bevorzugst eine Mischung aus remote und persönlicher Arbeit.',
    },
    keywords: [
      'hybrid', 'flexible location', 'remote and office', 'mix', 'part-time remote',
      'hybrid', 'flexibler ort', 'remote und büro', 'mix', 'teilweise remote',
    ],
    relatedTraitIds: ['remote_flexibility', 'work_life_balance', 'adaptability'],
  },
  {
    id: 'collaborative_workspace',
    category: 'environment',
    name: { en: 'Collaborative Workspace', de: 'Kollaborativer Arbeitsraum' },
    description: {
      en: 'You prefer open, shared spaces designed for team interaction and co-creation.',
      de: 'Du bevorzugst offene, gemeinsame Räume für Teaminteraktion und Co-Kreation.',
    },
    keywords: [
      'collaborative space', 'open plan', 'coworking', 'shared desk', 'team room', 'open office',
      'kollaborativ', 'open space', 'coworking', 'gemeinschaftsbüro', 'teamraum', 'offen',
    ],
    relatedTraitIds: ['teamwork', 'facilitation', 'cross_team_collaboration'],
  },
  {
    id: 'active_listening',
    category: 'communication',
    name: { en: 'Active Listening', de: 'Aktives Zuhören' },
    description: {
      en: 'You hear and understand what others mean, not just what they say.',
      de: 'Du hörst und verstehst, was andere meinen — nicht nur, was sie sagen.',
    },
    keywords: [
      'listen', 'active listening', 'hear', 'attentive', 'understand', 'reflect back',
      'zuhören', 'aktiv zuhören', 'aufmerksam', 'verstehen', 'zurückspiegeln',
    ],
    relatedTraitIds: ['empathy', 'facilitation', 'relationship_building'],
  },
  {
    id: 'written_communication',
    category: 'communication',
    name: { en: 'Written Communication', de: 'Schriftliche Kommunikation' },
    description: {
      en: 'You express ideas clearly and effectively through writing.',
      de: 'Du drückst Ideen klar und wirkungsvoll schriftlich aus.',
    },
    keywords: [
      'writing', 'written', 'email', 'report', 'document', 'memo', 'prose',
      'schreiben', 'schriftlich', 'email', 'bericht', 'dokument', 'memo',
    ],
    relatedTraitIds: ['communication', 'technical_documentation', 'concise_communication'],
  },
  {
    id: 'public_speaking',
    category: 'communication',
    name: { en: 'Public Speaking', de: 'Öffentliches Sprechen' },
    description: {
      en: 'You are comfortable presenting ideas to groups and audiences.',
      de: 'Du präsentierst Ideen gern vor Gruppen und Publikum.',
    },
    keywords: [
      'public speaking', 'present', 'speech', 'audience', 'stage', 'keynote', 'talk',
      'öffentlich sprechen', 'präsentieren', 'rede', 'publikum', 'bühne', 'vortrag',
    ],
    relatedTraitIds: ['communication', 'persuasive_communication', 'leadership'],
  },
  {
    id: 'cross_cultural_communication',
    category: 'communication',
    name: { en: 'Cross-Cultural Communication', de: 'Interkulturelle Kommunikation' },
    description: {
      en: 'You communicate effectively across cultural and language differences.',
      de: 'Du kommunizierst effektiv über kulturelle und sprachliche Unterschiede hinweg.',
    },
    keywords: [
      'cross-cultural', 'intercultural', 'multilingual', 'global communication', 'cultural bridge',
      'interkulturell', 'multikulturell', 'mehrsprachig', 'global kommunizieren',
    ],
    relatedTraitIds: ['cultural_sensitivity', 'international_context', 'diplomatic_communication'],
  },
  {
    id: 'technical_documentation',
    category: 'communication',
    name: { en: 'Technical Documentation', de: 'Technische Dokumentation' },
    description: {
      en: 'You explain complex topics clearly in structured written form.',
      de: 'Du erklärst komplexe Themen klar in strukturierter Schriftform.',
    },
    keywords: [
      'documentation', 'manual', 'spec', 'technical writing', 'wiki', 'guide', 'readme',
      'dokumentation', 'handbuch', 'spezifikation', 'technisches schreiben', 'anleitung',
    ],
    relatedTraitIds: ['written_communication', 'technology', 'precision'],
  },
  {
    id: 'storytelling',
    category: 'communication',
    name: { en: 'Storytelling', de: 'Storytelling' },
    description: {
      en: 'You use narrative to engage, explain, and persuade others.',
      de: 'Du nutzt Erzählungen, um andere einzubinden, zu erklären und zu überzeugen.',
    },
    keywords: [
      'story', 'narrative', 'storytelling', 'anecdote', 'arc', 'compelling story',
      'story', 'erzählung', 'storytelling', 'anekdote', 'narrativ', 'packend',
    ],
    relatedTraitIds: ['communication', 'media_storytelling', 'persuasive_communication'],
  },
  {
    id: 'diplomatic_communication',
    category: 'communication',
    name: { en: 'Diplomatic Communication', de: 'Diplomatische Kommunikation' },
    description: {
      en: 'You navigate sensitive conversations with tact and respect.',
      de: 'Du führst sensible Gespräche mit Takt und Respekt.',
    },
    keywords: [
      'diplomatic', 'tactful', 'sensitive conversation', 'delicate', 'discreet', 'polite',
      'diplomatisch', 'taktvoll', 'sensibles gespräch', 'diskret', 'höflich',
    ],
    relatedTraitIds: ['negotiation', 'conflict_resolution', 'empathy'],
  },
  {
    id: 'concise_communication',
    category: 'communication',
    name: { en: 'Concise Communication', de: 'Prägnante Kommunikation' },
    description: {
      en: 'You get to the point clearly and efficiently without unnecessary detail.',
      de: 'Du kommst klar und effizient auf den Punkt, ohne unnötige Details.',
    },
    keywords: [
      'concise', 'brief', 'to the point', 'clear', 'succinct', 'efficient communication',
      'prägnant', 'kurz', 'auf den punkt', 'klar', 'knapp', 'effizient kommunizieren',
    ],
    relatedTraitIds: ['written_communication', 'decision_making', 'time_management'],
  },
  {
    id: 'facilitation',
    category: 'communication',
    name: { en: 'Facilitation', de: 'Moderation' },
    description: {
      en: 'You guide group discussions toward productive outcomes.',
      de: 'Du leitest Gruppendiskussionen zu produktiven Ergebnissen.',
    },
    keywords: [
      'facilitat', 'moderate', 'workshop lead', 'group discussion', 'guide meeting',
      'moderieren', 'facilitieren', 'workshop leiten', 'gruppendiskussion', 'meeting leiten',
    ],
    relatedTraitIds: ['consensus_building', 'active_listening', 'teamwork'],
  },
  {
    id: 'persuasive_communication',
    category: 'communication',
    name: { en: 'Persuasive Communication', de: 'Überzeugende Kommunikation' },
    description: {
      en: 'You convince others through structured argument and compelling delivery.',
      de: 'Du überzeugst andere durch strukturierte Argumente und wirkungsvolle Vermittlung.',
    },
    keywords: [
      'persuasive', 'convinc', 'argument', 'rhetoric', 'influence', 'sell the idea',
      'überzeugend', 'argument', 'rhetorik', 'beeinflussen', 'idee verkaufen',
    ],
    relatedTraitIds: ['persuasion', 'public_speaking', 'storytelling'],
  },
  {
    id: 'mentoring_leadership',
    category: 'leadership',
    name: { en: 'Mentoring Leadership', de: 'Mentoring-Führung' },
    description: {
      en: 'You lead primarily by developing people\'s capabilities and confidence.',
      de: 'Du führst vor allem, indem du Fähigkeiten und Selbstvertrauen anderer entwickelst.',
    },
    keywords: [
      'mentoring leader', 'develop people', 'grow talent', 'coach leader', 'people developer',
      'mentoring-führung', 'menschen entwickeln', 'talent fördern', 'coach-führung',
    ],
    relatedTraitIds: ['mentoring_strength', 'coaching', 'empowering_others'],
  },
  {
    id: 'visionary_leadership',
    category: 'leadership',
    name: { en: 'Visionary Leadership', de: 'Visionäre Führung' },
    description: {
      en: 'You set inspiring direction and paint a compelling picture of the future.',
      de: 'Du gibst inspirierende Richtung vor und zeichnest ein überzeugendes Zukunftsbild.',
    },
    keywords: [
      'vision', 'visionary', 'inspire', 'future direction', 'north star', 'big vision',
      'vision', 'visionär', 'inspirieren', 'zukunftsrichtung', 'leitstern', 'große vision',
    ],
    relatedTraitIds: ['long_term_planning', 'change_leadership', 'strategic_thinking'],
  },
  {
    id: 'operational_leadership',
    category: 'leadership',
    name: { en: 'Operational Leadership', de: 'Operative Führung' },
    description: {
      en: 'You ensure day-to-day execution runs smoothly and reliably.',
      de: 'Du sorgst dafür, dass der operative Alltag reibungslos und zuverlässig läuft.',
    },
    keywords: [
      'operational', 'execution', 'day-to-day', 'run the team', 'operations', 'delivery',
      'operativ', 'umsetzung', 'tagesgeschäft', 'team führen', 'betrieb', 'lieferung',
    ],
    relatedTraitIds: ['organizing', 'reliability', 'accountability_leadership'],
  },
  {
    id: 'delegating',
    category: 'leadership',
    name: { en: 'Delegating', de: 'Delegieren' },
    description: {
      en: 'You trust others with meaningful responsibility and clear ownership.',
      de: 'Du vertraust anderen sinnvolle Verantwortung und klare Zuständigkeit zu.',
    },
    keywords: [
      'delegat', 'assign', 'trust others', 'hand off', 'empower', 'distribute work',
      'delegieren', 'zuweisen', 'vertrauen', 'übergeben', 'befähigen', 'aufgaben verteilen',
    ],
    relatedTraitIds: ['empowering_others', 'operational_leadership', 'teamwork'],
  },
  {
    id: 'decision_making',
    category: 'leadership',
    name: { en: 'Decision Making', de: 'Entscheidungsfindung' },
    description: {
      en: 'You make timely, confident calls even when information is incomplete.',
      de: 'Du triffst rechtzeitige, selbstbewusste Entscheidungen, auch bei unvollständiger Information.',
    },
    keywords: [
      'decision', 'decide', 'judgment', 'call', 'choose', 'decisive', 'make the call',
      'entscheidung', 'entscheiden', 'urteil', 'wahl', 'entschlossen', 'entscheidung treffen',
    ],
    relatedTraitIds: ['critical_thinking', 'risk_assessment', 'accountability'],
  },
  {
    id: 'conflict_resolution',
    category: 'leadership',
    name: { en: 'Conflict Resolution', de: 'Konfliktlösung' },
    description: {
      en: 'You address disagreements constructively and restore productive working relationships.',
      de: 'Du gehst konstruktiv mit Meinungsverschiedenheiten um und stellst produktive Beziehungen wieder her.',
    },
    keywords: [
      'conflict', 'resolve dispute', 'mediation', 'de-escalate', 'disagreement', 'reconcile',
      'konflikt', 'streit lösen', 'mediation', 'deeskalieren', 'meinungsverschiedenheit',
    ],
    relatedTraitIds: ['diplomatic_communication', 'negotiation', 'consensus_building'],
  },
  {
    id: 'coaching',
    category: 'leadership',
    name: { en: 'Coaching', de: 'Coaching' },
    description: {
      en: 'You help individuals improve performance through feedback and questions.',
      de: 'Du hilfst Einzelnen, Leistung durch Feedback und Fragen zu verbessern.',
    },
    keywords: [
      'coach', 'coaching', 'feedback', 'performance improvement', '1:1', 'develop performance',
      'coachen', 'feedback', 'leistungsverbesserung', 'einzelgespräch', 'entwicklung',
    ],
    relatedTraitIds: ['mentoring_leadership', 'feedback_seeking', 'teaching_others'],
  },
  {
    id: 'empowering_others',
    category: 'leadership',
    name: { en: 'Empowering Others', de: 'Andere befähigen' },
    description: {
      en: 'You give people autonomy and ownership so they can do their best work.',
      de: 'Du gibst Menschen Autonomie und Verantwortung, damit sie ihr Bestes leisten können.',
    },
    keywords: [
      'empower', 'autonomy', 'ownership', 'trust team', 'enable', 'self-organizing',
      'befähigen', 'autonomie', 'eigenverantwortung', 'team vertrauen', 'ermöglichen',
    ],
    relatedTraitIds: ['delegating', 'inclusive_leadership', 'autonomy_motivation'],
  },
  {
    id: 'change_leadership',
    category: 'leadership',
    name: { en: 'Change Leadership', de: 'Veränderungsführung' },
    description: {
      en: 'You guide teams through transitions and help people adapt to new ways of working.',
      de: 'Du begleitest Teams durch Veränderungen und hilfst beim Anpassen an neue Arbeitsweisen.',
    },
    keywords: [
      'change', 'transformation', 'transition', 'adapt org', 'change management', 'restructure',
      'veränderung', 'transformation', 'übergang', 'change management', 'umstrukturierung',
    ],
    relatedTraitIds: ['visionary_leadership', 'adaptability', 'communication'],
  },
  {
    id: 'inclusive_leadership',
    category: 'leadership',
    name: { en: 'Inclusive Leadership', de: 'Inklusive Führung' },
    description: {
      en: 'You ensure all voices are heard and valued in team decisions.',
      de: 'Du sorgst dafür, dass alle Stimmen in Teamentscheidungen gehört und gewürdigt werden.',
    },
    keywords: [
      'inclusive leader', 'all voices', 'belonging', 'diverse team', 'equitable leadership',
      'inklusive führung', 'alle stimmen', 'zugehörigkeit', 'vielfältiges team', 'fair führen',
    ],
    relatedTraitIds: ['respect_for_diversity', 'facilitation', 'fairness'],
  },
  {
    id: 'accountability_leadership',
    category: 'leadership',
    name: { en: 'Accountability Leadership', de: 'Verantwortungsführung' },
    description: {
      en: 'You hold yourself and your team to clear commitments and outcomes.',
      de: 'Du hältst dich und dein Team an klare Zusagen und Ergebnisse.',
    },
    keywords: [
      'accountability leader', 'hold accountable', 'commitments', 'follow through', 'own results',
      'verantwortungsführung', 'rechenschaft', 'zusagen', 'durchhalten', 'ergebnisse übernehmen',
    ],
    relatedTraitIds: ['accountability', 'operational_leadership', 'reliability'],
  },
  {
    id: 'root_cause_analysis',
    category: 'problem_solving',
    name: { en: 'Root Cause Analysis', de: 'Ursachenanalyse' },
    description: {
      en: 'You dig beneath symptoms to find underlying causes of problems.',
      de: 'Du gehst unter Symptome, um zugrunde liegende Ursachen von Problemen zu finden.',
    },
    keywords: [
      'root cause', 'why analysis', 'underlying cause', '5 whys', 'diagnose', 'trace back',
      'ursache', 'root cause', 'grundursache', '5 whys', 'diagnose', 'zurückverfolgen',
    ],
    relatedTraitIds: ['analytical_thinking', 'systematic_troubleshooting', 'critical_thinking'],
  },
  {
    id: 'creative_problem_solving',
    category: 'problem_solving',
    name: { en: 'Creative Problem Solving', de: 'Kreative Problemlösung' },
    description: {
      en: 'You find novel approaches when conventional solutions are stuck.',
      de: 'Du findest neue Ansätze, wenn herkömmliche Lösungen nicht weiterkommen.',
    },
    keywords: [
      'creative solution', 'novel approach', 'unconventional', 'brainstorm fix', 'invent solution',
      'kreative lösung', 'neuer ansatz', 'unkonventionell', 'brainstorm', 'lösung erfinden',
    ],
    relatedTraitIds: ['creativity', 'resourcefulness', 'experimentation'],
  },
  {
    id: 'systematic_troubleshooting',
    category: 'problem_solving',
    name: { en: 'Systematic Troubleshooting', de: 'Systematische Fehlersuche' },
    description: {
      en: 'You follow structured steps to diagnose and fix issues reliably.',
      de: 'Du folgst strukturierten Schritten, um Probleme zuverlässig zu diagnostizieren und zu beheben.',
    },
    keywords: [
      'troubleshoot', 'diagnose', 'debug', 'systematic', 'step-by-step fix', 'isolate issue',
      'fehlersuche', 'diagnose', 'debug', 'systematisch', 'schrittweise beheben', 'isolieren',
    ],
    relatedTraitIds: ['root_cause_analysis', 'precision', 'analytical_thinking'],
  },
  {
    id: 'risk_assessment',
    category: 'problem_solving',
    name: { en: 'Risk Assessment', de: 'Risikobewertung' },
    description: {
      en: 'You evaluate potential downsides and uncertainties before acting.',
      de: 'Du bewertest mögliche Nachteile und Unsicherheiten, bevor du handelst.',
    },
    keywords: [
      'risk', 'assess risk', 'mitigation', 'uncertainty', 'downside', 'contingency',
      'risiko', 'risikobewertung', 'abschwächung', 'unsicherheit', 'notfallplan',
    ],
    relatedTraitIds: ['decision_making', 'critical_thinking', 'long_term_planning'],
  },
  {
    id: 'prioritization',
    category: 'problem_solving',
    name: { en: 'Prioritization', de: 'Priorisierung' },
    description: {
      en: 'You choose what matters most when time and resources are limited.',
      de: 'Du wählst das Wichtigste, wenn Zeit und Ressourcen begrenzt sind.',
    },
    keywords: [
      'priorit', 'rank', 'most important', 'triage', 'focus first', 'trade-off choice',
      'priorisieren', 'rangfolge', 'wichtigste', 'triage', 'fokus', 'abwägung',
    ],
    relatedTraitIds: ['time_management', 'comparative_thinking', 'decision_frameworks'],
  },
  {
    id: 'decision_frameworks',
    category: 'problem_solving',
    name: { en: 'Decision Frameworks', de: 'Entscheidungsframeworks' },
    description: {
      en: 'You use structured methods to compare options and choose well.',
      de: 'Du nutzt strukturierte Methoden, um Optionen zu vergleichen und gut zu wählen.',
    },
    keywords: [
      'decision framework', 'matrix', 'criteria', 'weighted score', 'decision tree', 'model',
      'entscheidungsframework', 'matrix', 'kriterien', 'gewichtung', 'entscheidungsbaum',
    ],
    relatedTraitIds: ['comparative_thinking', 'decision_making', 'quantitative_thinking'],
  },
  {
    id: 'experimentation',
    category: 'problem_solving',
    name: { en: 'Experimentation', de: 'Experimentieren' },
    description: {
      en: 'You test hypotheses through trials to learn what actually works.',
      de: 'Du testest Hypothesen durch Versuche, um zu lernen, was wirklich funktioniert.',
    },
    keywords: [
      'experiment', 'test', 'hypothesis', 'trial', 'pilot', 'A/B', 'prototype test',
      'experiment', 'testen', 'hypothese', 'versuch', 'pilot', 'prototyp test',
    ],
    relatedTraitIds: ['science_research', 'iterative_refinement', 'learning_by_doing'],
  },
  {
    id: 'pragmatic_solutions',
    category: 'problem_solving',
    name: { en: 'Pragmatic Solutions', de: 'Pragmatische Lösungen' },
    description: {
      en: 'You favor workable fixes that deliver results over perfect theory.',
      de: 'Du bevorzugst umsetzbare Lösungen mit Ergebnis statt perfekter Theorie.',
    },
    keywords: [
      'pragmatic', 'workable', 'good enough', 'practical fix', 'deliver now', 'feasible',
      'pragmatisch', 'umsetzbar', 'gut genug', 'praktische lösung', 'schnell liefern',
    ],
    relatedTraitIds: ['practical_thinking', 'resourcefulness', 'complex_problem_solving'],
  },
  {
    id: 'breaking_down_problems',
    category: 'problem_solving',
    name: { en: 'Breaking Down Problems', de: 'Probleme zerlegen' },
    description: {
      en: 'You decompose large challenges into manageable, actionable pieces.',
      de: 'Du zerlegst große Herausforderungen in handhabbare, umsetzbare Teile.',
    },
    keywords: [
      'break down', 'decompose', 'chunk', 'subtask', 'divide problem', 'smaller steps',
      'zerlegen', 'aufteilen', 'teilaufgabe', 'unterteilen', 'kleinere schritte',
    ],
    relatedTraitIds: ['analytical_thinking', 'organizing', 'complex_problem_solving'],
  },
  {
    id: 'stakeholder_analysis',
    category: 'problem_solving',
    name: { en: 'Stakeholder Analysis', de: 'Stakeholder-Analyse' },
    description: {
      en: 'You understand who is affected and what they need before solving a problem.',
      de: 'Du verstehst, wer betroffen ist und was sie brauchen, bevor du ein Problem löst.',
    },
    keywords: [
      'stakeholder', 'interested party', 'who affected', 'needs analysis', 'stakeholder map',
      'stakeholder', 'beteiligte', 'betroffene', 'bedarfsanalyse', 'stakeholder-karte',
    ],
    relatedTraitIds: ['holistic_thinking', 'empathy', 'customer_focus'],
  },
  {
    id: 'continuous_improvement',
    category: 'problem_solving',
    name: { en: 'Continuous Improvement', de: 'Kontinuierliche Verbesserung' },
    description: {
      en: 'You refine processes based on feedback, data, and repeated cycles.',
      de: 'Du verbesserst Prozesse anhand von Feedback, Daten und wiederholten Zyklen.',
    },
    keywords: [
      'continuous improvement', 'kaizen', 'optimize', 'iterate process', 'refine', 'better',
      'kontinuierliche verbesserung', 'kaizen', 'optimieren', 'prozess verbessern', 'verfeinern',
    ],
    relatedTraitIds: ['iterative_refinement', 'feedback_seeking', 'precision'],
  },
  {
    id: 'self_directed_learning',
    category: 'learning',
    name: { en: 'Self-Directed Learning', de: 'Selbstgesteuertes Lernen' },
    description: {
      en: 'You pursue knowledge independently without needing formal structure.',
      de: 'Du erwirbst Wissen eigenständig, ohne formale Struktur zu brauchen.',
    },
    keywords: [
      'self-directed', 'self-study', 'autodidact', 'learn alone', 'independent learning',
      'selbstgesteuert', 'selbststudium', 'autodidakt', 'allein lernen', 'eigenständig lernen',
    ],
    relatedTraitIds: ['continuous_learning', 'autonomy_motivation', 'working_independently'],
  },
  {
    id: 'learning_by_doing',
    category: 'learning',
    name: { en: 'Learning by Doing', de: 'Lernen durch Tun' },
    description: {
      en: 'You pick up skills fastest through hands-on practice and real tasks.',
      de: 'Du lernst am schnellsten durch praktisches Üben und echte Aufgaben.',
    },
    keywords: [
      'learning by doing', 'hands-on learning', 'practice', 'on the job', 'trial and error',
      'lernen durch tun', 'praktisch lernen', 'üben', 'im job', 'trial and error',
    ],
    relatedTraitIds: ['practical_work', 'experimentation', 'rapid_skill_acquisition'],
  },
  {
    id: 'feedback_seeking',
    category: 'learning',
    name: { en: 'Feedback Seeking', de: 'Feedback einholen' },
    description: {
      en: 'You actively ask for input to improve your work and skills.',
      de: 'Du holst aktiv Rückmeldung ein, um deine Arbeit und Fähigkeiten zu verbessern.',
    },
    keywords: [
      'feedback', 'ask for input', 'review', 'critique', 'seek advice', 'learn from others',
      'feedback', 'rückmeldung', 'input einholen', 'review', 'kritik', 'rat einholen',
    ],
    relatedTraitIds: ['reflective_practice', 'coaching', 'continuous_improvement'],
  },
  {
    id: 'teaching_others',
    category: 'learning',
    name: { en: 'Teaching Others', de: 'Anderen beibringen' },
    description: {
      en: 'You reinforce your knowledge by explaining and guiding others.',
      de: 'Du festigst dein Wissen, indem du anderen erklärst und sie anleitest.',
    },
    keywords: [
      'teach', 'instruct', 'explain to others', 'train colleague', 'knowledge sharing',
      'beibringen', 'unterrichten', 'erklären', 'kollegen schulen', 'wissen teilen',
    ],
    relatedTraitIds: ['education_training', 'mentoring_strength', 'communication'],
  },
  {
    id: 'staying_current',
    category: 'learning',
    name: { en: 'Staying Current', de: 'Am Puls bleiben' },
    description: {
      en: 'You keep up with developments and trends in your field.',
      de: 'Du bleibst über Entwicklungen und Trends in deinem Fachgebiet informiert.',
    },
    keywords: [
      'stay current', 'up to date', 'industry trend', 'follow news', 'latest', 'keep pace',
      'am puls bleiben', 'aktuell', 'branchentrend', 'neuigkeiten', 'auf dem laufenden',
    ],
    relatedTraitIds: ['continuous_learning', 'technology', 'exploring_ideas'],
  },
  {
    id: 'cross_disciplinary_learning',
    category: 'learning',
    name: { en: 'Cross-Disciplinary Learning', de: 'Fachübergreifendes Lernen' },
    description: {
      en: 'You draw insights from fields outside your primary specialty.',
      de: 'Du gewinnst Erkenntnisse aus Bereichen außerhalb deiner Hauptdisziplin.',
    },
    keywords: [
      'cross-disciplinary', 'interdisciplinary', 'borrow ideas', 'adjacent field', 'broad learning',
      'fachübergreifend', 'interdisziplinär', 'ideen übernehmen', 'angrenzendes fach', 'breit lernen',
    ],
    relatedTraitIds: ['exploring_ideas', 'holistic_thinking', 'creativity'],
  },
  {
    id: 'structured_training',
    category: 'learning',
    name: { en: 'Structured Training', de: 'Strukturiertes Training' },
    description: {
      en: 'You prefer formal courses, certifications, and guided learning paths.',
      de: 'Du bevorzugst formale Kurse, Zertifizierungen und geführte Lernpfade.',
    },
    keywords: [
      'training', 'certification', 'course', 'curriculum', 'formal learning', 'classroom',
      'training', 'zertifizierung', 'kurs', 'curriculum', 'formales lernen', 'seminar',
    ],
    relatedTraitIds: ['structure_and_order', 'education_training', 'mastery_motivation'],
  },
  {
    id: 'reflective_practice',
    category: 'learning',
    name: { en: 'Reflective Practice', de: 'Reflektierte Praxis' },
    description: {
      en: 'You learn by reviewing what worked, what did not, and why.',
      de: 'Du lernst, indem du prüfst, was funktioniert hat, was nicht und warum.',
    },
    keywords: [
      'reflect', 'retrospective', 'lessons learned', 'review performance', 'debrief',
      'reflektieren', 'retrospektive', 'lessons learned', 'leistung prüfen', 'nachbesprechung',
    ],
    relatedTraitIds: ['feedback_seeking', 'learning_from_failure', 'continuous_improvement'],
  },
  {
    id: 'skill_stacking',
    category: 'learning',
    name: { en: 'Skill Stacking', de: 'Skill-Stacking' },
    description: {
      en: 'You build complementary skills that combine into a unique professional profile.',
      de: 'Du baust ergänzende Fähigkeiten auf, die ein einzigartiges Profil ergeben.',
    },
    keywords: [
      'skill stack', 'complementary skills', 'combine skills', 'T-shaped', 'multi-skill',
      'skill stack', 'ergänzende fähigkeiten', 'kombinieren', 't-shaped', 'multiskill',
    ],
    relatedTraitIds: ['cross_disciplinary_learning', 'mastery_motivation', 'growth_opportunity'],
  },
  {
    id: 'learning_from_failure',
    category: 'learning',
    name: { en: 'Learning from Failure', de: 'Aus Fehlern lernen' },
    description: {
      en: 'You treat setbacks as sources of insight rather than reasons to stop.',
      de: 'Du siehst Rückschläge als Quelle von Erkenntnissen statt als Grund aufzuhören.',
    },
    keywords: [
      'learn from failure', 'mistake', 'setback lesson', 'fail forward', 'post-mortem',
      'aus fehlern lernen', 'fehler', 'rückschlag', 'fail forward', 'post-mortem',
    ],
    relatedTraitIds: ['resilience', 'reflective_practice', 'experimentation'],
  },
  {
    id: 'rapid_skill_acquisition',
    category: 'learning',
    name: { en: 'Rapid Skill Acquisition', de: 'Schneller Skill-Erwerb' },
    description: {
      en: 'You pick up new skills quickly when a role or project demands them.',
      de: 'Du eignest dir schnell neue Fähigkeiten an, wenn Rolle oder Projekt sie erfordern.',
    },
    keywords: [
      'rapid learning', 'quick skill', 'fast learner', 'pick up fast', 'onboard quickly',
      'schnell lernen', 'schneller skill-erwerb', 'schnell lernen', 'schnell aufnehmen',
    ],
    relatedTraitIds: ['adaptability', 'learning_by_doing', 'variety_seeking'],
  },
  {
    id: 'networking',
    category: 'social_orientation',
    name: { en: 'Networking', de: 'Networking' },
    description: {
      en: 'You build and maintain professional relationships beyond your immediate team.',
      de: 'Du baust berufliche Beziehungen über dein unmittelbares Team hinaus auf und pflegst sie.',
    },
    keywords: [
      'network', 'networking', 'connections', 'professional contacts', 'reach out', 'relationship',
      'netzwerk', 'networking', 'kontakte', 'beziehungen', 'vernetzen', 'kontakt pflegen',
    ],
    relatedTraitIds: ['relationship_building', 'communication', 'bridge_building'],
  },
  {
    id: 'relationship_building',
    category: 'social_orientation',
    name: { en: 'Relationship Building', de: 'Beziehungsaufbau' },
    description: {
      en: 'You invest in trust and rapport with colleagues and partners over time.',
      de: 'Du investierst über Zeit in Vertrauen und gute Beziehungen zu Kollegen und Partnern.',
    },
    keywords: [
      'relationship', 'rapport', 'trust', 'build trust', 'connect', 'bond', 'rapport',
      'beziehung', 'vertrauen', 'aufbauen', 'verbinden', 'bindung', 'beziehungsaufbau',
    ],
    relatedTraitIds: ['empathy', 'networking', 'supportive_colleague'],
  },
  {
    id: 'customer_relations',
    category: 'social_orientation',
    name: { en: 'Customer Relations', de: 'Kundenbeziehungen' },
    description: {
      en: 'You enjoy ongoing interaction and trust-building with clients or users.',
      de: 'Du magst fortlaufenden Austausch und Vertrauensaufbau mit Kunden oder Nutzern.',
    },
    keywords: [
      'customer relations', 'client relationship', 'account management', 'user relationship',
      'kundenbeziehung', 'kundenkontakt', 'account', 'kundenbindung', 'nutzerbeziehung',
    ],
    relatedTraitIds: ['customer_focus', 'service_orientation', 'client_facing_work'],
  },
  {
    id: 'community_engagement',
    category: 'social_orientation',
    name: { en: 'Community Engagement', de: 'Community-Engagement' },
    description: {
      en: 'You connect your work to broader professional or social communities.',
      de: 'Du verbindest deine Arbeit mit breiteren beruflichen oder sozialen Communities.',
    },
    keywords: [
      'community', 'engage community', 'professional community', 'user group', 'forum',
      'community', 'community engagement', 'berufsgemeinschaft', 'nutzergruppe', 'forum',
    ],
    relatedTraitIds: ['community_contribution', 'networking', 'helping_others'],
  },
  {
    id: 'cross_team_collaboration',
    category: 'social_orientation',
    name: { en: 'Cross-Team Collaboration', de: 'Teamübergreifende Zusammenarbeit' },
    description: {
      en: 'You work well across organizational boundaries and different departments.',
      de: 'Du arbeitest gut über Organisationsgrenzen und verschiedene Abteilungen hinweg.',
    },
    keywords: [
      'cross-team', 'cross-functional', 'interdepartmental', 'silos', 'bridge teams',
      'teamübergreifend', 'funktionsübergreifend', 'abteilungsübergreifend', 'silos überwinden',
    ],
    relatedTraitIds: ['teamwork', 'bridge_building', 'collaborative_workspace'],
  },
  {
    id: 'supportive_colleague',
    category: 'social_orientation',
    name: { en: 'Supportive Colleague', de: 'Unterstützende Kollegin / Unterstützender Kollege' },
    description: {
      en: 'You are someone others can rely on for help, backup, and encouragement.',
      de: 'Andere können sich auf dich verlassen — für Hilfe, Rückendeckung und Ermutigung.',
    },
    keywords: [
      'supportive', 'help colleague', 'backup', 'encourage', 'reliable teammate', 'assist',
      'unterstützend', 'kollegen helfen', 'rückendeckung', 'ermutigen', 'zuverlässiger teammate',
    ],
    relatedTraitIds: ['helping_others', 'teamwork', 'empathy'],
  },
  {
    id: 'social_energy',
    category: 'social_orientation',
    name: { en: 'Social Energy', de: 'Soziale Energie' },
    description: {
      en: 'You draw energy and motivation from interaction with people at work.',
      de: 'Du schöpfst Energie und Motivation aus dem Austausch mit Menschen bei der Arbeit.',
    },
    keywords: [
      'social energy', 'people person', 'energized by people', 'extrovert at work', 'sociable',
      'soziale energie', 'menschenmensch', 'energie durch menschen', 'kontaktfreudig',
    ],
    relatedTraitIds: ['teamwork', 'networking', 'dynamic_environment'],
  },
  {
    id: 'consensus_building',
    category: 'social_orientation',
    name: { en: 'Consensus Building', de: 'Konsensbildung' },
    description: {
      en: 'You work toward agreement among people with diverse viewpoints.',
      de: 'Du arbeitest auf Einigung zwischen Menschen mit unterschiedlichen Sichtweisen hin.',
    },
    keywords: [
      'consensus', 'alignment', 'agreement', 'buy-in', 'shared decision', 'unite views',
      'konsens', 'einigung', 'abstimmung', 'buy-in', 'gemeinsame entscheidung',
    ],
    relatedTraitIds: ['facilitation', 'negotiation', 'inclusive_leadership'],
  },
  {
    id: 'cultural_sensitivity',
    category: 'social_orientation',
    name: { en: 'Cultural Sensitivity', de: 'Kulturelle Sensibilität' },
    description: {
      en: 'You respect and adapt to different cultural norms in professional settings.',
      de: 'Du respektierst und passt dich unterschiedlichen kulturellen Normen im Beruf an.',
    },
    keywords: [
      'cultural sensitivity', 'cultural awareness', 'respect differences', 'adapt culturally',
      'kulturelle sensibilität', 'kulturelles bewusstsein', 'unterschiede respektieren',
    ],
    relatedTraitIds: ['cross_cultural_communication', 'respect_for_diversity', 'empathy'],
  },
  {
    id: 'bridge_building',
    category: 'social_orientation',
    name: { en: 'Bridge Building', de: 'Brücken bauen' },
    description: {
      en: 'You connect people and groups who do not usually collaborate.',
      de: 'Du verbindest Menschen und Gruppen, die normalerweise nicht zusammenarbeiten.',
    },
    keywords: [
      'bridge', 'connect groups', 'link teams', 'connector', 'bring together', 'unite',
      'brücke bauen', 'gruppen verbinden', 'teams verknüpfen', 'connector', 'zusammenbringen',
    ],
    relatedTraitIds: ['networking', 'cross_team_collaboration', 'diplomatic_communication'],
  },
];

const TRAIT_BY_ID = new Map(IDENTITY_TRAIT_CATALOG.map((t) => [t.id, t]));

function getTraitDefinition(traitId) {
  return TRAIT_BY_ID.get(String(traitId || '').trim()) || null;
}

function listTraitDefinitions() {
  return IDENTITY_TRAIT_CATALOG.slice();
}

function assertCatalogIntegrity() {
  const ids = new Set();
  for (const trait of IDENTITY_TRAIT_CATALOG) {
    if (!trait.id || ids.has(trait.id)) {
      throw new Error(`Duplicate or missing identity trait id: ${trait.id}`);
    }
    ids.add(trait.id);
    if (!isIdentityCategory(trait.category)) {
      throw new Error(`Unknown category for trait ${trait.id}: ${trait.category}`);
    }
  }
  for (const trait of IDENTITY_TRAIT_CATALOG) {
    for (const relatedId of trait.relatedTraitIds || []) {
      if (!ids.has(relatedId)) {
        throw new Error(`Trait ${trait.id} references unknown related trait ${relatedId}`);
      }
    }
  }
}

module.exports = {
  IDENTITY_TRAIT_CATALOG,
  getTraitDefinition,
  listTraitDefinitions,
  assertCatalogIntegrity,
};
