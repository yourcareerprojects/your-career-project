/**
 * Canonical industry / economic-sector taxonomy for profile `domains` and occupation
 * `CareerPath.domain` (exactly one domain per occupation).
 * Stored values use English {@link IndustryEntry.label.en}; UI shows localized labels.
 *
 * Keep server normalization, CV extraction, coaching prompts, and client pickers in sync.
 */
const { isBlockedNonIndustryDomain, normalizeDomainKey } = require('../server/constants/industryDomainFilters');

/** @typedef {{ id: string, label: { en: string, de: string }, aliases?: string[], patterns?: RegExp[] }} IndustryEntry */

const INDUSTRY_TAXONOMY = [
  {
    id: 'healthcare',
    label: { en: 'Healthcare', de: 'Gesundheitswesen' },
    aliases: [
      'health tech',
      'healthcare technology',
      'medical',
      'hospital',
      'clinical',
      'gesundheit',
      'MedTech',
      'medtech',
      'med tech',
      'medical devices',
      'medical device',
      'digital health',
    ],
    patterns: [
      /\bhospital\b/,
      /\bclinic\b/,
      /\bpatient\b/,
      /\bhealthcare\b/,
      /\bgesundheit\b/,
      /\bmedtech\b/,
      /\bmedical device\b/,
      /\bdigital health\b/,
    ],
  },
  {
    id: 'animals_veterinary',
    label: { en: 'Animals and Veterinary', de: 'Tiere und Veterinärwesen' },
    aliases: [
      'animals & veterinary',
      'animal and veterinary',
      'veterinary',
      'veterinary medicine',
      'veterinary services',
      'veterinary care',
      'veterinarian',
      'animal care',
      'animal health',
      'pet care',
      'tiere',
      'veterinärwesen',
      'veterinärmedizin',
      'tierarzt',
      'tierärztin',
      'tiergesundheit',
      'tierpflege',
    ],
    patterns: [
      /\banimals and veterinary\b/,
      /\btiere und veterinärwesen\b/,
      /\bveterinary\b/,
      /\bveterinar/,
      /\bveterinär/,
      /\btierarzt\b/,
      /\btierärzt/,
      /\btierpflege\b/,
      /\btierpfleger/,
      /\banimal care\b/,
      /\banimal health\b/,
      /\bpet care\b/,
    ],
  },
  {
    id: 'natural_sciences',
    label: { en: 'Natural Sciences', de: 'Naturwissenschaften' },
    aliases: [
      'biology',
      'biologie',
      'biological sciences',
      'life sciences',
      'life science',
      'life science research',
      'biotech',
      'biotechnology',
      'biosciences',
      'physics',
      'physik',
      'physical sciences',
      'biophysics',
      'biophysik',
      'chemistry',
      'chemiewissenschaften',
      'chemical sciences',
      'science of chemistry',
      'chemicals',
      'chemie',
      'chemical industry',
      'specialty chemicals',
      'earth sciences',
      'geowissenschaften',
      'geosciences',
      'geology',
      'mathematics',
      'mathematik',
      'math',
      'applied mathematics',
      'natural science',
      'naturwissenschaft',
    ],
    patterns: [
      /\bnatural sciences?\b/,
      /\bnaturwissenschaften?\b/,
      /\bbiology\b/,
      /\bbiologie\b/,
      /\bbiological sciences\b/,
      /\blife sciences?\b/,
      /\bbiotech\b/,
      /\bbiotechnology\b/,
      /\bphysics\b/,
      /\bphysik\b/,
      /\bphysical sciences\b/,
      /\bbiophysics\b/,
      /\bbiophysik\b/,
      /\bchemistry\b/,
      /\bchemiewissenschaften\b/,
      /\bchemical sciences\b/,
      /\bchemicals?\b/,
      /\bchemie\b/,
      /\bearth sciences?\b/,
      /\bgeowissenschaften\b/,
      /\bgeosciences\b/,
      /\bgeology\b/,
      /\bmathematics\b/,
      /\bmathematik\b/,
    ],
  },
  {
    id: 'environmental_science',
    label: { en: 'Environmental Science', de: 'Umweltwissenschaften' },
    aliases: ['environmental sciences', 'ecological science'],
    patterns: [/\benvironmental science\b/, /\bumweltwissenschaften\b/],
  },
  {
    id: 'social_language_sciences',
    label: { en: 'Social and Language Sciences', de: 'Sozial- und Sprachwissenschaften' },
    aliases: [
      'social sciences',
      'language sciences',
      'linguistics',
      'sozialwissenschaften',
      'sprachwissenschaften',
      'sozial und sprachwissenschaften',
    ],
    patterns: [
      /\bsocial and language sciences\b/,
      /\bsocial sciences\b/,
      /\blanguage sciences\b/,
      /\blinguistics\b/,
      /\bsozial-?\s*und\s*sprachwissenschaften\b/,
      /\bsozialwissenschaften\b/,
      /\bsprachwissenschaften\b/,
    ],
  },
  {
    id: 'pharmaceuticals',
    label: { en: 'Pharmaceuticals', de: 'Pharma' },
    aliases: ['pharma', 'pharmaceutical', 'pharmazeutik'],
    patterns: [/\bpharma\b/, /\bpharmaceutical\b/],
  },
  {
    id: 'finance',
    label: { en: 'Finance', de: 'Finanzwesen' },
    aliases: ['financial services', 'fintech', 'banking', 'capital markets'],
    patterns: [/\bfintech\b/, /\bbanking\b/, /\bfinance\b/, /\bfinancial services\b/],
  },
  {
    id: 'economy',
    label: { en: 'Economy', de: 'Wirtschaft' },
    aliases: ['economics', 'economic sector', 'wirtschaftswissenschaften', 'volkswirtschaft', 'volkswirtschaftslehre'],
    patterns: [/\beconomy\b/, /\beconomics\b/, /\bwirtschaft\b/, /\bvolkswirtschaft/, /\bwirtschaftswissenschaft/],
  },
  {
    id: 'insurance',
    label: { en: 'Insurance', de: 'Versicherung' },
    aliases: ['insurtech'],
    patterns: [/\binsurance\b/, /\bversicherung\b/],
  },
  {
    id: 'software',
    label: { en: 'Software', de: 'Software' },
    aliases: ['technology', 'tech industry', 'it industry', 'information technology', 'technologie', 'it branche'],
    patterns: [/\bsoftware\b(?!\s+engineering)/, /\bsaas\b/],
  },
  {
    id: 'artificial_intelligence',
    label: { en: 'Artificial Intelligence', de: 'Künstliche Intelligenz' },
    aliases: ['ai', 'machine learning industry', 'ml industry'],
    patterns: [/\bartificial intelligence\b/, /\bmachine learning\b/, /\b(?<![\w-])ai(?![\w-])\b/],
  },
  {
    id: 'telecommunications',
    label: { en: 'Telecommunications', de: 'Telekommunikation' },
    aliases: ['telecom', 'telco'],
    patterns: [/\btelecom\b/, /\btelecommunications\b/],
  },
  {
    id: 'ecommerce',
    label: { en: 'Sales and Customer Service', de: 'Vertrieb und Kundenservice' },
    aliases: [
      'e-commerce',
      'e commerce',
      'ecommerce',
      'online retail',
      'digital commerce',
      'sales',
      'vertrieb',
      'customer service',
      'kundenservice',
      'sales & customer service',
      'vertrieb & kundenservice',
    ],
    patterns: [
      /\bsales and customer service\b/,
      /\bvertrieb und kundenservice\b/,
      /\be-?commerce\b/,
      /\bonline retail\b/,
      /\bmarketplace\b/,
      /\bkundenservice\b/,
      /\bvertrieb\b/,
    ],
  },
  {
    id: 'retail',
    label: { en: 'Retail', de: 'Einzelhandel' },
    aliases: ['consumer retail', 'brick and mortar'],
    patterns: [/\bretail\b/, /\beinzelhandel\b/],
  },
  {
    id: 'manufacturing',
    label: { en: 'Manufacturing', de: 'Fertigung' },
    aliases: ['industrial manufacturing', 'production industry'],
    patterns: [/\bmanufacturing\b/, /\bfactory\b/, /\bfertigung\b/],
  },
  {
    id: 'automotive',
    label: { en: 'Automotive', de: 'Automobil' },
    aliases: ['auto industry', 'mobility automotive', 'automotive trades', 'kfz-handwerk', 'automotive repair', 'kfz handwerk', 'kfz-mechatroniker', 'car mechanic', 'karosseriebauer'],
    patterns: [/\bautomotive\b/, /\bautomobil\b/, /\bautomotive trades\b/, /\bkfz-handwerk\b/, /\bkfz handwerk\b/, /\bkfz mechatroniker\b/, /\bkarosseriebauer\b/, /\bcar mechanic\b/],
  },
  {
    id: 'aerospace',
    label: { en: 'Aerospace', de: 'Luft- und Raumfahrt' },
    aliases: ['aviation', 'space industry'],
    patterns: [/\baerospace\b/, /\baviation\b/, /\braumfahrt\b/],
  },
  {
    id: 'mobility_logistics',
    label: { en: 'Mobility & Logistics', de: 'Mobilität & Logistik' },
    aliases: ['mobility', 'logistics', 'transport', 'supply chain'],
    patterns: [/\bmobility\b/, /\blogistics\b/, /\btransport\b/, /\bsupply chain\b/],
  },
  {
    id: 'energy',
    label: { en: 'Energy', de: 'Energie' },
    aliases: ['utilities', 'power generation', 'oil and gas', 'renewable energy'],
    patterns: [/\benergy\b/, /\butilities\b/, /\boil and gas\b/, /\brenewable\b/, /\benergie\b/],
  },
  {
    id: 'sustainability',
    label: { en: 'Sustainability', de: 'Nachhaltigkeit' },
    aliases: ['climate', 'cleantech', 'green tech', 'esg', 'umwelt', 'environment'],
    patterns: [/\bsustainability\b/, /\bclimate\b/, /\besg\b/, /\bcleantech\b/],
  },
  {
    id: 'agriculture',
    label: { en: 'Agriculture', de: 'Landwirtschaft' },
    aliases: ['agrifood', 'farming', 'agribusiness'],
    patterns: [/\bagriculture\b/, /\bfarming\b/, /\bagribusiness\b/, /\bagrifood\b/],
  },
  {
    id: 'food_beverage',
    label: { en: 'Food & Beverage', de: 'Lebensmittel & Getränke' },
    aliases: ['food industry', 'fmcg', 'consumer goods', 'food trades', 'lebensmittelhandwerk'],
    patterns: [/\bfood and beverage\b/, /\bfmcg\b/, /\bconsumer goods\b/, /\bfood trades\b/, /\blebensmittelhandwerk\b/],
  },
  {
    id: 'mining_metals',
    label: { en: 'Mining', de: 'Bergbau' },
    aliases: ['mining & metals', 'bergbau & metalle', 'metals', 'raw materials'],
    patterns: [/\bmining\b/, /\bmetals\b/, /\bbergbau\b/],
  },
  {
    id: 'construction',
    label: { en: 'Construction', de: 'Bauwesen' },
    aliases: ['building industry', 'civil engineering industry', 'roofing & building envelope', 'dach & gebäudehülle', 'roofing', 'dachdecker', 'glaser', 'building envelope', 'facade trades'],
    patterns: [/\bconstruction\b/, /\bbauwesen\b/, /\bbauindustrie\b/, /\broofing and building envelope\b/, /\bdach\s*&\s*gebäudehülle\b/, /\broofing\b/, /\bdachdecker\b/, /\bglaser\b/, /\bbuilding envelope\b/, /\bfassadenbau\b/],
  },
  {
    id: 'skilled_trades',
    label: { en: 'Skilled Trades', de: 'Handwerk' },
    aliases: [
      'trades',
      'craft trades',
      'manual trades',
      'gewerbe',
      'handwerkliche berufe',
      'handwerksberufe',
      'painting & finishing',
      'painting and finishing',
      'maler & lackierer',
      'painting trades',
      'maler',
      'lackierer',
      'stuckateur',
      'plasterer',
      'finishing trades',
    ],
    patterns: [
      /\bskilled trades\b/,
      /\bhandwerk\b/,
      /\bhandwerks\b/,
      /\bgewerbe\b/,
      /\bcraft trades\b/,
      /\bmaler\b/,
      /\blackierer\b/,
      /\bstuckateur\b/,
      /\bpainting and finishing\b/,
      /\bpainting & finishing\b/,
      /\bpainter\b/,
    ],
  },
  {
    id: 'electrical_trades',
    label: { en: 'Electrical Trades', de: 'Elektrotechnik' },
    aliases: ['electrical trades', 'electrician', 'elektroniker', 'elektriker', 'electrical installation'],
    patterns: [/\belektrotechnik\b/, /\belektriker\b/, /\belektrikerin\b/, /\belektroinstallateur\b/, /\belectrician\b/],
  },
  {
    id: 'plumbing_hvac',
    label: { en: 'Plumbing & HVAC', de: 'Sanitär, Heizung & Klima' },
    aliases: ['plumbing', 'hvac', 'sanitär', 'heizung', 'klima', 'shk', 'anlagenmechaniker'],
    patterns: [/\bplumbing\b/, /\bhvac\b/, /\bsanitär\b/, /\bheizung\b/, /\bklima\b/, /\bshk\b/, /\banlagenmechaniker\b/],
  },
  {
    id: 'metalworking',
    label: { en: 'Metalworking', de: 'Metallberufe' },
    aliases: ['metal trades', 'metallhandwerk', 'welding', 'schweißer', 'zerspanungsmechaniker', 'industrial mechanic'],
    patterns: [/\bmetalworking\b/, /\bmetallberufe\b/, /\bmetallhandwerk\b/, /\bschweißer\b/, /\bzerspanungsmechaniker\b/, /\bwelder\b/],
  },
  {
    id: 'woodworking_carpentry',
    label: { en: 'Woodworking & Carpentry', de: 'Holz & Tischlerhandwerk' },
    aliases: ['woodworking', 'carpentry', 'tischler', 'schreiner', 'zimmermann', 'joinery'],
    patterns: [/\bwoodworking\b/, /\bcarpentry\b/, /\btischler\b/, /\bschreiner\b/, /\bzimmermann\b/, /\bholzhandwerk\b/],
  },
  {
    id: 'beauty_personal_care',
    label: { en: 'Beauty & Personal Care', de: 'Beauty & Körperpflege' },
    aliases: ['beauty trades', 'friseur', 'kosmetiker', 'hairdressing', 'personal care trades'],
    patterns: [/\bfriseur\b/, /\bkosmetiker\b/, /\bhairdresser\b/, /\bbeauty and personal care\b/, /\bkörperpflege\b/],
  },
  {
    id: 'gardening_landscaping',
    label: { en: 'Gardening & Landscaping', de: 'Garten- & Landschaftsbau' },
    aliases: ['landscaping', 'gartenbau', 'landschaftsbau', 'gärtner', 'landscape gardening'],
    patterns: [/\bgardening\b/, /\blandscaping\b/, /\bgartenbau\b/, /\blandschaftsbau\b/, /\bgärtner\b/],
  },
  {
    id: 'cleaning_facility_services',
    label: { en: 'Cleaning & Facility Services', de: 'Reinigung & Gebäudeservice' },
    aliases: ['facility services', 'cleaning services', 'gebäudereiniger', 'reinigung', 'building services'],
    patterns: [/\bfacility services\b/, /\bgebäudeservice\b/, /\bgebäudereiniger\b/, /\breinigung\b/, /\bcleaning services\b/],
  },
  {
    id: 'architecture',
    label: { en: 'Architecture', de: 'Architektur' },
    aliases: ['architectural services', 'city planning', 'town planning', 'urban planning', 'stadtplanung'],
    patterns: [/\barchitecture\b/, /\barchitektur\b/, /\burban planning\b/, /\bstadtplanung\b/, /\bcity planning\b/, /\btown planning\b/],
  },
  {
    id: 'real_estate',
    label: { en: 'Real Estate', de: 'Immobilien' },
    aliases: ['property', 'proptech'],
    patterns: [/\breal estate\b/, /\bimmobilien\b/, /\bproptech\b/],
  },
  {
    id: 'education',
    label: { en: 'Education', de: 'Bildung' },
    aliases: ['edtech', 'higher education', 'schools', 'bildung'],
    patterns: [/\bedtech\b/, /\beducation\b/, /\buniversity\b/, /\bteaching\b/, /\bbildung\b/],
  },
  {
    id: 'media_entertainment',
    label: { en: 'Media & Entertainment', de: 'Medien & Unterhaltung' },
    aliases: ['media', 'entertainment', 'gaming industry', 'publishing', 'medien'],
    patterns: [/\bmedia\b/, /\bentertainment\b/, /\bgaming industry\b/, /\bpublishing\b/],
  },
  {
    id: 'marketing',
    label: { en: 'Marketing', de: 'Marketing' },
    aliases: [
      'digital marketing',
      'content marketing',
      'growth marketing',
      'social media marketing',
      'influencer marketing',
      'performance marketing',
      'marketing industry',
      'marketingbranche',
    ],
    patterns: [
      /\bmarketing\b/,
      /\bdigital marketing\b/,
      /\bcontent marketing\b/,
      /\bgrowth marketing\b/,
      /\bperformance marketing\b/,
      /\bmarketingbranche\b/,
    ],
  },
  {
    id: 'culture',
    label: { en: 'Culture', de: 'Kultur' },
    aliases: ['arts and culture', 'cultural sector', 'kulturwirtschaft'],
    patterns: [/\bkultur\b/, /\bcultural sector\b/, /\barts and culture\b/],
  },
  {
    id: 'hospitality',
    label: { en: 'Hospitality', de: 'Gastgewerbe' },
    aliases: ['hotels', 'restaurants', 'food service'],
    patterns: [/\bhospitality\b/, /\bhotel\b/, /\bgastgewerbe\b/],
  },
  {
    id: 'tourism_travel',
    label: { en: 'Tourism & Travel', de: 'Tourismus & Reisen' },
    aliases: ['travel', 'tourism'],
    patterns: [/\btourism\b/, /\btravel industry\b/, /\btourismus\b/],
  },
  {
    id: 'sports',
    label: { en: 'Sports', de: 'Sport' },
    aliases: ['sports industry', 'fitness industry'],
    patterns: [/\bsports\b/, /\bathlete\b/, /\bfitness\b/],
  },
  {
    id: 'fashion_apparel',
    label: { en: 'Fashion & Apparel', de: 'Mode & Bekleidung' },
    aliases: ['fashion', 'apparel', 'luxury goods'],
    patterns: [/\bfashion\b/, /\bapparel\b/, /\bluxury goods\b/],
  },
  {
    id: 'legal_services',
    label: { en: 'Legal Services', de: 'Rechtswesen' },
    aliases: ['legal', 'law firms'],
    patterns: [/\blegal services\b/, /\blaw firm\b/],
  },
  {
    id: 'public_sector',
    label: { en: 'Public Sector', de: 'Öffentlicher Sektor' },
    aliases: ['government', 'public administration', 'civil service'],
    patterns: [/\bgovernment\b/, /\bpublic sector\b/, /\böffentlicher dienst\b/],
  },
  {
    id: 'nonprofit',
    label: { en: 'Nonprofit', de: 'Non-Profit' },
    aliases: ['ngo', 'social impact', 'charity'],
    patterns: [/\bnonprofit\b/, /\bnon-profit\b/, /\bngo\b/],
  },
  {
    id: 'social_work',
    label: { en: 'Social Work', de: 'Soziale Arbeit' },
    aliases: ['social services', 'social care', 'sozialwesen', 'youth welfare', 'jugendhilfe'],
    patterns: [/\bsocial work\b/, /\bsoziale arbeit\b/, /\bsozialarbeit\b/, /\bsocial services\b/, /\bsozialwesen\b/],
  },
  {
    id: 'defense_security',
    label: { en: 'Defense & Security', de: 'Verteidigung & Sicherheit' },
    aliases: ['defense', 'cybersecurity industry', 'security industry'],
    patterns: [/\bdefense\b/, /\bverteidigung\b/, /\bsecurity industry\b/],
  },
];

const CANONICAL_BY_KEY = new Map();
const ENTRY_BY_CANONICAL = new Map();
const INDUSTRY_BY_ID = new Map();

function registerIndustry(entry) {
  const canonical = entry.label.en;
  INDUSTRY_BY_ID.set(entry.id, entry);
  ENTRY_BY_CANONICAL.set(canonical.toLowerCase(), entry);
  CANONICAL_BY_KEY.set(normalizeDomainKey(canonical), canonical);
  CANONICAL_BY_KEY.set(normalizeDomainKey(entry.label.de), canonical);
  for (const alias of entry.aliases || []) {
    CANONICAL_BY_KEY.set(normalizeDomainKey(alias), canonical);
  }
}

for (const entry of INDUSTRY_TAXONOMY) {
  registerIndustry(entry);
}

const INDUSTRY_CANONICAL_LABELS = INDUSTRY_TAXONOMY.map((entry) => entry.label.en);

/**
 * Temporary sentinel for occupations that have not been classified yet.
 * Not part of the industry taxonomy; allowed only on CareerPath.domain during migration.
 */
const UNASSIGNED_ROLE_DOMAIN = 'UNASSIGNED';

/** Valid CareerPath.domain values: taxonomy labels + {@link UNASSIGNED_ROLE_DOMAIN}. */
const OCCUPATION_DOMAIN_VALUES = Object.freeze([
  ...INDUSTRY_CANONICAL_LABELS,
  UNASSIGNED_ROLE_DOMAIN,
]);

const OCCUPATION_DOMAIN_SET = new Set(OCCUPATION_DOMAIN_VALUES);

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
function isValidOccupationDomain(raw) {
  return OCCUPATION_DOMAIN_SET.has(String(raw ?? '').trim());
}

/**
 * Normalize a role-domain value for storage on CareerPath.
 * Accepts taxonomy labels/aliases; maps empty/null to UNASSIGNED when allowed.
 * Does not invent or infer a domain from occupation content.
 *
 * @param {unknown} raw
 * @param {{ allowUnassigned?: boolean }} [options]
 * @returns {string|null} Canonical English label, UNASSIGNED, or null if invalid
 */
function normalizeOccupationDomain(raw, { allowUnassigned = true } = {}) {
  if (raw == null || String(raw).trim() === '') {
    return allowUnassigned ? UNASSIGNED_ROLE_DOMAIN : null;
  }
  const trimmed = String(raw).trim();
  if (trimmed === UNASSIGNED_ROLE_DOMAIN) {
    return allowUnassigned ? UNASSIGNED_ROLE_DOMAIN : null;
  }
  return resolveCanonicalIndustry(trimmed);
}

function normalizeIndustryLang(lang = 'en') {
  return String(lang || 'en').toLowerCase().split('-')[0] === 'de' ? 'de' : 'en';
}

function toTitleCase(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Map free text to canonical English industry label, or null when blocked / empty.
 * @param {string} raw
 * @param {{ keepUnknown?: boolean }} [options]
 * @returns {string|null}
 */
function normalizeIndustryLabel(raw, { keepUnknown = false } = {}) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const canonical = CANONICAL_BY_KEY.get(normalizeDomainKey(trimmed));
  if (canonical) return canonical;

  if (isBlockedNonIndustryDomain(trimmed)) return null;

  if (keepUnknown) return toTitleCase(trimmed);
  return null;
}

/**
 * @param {string} raw
 * @returns {string|null}
 */
function resolveCanonicalIndustry(raw) {
  return normalizeIndustryLabel(raw, { keepUnknown: false });
}

/**
 * @param {Array<string|object>} items
 * @param {{ keepUnknown?: boolean, maxItems?: number }} [options]
 * @returns {string[]}
 */
function normalizeIndustryDomains(items = [], { keepUnknown = true, maxItems } = {}) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const text = typeof item === 'string'
      ? item
      : (item && typeof item === 'object' ? (item.name || item.label || item.en || '') : String(item || ''));
    const normalized = normalizeIndustryLabel(text, { keepUnknown });
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (maxItems && out.length >= maxItems) break;
  }
  return out;
}

/**
 * @param {string} stored
 * @returns {string|null}
 */
function resolveIndustryId(stored) {
  const canonical = resolveCanonicalIndustry(stored) || String(stored || '').trim();
  if (!canonical) return null;
  const entry = ENTRY_BY_CANONICAL.get(canonical.toLowerCase());
  return entry?.id || null;
}

/**
 * @param {string} stored
 * @param {string} [lang]
 * @returns {string}
 */
function resolveIndustryDisplayLabel(stored, lang = 'en') {
  const code = normalizeIndustryLang(lang);
  const canonical = resolveCanonicalIndustry(stored) || String(stored || '').trim();
  if (!canonical) return '';
  const entry = ENTRY_BY_CANONICAL.get(canonical.toLowerCase());
  if (!entry) return canonical;
  return entry.label[code] || entry.label.en;
}

/**
 * Values that may appear on CareerPath.domain / profile domains for one taxonomy entry,
 * including legacy labels after domain merges (exact string match for Mongo `$in`).
 *
 * @param {unknown} raw Canonical English label, localized label, or alias
 * @returns {string[]} Non-empty when raw resolves; otherwise []
 */
function listOccupationDomainFilterValues(raw) {
  const canonical = resolveCanonicalIndustry(raw);
  if (!canonical) return [];
  const entry = ENTRY_BY_CANONICAL.get(canonical.toLowerCase());
  const values = new Set([canonical]);
  if (!entry) return [canonical];

  values.add(entry.label.en);
  if (entry.label.de) values.add(entry.label.de);
  for (const alias of entry.aliases || []) {
    const trimmed = String(alias || '').trim();
    if (!trimmed) continue;
    values.add(trimmed);
    values.add(toTitleCase(trimmed));
  }
  return [...values];
}

/**
 * @param {string} [lang]
 * @returns {Array<{ id: string, value: string, label: string }>}
 */
function listIndustryOptions(lang = 'en') {
  const code = normalizeIndustryLang(lang);
  return INDUSTRY_TAXONOMY
    .map((entry) => ({
      id: entry.id,
      value: entry.label.en,
      label: entry.label[code] || entry.label.en,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, code));
}

/**
 * Comma-separated industry names for LLM prompts.
 * @param {string} [lang]
 */
function formatIndustryTaxonomyForPrompt(lang = 'en') {
  const code = normalizeIndustryLang(lang);
  return INDUSTRY_TAXONOMY.map((entry) => entry.label[code] || entry.label.en).join(', ');
}

/**
 * Heuristic industry inference from document text (CV fallback).
 * @param {string} text
 * @param {{ maxItems?: number }} [options]
 * @returns {string[]}
 */
function inferIndustriesFromText(text, { maxItems = 6 } = {}) {
  const t = String(text || '').toLowerCase();
  const out = [];
  const seen = new Set();
  for (const entry of INDUSTRY_TAXONOMY) {
    const matched = (entry.patterns || []).some((pattern) => pattern.test(t));
    if (!matched) continue;
    const canonical = entry.label.en;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
    if (out.length >= maxItems) break;
  }
  return out;
}

module.exports = {
  INDUSTRY_TAXONOMY,
  INDUSTRY_CANONICAL_LABELS,
  UNASSIGNED_ROLE_DOMAIN,
  OCCUPATION_DOMAIN_VALUES,
  isValidOccupationDomain,
  normalizeOccupationDomain,
  normalizeIndustryLabel,
  normalizeIndustryDomains,
  resolveCanonicalIndustry,
  resolveIndustryId,
  resolveIndustryDisplayLabel,
  listOccupationDomainFilterValues,
  listIndustryOptions,
  formatIndustryTaxonomyForPrompt,
  inferIndustriesFromText,
};
