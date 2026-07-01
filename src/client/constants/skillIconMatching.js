const DEFAULT_SKILL_ICON_COLOR = '#5f6368';

/**
 * Ordered rules: first match wins. Patterns run against normalized skill key + label.
 * Icon components are mapped by id in skillIcons.jsx.
 */
const SKILL_ICON_RULES = [
  {
    id: 'health',
    patterns: [
      /health|medical|patient|nurs|therapy|clinical|hospital|pharma|medicine|diagnos/i,
      /gesund|medizin|pflege|klinik|therapie/i,
    ],
    color: '#e53935',
  },
  {
    id: 'science',
    patterns: [
      /science|research|laboratory|lab_|biotech|chemical|physics|biology|chemistry/i,
      /forschung|wissenschaft|\blabor\b|chemie|biologie/i,
    ],
    color: '#1e88e5',
  },
  {
    id: 'data',
    patterns: [
      /data|analytic|statistic|metric|mining|forecast|modelling|modeling|estimation/i,
      /daten|analyse|statistik|prognose/i,
    ],
    color: '#3949ab',
  },
  {
    id: 'software',
    patterns: [
      /software|program|coding|developer|digital|computer|automation|system|it_|tech/i,
      /informatik|digital|programm|entwickl/i,
    ],
    color: '#1e88e5',
  },
  {
    id: 'design',
    patterns: [
      /design|graphic|creative|artistic|visual|layout|media plan|script|color|colour/i,
      /gestaltung|grafik|kreativ|design/i,
    ],
    color: '#ec407a',
  },
  {
    id: 'media',
    patterns: [
      /audio|video|film|broadcast|recording|studio|entertainment/i,
      /audio|video|film|studio/i,
    ],
    color: '#ab47bc',
  },
  {
    id: 'communication',
    patterns: [
      /communicat|speak|present|negotiat|persuad|writing|language|interview/i,
      /kommunikation|sprechen|verhandl|sprache/i,
    ],
    color: '#00897b',
  },
  {
    id: 'customer',
    patterns: [
      /customer|client|sales|retail|service|complaint|inquiry|engagement/i,
      /kunde|kund|verkauf|service|beratung/i,
    ],
    color: '#ff7043',
  },
  {
    id: 'finance',
    patterns: [
      /finance|budget|account|cash|invoice|economic|commerce|storefront/i,
      /finanz|budget|rechnung|wirtschaft/i,
    ],
    color: '#546e7a',
  },
  {
    id: 'legal',
    patterns: [
      /legal|law|regulat|compliance|contract|gavel/i,
      /recht|legal|gesetz|compliance/i,
    ],
    color: '#5d4037',
  },
  {
    id: 'education',
    patterns: [
      /teach|train|coach|educate|instruction|tutor|school|learning|guidance/i,
      /lehr|ausbild|schul|lern|anleit/i,
    ],
    color: '#3949ab',
  },
  {
    id: 'leadership',
    patterns: [
      /lead|supervis|manage|direct|coordinate|planning|schedule|project/i,
      /führ|leit|manag|plan|koordin/i,
    ],
    color: '#5c6bc0',
  },
  {
    id: 'teamwork',
    patterns: [
      /team|collaborat|cooperat|group|together/i,
      /team|zusammenarbeit|kooperat/i,
    ],
    color: '#26a69a',
  },
  {
    id: 'safety',
    patterns: [
      /safety|security|protect|risk|hazard|shield/i,
      /sicher|schutz|risiko/i,
    ],
    color: '#455a64',
  },
  {
    id: 'quality',
    patterns: [
      /quality|standard|inspect|audit|verify|control analysis/i,
      /qualität|prüf|kontroll/i,
    ],
    color: '#00897b',
  },
  {
    id: 'logistics',
    patterns: [
      /logistic|shipping|transport|cargo|delivery|supply chain|vehicle/i,
      /logistik|transport|liefer|fracht/i,
    ],
    color: '#26c6da',
  },
  {
    id: 'agriculture',
    patterns: [
      /agri|farm|crop|livestock|animal|forest|horticult|veterinar|horse/i,
      /landwirt|tier|agrar|forst|pferd/i,
    ],
    color: '#7cb342',
  },
  {
    id: 'construction',
    patterns: [
      /construct|build|install|site prep|roof|plumb|electr|carpent|mason|concrete/i,
      /bau|install|montage|dach|elektr/i,
    ],
    color: '#8d6e63',
  },
  {
    id: 'engineering',
    patterns: [
      /engineer|mechanic|technical|machin|equipment|fault diagnos|problem.solv|troubleshoot/i,
      /ingenieur|technik|maschinen|problemlösung|fehlerbehebung/i,
    ],
    color: '#78909c',
  },
  {
    id: 'craft',
    patterns: [
      /craft|handyman|wood|metal|cutting|solder|weld|finishing|coat|tool/i,
      /handwerk|holz|metall|schneid|lack/i,
    ],
    color: '#6d4c41',
  },
  {
    id: 'architecture',
    patterns: [
      /architect|urban|spatial|building design/i,
      /architekt|städtebau/i,
    ],
    color: '#8d6e63',
  },
  {
    id: 'counselling',
    patterns: [
      /counsel|council|psycholog|mental|wellbeing|well being|social/i,
      /psycholog|sozial/i,
    ],
    color: '#7e57c2',
  },
  {
    id: 'math',
    patterns: [
      /math|calculat|numeric|quant/i,
      /mathem|rechnen|berechn/i,
    ],
    color: '#3949ab',
  },
  {
    id: 'retail',
    patterns: [
      /retail|shop|store|merchand/i,
      /einzelhandel|laden|geschäft/i,
    ],
    color: '#ff7043',
  },
  {
    id: 'manufacturing',
    patterns: [
      /manufact|production|factory|assembly/i,
      /produktion|fertigung|fabrik/i,
    ],
    color: '#6d4c41',
  },
  {
    id: 'biotech',
    patterns: [/biotech|life science|genetic/i, /biotech|gentechnik/i],
    color: '#43a047',
  },
];

function normalizeSkillMatchText(skillKey = '', skillLabel = '') {
  return `${String(skillKey || '')} ${String(skillLabel || '')}`
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveSkillIconCategory(skillKey = '', skillLabel = '') {
  const text = normalizeSkillMatchText(skillKey, skillLabel);
  if (!text) return null;
  for (const rule of SKILL_ICON_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return rule.id;
    }
  }
  return null;
}

function getSkillIconColor(categoryId) {
  if (!categoryId) return DEFAULT_SKILL_ICON_COLOR;
  const rule = SKILL_ICON_RULES.find((item) => item.id === categoryId);
  return rule?.color || DEFAULT_SKILL_ICON_COLOR;
}

module.exports = {
  DEFAULT_SKILL_ICON_COLOR,
  SKILL_ICON_RULES,
  normalizeSkillMatchText,
  resolveSkillIconCategory,
  getSkillIconColor,
};
