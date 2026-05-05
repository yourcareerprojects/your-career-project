/**
 * Localized strings for generateRoleFitExplanation (career step “why this role fits you”).
 * English is authoritative for matching logic; German mirrors user-facing sentences only.
 */

export function resolveRoleFitLang(lang) {
  const code = String(lang || 'en').toLowerCase().split('-')[0];
  return code === 'de' ? 'de' : 'en';
}

/** @typedef {{ anchor: string, patternSentence: string }} TraitCopy */

/**
 * Canonical second lines for deterministic assembly (“This role fits because …” / “Zu dieser Rolle passt du, weil …”).
 * @type {Record<string, { en: TraitCopy, de: TraitCopy }>}
 */
export const TRAIT_COPY = {
  complexity: {
    en: {
      anchor: 'handles complexity',
      patternSentence: 'stays effective in complex situations and structures unclear problems',
    },
    de: {
      anchor: 'geht mit Komplexität um',
      patternSentence: 'bleibt in komplexen Situationen handlungsfähig und bringt Struktur in unklare Probleme',
    },
  },

  'systems-thinking': {
    en: {
      anchor: 'thinks in systems',
      patternSentence: 'understands how parts interact and considers long-term effects of decisions',
    },
    de: {
      anchor: 'denkt in Systemen',
      patternSentence: 'versteht Wechselwirkungen und berücksichtigt langfristige Auswirkungen von Entscheidungen',
    },
  },

  ownership: {
    en: {
      anchor: 'takes ownership',
      patternSentence: 'drives work forward without waiting for perfect conditions',
    },
    de: {
      anchor: 'übernimmt Verantwortung',
      patternSentence: 'bringt Arbeit voran, ohne auf perfekte Rahmenbedingungen zu warten',
    },
  },

  prioritization: {
    en: {
      anchor: 'sets priorities',
      patternSentence: 'focuses on what matters most and reduces noise early',
    },
    de: {
      anchor: 'setzt Prioritäten',
      patternSentence: 'konzentriert sich auf das Wesentliche und blendet Unwichtiges früh aus',
    },
  },

  collaboration: {
    en: {
      anchor: 'aligns people',
      patternSentence: 'brings people onto the same page and keeps collaboration productive',
    },
    de: {
      anchor: 'bringt Menschen zusammen',
      patternSentence: 'bringt Menschen auf eine Linie und hält Zusammenarbeit produktiv',
    },
  },

  clarity: {
    en: {
      anchor: 'creates clarity',
      patternSentence: 'turns complex situations into clear next steps',
    },
    de: {
      anchor: 'schafft Klarheit',
      patternSentence: 'übersetzt Komplexität in klare nächste Schritte',
    },
  },

  adaptability: {
    en: {
      anchor: 'adapts quickly',
      patternSentence: 'adjusts approach when conditions change',
    },
    de: {
      anchor: 'passt sich an',
      patternSentence: 'passt den Ansatz an, wenn sich Rahmenbedingungen ändern',
    },
  },

  judgment: {
    en: {
      anchor: 'uses judgment',
      patternSentence: 'makes decisions with incomplete information and balances trade-offs',
    },
    de: {
      anchor: 'trifft fundierte Entscheidungen',
      patternSentence: 'entscheidet auch bei unvollständigen Informationen und wägt Zielkonflikte ab',
    },
  },

  detail: {
    en: {
      anchor: 'focuses on detail',
      patternSentence: 'ensures quality by paying close attention to details and refining work until it holds up',
    },
    de: {
      anchor: 'arbeitet detailgenau',
      patternSentence: 'stellt Qualität sicher, indem Details sorgfältig geprüft und Ergebnisse so lange geschärft werden, bis sie belastbar sind',
    },
  },

  momentum: {
    en: {
      anchor: 'maintains momentum',
      patternSentence: 'keeps progress going even when conditions are unclear or imperfect',
    },
    de: {
      anchor: 'hält Fortschritt aufrecht',
      patternSentence: 'bringt Arbeit voran, auch wenn Rahmenbedingungen unklar oder nicht ideal sind',
    },
  },

  reliability: {
    en: {
      anchor: 'follows through reliably',
      patternSentence: 'delivers consistently and ensures work is carried through to completion',
    },
    de: {
      anchor: 'arbeitet verlässlich',
      patternSentence: 'liefert zuverlässig und stellt sicher, dass Aufgaben konsequent zu Ende gebracht werden',
    },
  },

  communication: {
    en: {
      anchor: 'communicates clearly',
      patternSentence: 'expresses ideas in a way that others can understand and act on',
    },
    de: {
      anchor: 'kommuniziert klar',
      patternSentence: 'vermittelt Inhalte so, dass andere sie verstehen und konkret umsetzen können',
    },
  },

  grounded: {
    en: {
      anchor: 'works pragmatically',
      patternSentence: 'focuses on practical next steps instead of overcomplicating decisions',
    },
    de: {
      anchor: 'arbeitet pragmatisch',
      patternSentence: 'konzentriert sich auf umsetzbare nächste Schritte, statt Entscheidungen unnötig zu verkomplizieren',
    },
  },

  influence: {
    en: {
      anchor: 'influences constructively',
      patternSentence: 'guides thinking and helps groups move toward shared decisions without forcing outcomes',
    },
    de: {
      anchor: 'beeinflusst konstruktiv',
      patternSentence: 'lenkt Denkprozesse und hilft Gruppen, gemeinsame Entscheidungen zu treffen, ohne Druck auszuüben',
    },
  },

  'stakeholder-awareness': {
    en: {
      anchor: 'understands stakeholders',
      patternSentence: 'anticipates different needs and balances competing expectations effectively',
    },
    de: {
      anchor: 'versteht Stakeholder',
      patternSentence: 'erkennt unterschiedliche Bedürfnisse frühzeitig und balanciert konkurrierende Erwartungen',
    },
  },

  decisiveness: {
    en: {
      anchor: 'decides pragmatically',
      patternSentence: 'makes decisions with sufficient information and avoids unnecessary delays',
    },
    de: {
      anchor: 'entscheidet pragmatisch',
      patternSentence: 'trifft Entscheidungen auf Basis ausreichender Informationen und vermeidet unnötiges Zögern',
    },
  },

  'long-term-thinking': {
    en: {
      anchor: 'thinks long-term',
      patternSentence: 'connects current decisions to longer-term outcomes and consequences',
    },
    de: {
      anchor: 'denkt langfristig',
      patternSentence: 'verknüpft aktuelle Entscheidungen mit langfristigen Auswirkungen und Zielen',
    },
  },

  'big-picture-thinking': {
    en: {
      anchor: 'sees the bigger picture',
      patternSentence: 'understands how different elements fit together and provides overall direction',
    },
    de: {
      anchor: 'erkennt das Gesamtbild',
      patternSentence: 'versteht Zusammenhänge und gibt Orientierung über einzelne Aufgaben hinaus',
    },
  },

  'ambiguity-tolerance': {
    en: {
      anchor: 'handles ambiguity',
      patternSentence: 'remains effective when goals or paths are not clearly defined',
    },
    de: {
      anchor: 'geht mit Unsicherheit um',
      patternSentence: 'bleibt handlungsfähig, auch wenn Ziele oder Wege noch unklar sind',
    },
  },

  'structured-thinking-uncertainty': {
    en: {
      anchor: 'structures uncertainty',
      patternSentence: 'turns unclear or vague situations into workable approaches',
    },
    de: {
      anchor: 'strukturiert Unsicherheit',
      patternSentence: 'macht aus unklaren Situationen umsetzbare Ansätze, ohne wichtige Aspekte zu vereinfachen',
    },
  },

  'steady-execution': {
    en: {
      anchor: 'executes steadily',
      patternSentence: 'drives work forward consistently even when complexity and pressure increase',
    },
    de: {
      anchor: 'setzt konsequent um',
      patternSentence: 'bringt Arbeit kontinuierlich voran, auch bei steigender Komplexität und Druck',
    },
  },

  'clear-thinking-under-uncertainty': {
    en: {
      anchor: 'thinks clearly under uncertainty',
      patternSentence: 'distinguishes between known and unknown information and acts accordingly',
    },
    de: {
      anchor: 'denkt klar bei Unsicherheit',
      patternSentence: 'trennt Bekanntes von Vermutungen und handelt auf dieser Grundlage',
    },
  },

  'consistent-follow-through': {
    en: {
      anchor: 'ensures completion',
      patternSentence: 'closes loops and ensures commitments are fully delivered',
    },
    de: {
      anchor: 'bringt Dinge zu Ende',
      patternSentence: 'schließt offene Punkte und stellt sicher, dass Vereinbarungen wirklich umgesetzt werden',
    },
  },

  'flexible-problem-solving': {
    en: {
      anchor: 'solves problems flexibly',
      patternSentence: 'adjusts approach when needed without losing focus on the goal',
    },
    de: {
      anchor: 'löst Probleme flexibel',
      patternSentence: 'passt den Lösungsweg an, ohne das Ziel aus dem Blick zu verlieren',
    },
  },
};


/** @type {Record<string, { en: { summary: string, connection: string }, de: { summary: string, connection: string } }>} */
export const BEHAVIOR_COPY = {
  'quality-verification': {
    en: {
      summary: 'spotting issues early and improving quality through careful checks',
      connection:
        'That matters in this role because progress depends on careful observation, clear judgment, and fixing problems before they scale.',
    },
    de: {
      summary: 'Fehler früh sehen und Qualität durch sorgfältige Kontrolle verbessern',
      connection:
        'In dieser Rolle zählt: genau hinschauen, zuverlässig einschätzen und Probleme kleinhalten, bevor sie eskalieren.',
    },
  },
  'systems-design': {
    en: {
      summary: 'designing robust systems and making complex technical trade-offs clear',
      connection:
        'That matters in this role because the work depends on clear technical judgment, thoughtful trade-offs, and building systems that hold up over time.',
    },
    de: {
      summary: 'tragfähige Systeme entwickeln und technische Zielkonflikte verständlich machen',
      connection:
        'Hier braucht es technisches Urteilsvermögen, sauber abgewogene Kompromisse und Lösungen, die auch nach einiger Zeit noch stehen.',
    },
  },
  'service-operations': {
    en: {
      summary: 'coordinating people and operations so service stays consistent',
      connection:
        'That matters in this role because outcomes depend on keeping teams coordinated, service quality steady, and day-to-day operations running smoothly.',
    },
    de: {
      summary: 'Menschen und Abläufe so koordinieren, dass der Service gleichmäßig gut bleibt',
      connection:
        'Erfolg hängt hier davon ab, dass Teams zusammenspielen, Qualität stabil bleibt und der operative Alltag zuverlässig läuft.',
    },
  },
  sensemaking: {
    en: {
      summary: 'making sense of complexity and choosing a direction',
      connection:
        'That matters in this role because the work depends on spotting patterns, making judgment calls, and helping others move with confidence.',
    },
    de: {
      summary: 'aus komplexem Material ein klares Bild machen und eine Richtung festlegen',
      connection:
        'Gefragt sind Muster erkennen, Lage einschätzen und anderen Orientierung geben, nicht nur Daten sammeln.',
    },
  },
  'structure-execution': {
    en: {
      summary: 'bringing structure and keeping things moving',
      connection:
        'That matters in this role because the real value is keeping priorities clear and turning plans into reliable progress.',
    },
    de: {
      summary: 'Ordnung reinbringen und Dinge zuverlässig voranbringen',
      connection:
        'Der Mehrwert entsteht, wenn Prioritäten klar bleiben und aus Plänen messbarer Fortschritt wird.',
    },
  },
  'message-communication': {
    en: {
      summary: 'understanding people and communicating clearly',
      connection:
        'That way of working is valuable here because success comes from understanding people, shaping clear messages, and turning attention into action.',
    },
    de: {
      summary: 'Menschen verstehen und verständlich kommunizieren',
      connection:
        'Erfolg hängt davon ab, Motive zu erfassen, klare Botschaften zu formulieren und aus Aufmerksamkeit konkretes Handeln zu machen.',
    },
  },
  'community-mobilization': {
    en: {
      summary: 'building trust and moving people around a shared direction',
      connection:
        'That matters in this role because impact comes from building trust, communicating clearly, and helping people move together.',
    },
    de: {
      summary: 'Vertrauen aufbauen und Menschen auf eine gemeinsame Richtung ausrichten',
      connection:
        'Wirkung entsteht, wenn Vertrauen wächst, Klarheit da ist und Gruppen sich wirklich gemeinsam bewegen können.',
    },
  },
  'people-communication': {
    en: {
      summary: 'understanding people and communicating clearly',
      connection:
        'That way of working is valuable here because success comes from understanding people, earning trust, and moving conversations into clear decisions.',
    },
    de: {
      summary: 'Menschen lesen können und Gespräche zu klaren Entscheidungen führen',
      connection:
        'Gefragt ist, Bedürfnisse zu verstehen, Vertrauen aufzubauen und aus Diskussionen handlungsfähige Beschlüsse zu machen.',
    },
  },
  'clarity-creation': {
    en: {
      summary: 'turning ideas into clear outcomes people can use',
      connection:
        'That matters in this role because good outcomes come from shaping ideas into something clear, useful, and actionable.',
    },
    de: {
      summary: 'Ideen in etwas Klares und Nutzbares übersetzen',
      connection:
        'Zentral wird es, wenn aus Konzepten etwas wird, das andere wirklich anwenden können, nicht nur schön klingt.',
    },
  },
  'general-progress': {
    en: {
      summary: 'thinking clearly and following through',
      connection:
        'That matters in this role because steady judgment and follow-through are what keep work moving in the right direction.',
    },
    de: {
      summary: 'sachlich denken und zuverlässig liefern',
      connection:
        'Hier trägt ruhiges Urteil und konsequentes Nachhalten, damit Arbeit nicht nur anläuft, sondern auch ankommt.',
    },
  },
};

/** @param {'en'|'de'} L */
export function getFragments(L) {
  if (L === 'de') {
    return {
      openerPrefix: 'Zu dieser Rolle passt du, weil',
      openerMidRealSituations: ' — und das sieht man daran, wie du echte Situationen angehst',
      openerMidNotTheory: '.',
      bridgeCommaAnd: '. ',
      genericUndefinedTraitAnchor:
        'du auch ohne perfekte Ausgangslage pragmatisch vorankommst und Fortschritt organisierst',
      genericSecondaryNoTraits:
        'Du bleibst sachlich und bringst Bewegung rein, auch wenn Rahmenbedingungen noch unscharf sind.',
      genericUndefinedTraitSentence:
        'Du schaust, was wirklich zählt, und setzt einen klaren nächsten Schritt nach dem anderen',
      genericOpenerTemplates: [
        'deine Arbeitsweise gut zu dem passt, was diese Rolle auszeichnet: {{summary}}',
        'deine Stärken gut zu dem passen, was diese Rolle bei {{summary}} verlangt',
        'du dort besonders trägst, wo es um {{summary}} geht',
      ],
      growthTemplates: [
        'Mit der Zeit können größere Entscheidungen dazukommen, wenn du an Tiefe in {{summary}} gewinnst',
        'Wenn du hier wächst, kannst du deinen Spielraum vergrößern und mitgestalten, wie diese Arbeit läuft',
        'Langfristig kann sich dein Einfluss auf Entscheidungs- und Umsetzungsqualität im Team verstärken',
        'Mit wachsender Expertise kann sich auch dein Verantwortungsbereich durch mehr Vertrauen vergrößern',
      ],
    };
  }
  return {
    openerPrefix: 'This role fits because',
    openerMidRealSituations: ', and that shows up in how you approach real situations',
    openerMidNotTheory: ', not just in theory',
    bridgeCommaAnd: ', and ',
    genericUndefinedTraitAnchor:
      'you tend to work in a practical, steady way when situations are not fully defined',
    genericSecondaryNoTraits:
      'You tend to stay practical and keep progress moving when things are not fully defined',
    genericUndefinedTraitSentence:
      'You usually look for what matters most and keep progress moving one clear step at a time',
    genericOpenerTemplates: [
      'the way you work lines up well with what this role rewards: {{summary}}',
      'your strengths match the kind of judgment this role needs around {{summary}}',
      'you are strongest when work calls for {{summary}}',
    ],
    growthTemplates: [
      'Over time, this can lead to larger decisions as you build depth in {{summary}}',
      'As you grow here, you can expand your scope and shape how this kind of work is run',
      'In the longer run, this can strengthen your influence in how teams make decisions and execute',
      'This can also open a path to broader ownership as your expertise becomes more trusted',
    ],
  };
}

export function hydrateTrait(definition, lang) {
  const L = resolveRoleFitLang(lang);
  const row = TRAIT_COPY[definition.id];
  const pack = row ? row[L] || row.en : null;
  if (!pack) return { ...definition, anchor: '', patternSentence: '' };
  return {
    ...definition,
    anchor: pack.anchor,
    patternSentence: pack.patternSentence,
  };
}

export function localizeBehaviorShell(shell, lang) {
  const L = resolveRoleFitLang(lang);
  const row = BEHAVIOR_COPY[shell.id];
  const pack = row ? row[L] || row.en : null;
  if (!pack) {
    return {
      ...shell,
      summary: shell.summary || '',
      connection: shell.connection || '',
    };
  }
  return {
    ...shell,
    summary: pack.summary,
    connection: pack.connection,
  };
}
