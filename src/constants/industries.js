/**
 * Canonical industry / economic-sector taxonomy for profile `domains`.
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
    aliases: ['health tech', 'healthcare technology', 'medical', 'hospital', 'clinical', 'gesundheit'],
    patterns: [/\bhospital\b/, /\bclinic\b/, /\bpatient\b/, /\bhealthcare\b/, /\bgesundheit\b/],
  },
  {
    id: 'medtech',
    label: { en: 'MedTech', de: 'MedTech' },
    aliases: ['med tech', 'medical devices', 'medical device', 'digital health'],
    patterns: [/\bmedtech\b/, /\bmedical device\b/, /\bdigital health\b/],
  },
  {
    id: 'life_sciences',
    label: { en: 'Life Sciences', de: 'Life Sciences' },
    aliases: ['life science', 'biotech', 'biotechnology', 'biosciences'],
    patterns: [/\blife sciences?\b/, /\bbiotech\b/, /\bbiotechnology\b/],
  },
  {
    id: 'biophysics',
    label: { en: 'Biophysics', de: 'Biophysik' },
    aliases: ['biophysics'],
    patterns: [/\bbiophysics\b/, /\bbiophysik\b/],
  },
  {
    id: 'biology',
    label: { en: 'Biology', de: 'Biologie' },
    aliases: ['biological sciences', 'life science research'],
    patterns: [/\bbiology\b/, /\bbiologie\b/, /\bbiological sciences\b/],
  },
  {
    id: 'physics',
    label: { en: 'Physics', de: 'Physik' },
    aliases: ['physical sciences'],
    patterns: [/\bphysics\b/, /\bphysik\b/, /\bphysical sciences\b/],
  },
  {
    id: 'chemistry_science',
    label: { en: 'Chemistry', de: 'Chemiewissenschaften' },
    aliases: ['chemical sciences', 'science of chemistry'],
    patterns: [/\bchemiewissenschaften\b/, /\bchemical sciences\b/],
  },
  {
    id: 'environmental_science',
    label: { en: 'Environmental Science', de: 'Umweltwissenschaften' },
    aliases: ['environmental sciences', 'ecological science'],
    patterns: [/\benvironmental science\b/, /\bumweltwissenschaften\b/],
  },
  {
    id: 'earth_sciences',
    label: { en: 'Earth Sciences', de: 'Geowissenschaften' },
    aliases: ['geosciences', 'geology'],
    patterns: [/\bearth sciences?\b/, /\bgeowissenschaften\b/, /\bgeosciences\b/],
  },
  {
    id: 'mathematics',
    label: { en: 'Mathematics', de: 'Mathematik' },
    aliases: ['math', 'applied mathematics'],
    patterns: [/\bmathematics\b/, /\bmathematik\b/],
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
    label: { en: 'E-commerce', de: 'E-Commerce' },
    aliases: ['e commerce', 'ecommerce', 'online retail', 'digital commerce'],
    patterns: [/\be-?commerce\b/, /\bonline retail\b/, /\bmarketplace\b/],
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
    aliases: ['auto industry', 'mobility automotive'],
    patterns: [/\bautomotive\b/, /\bautomobil\b/],
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
    aliases: ['food industry', 'fmcg', 'consumer goods'],
    patterns: [/\bfood and beverage\b/, /\bfmcg\b/, /\bconsumer goods\b/],
  },
  {
    id: 'chemicals',
    label: { en: 'Chemicals', de: 'Chemie' },
    aliases: ['chemical industry', 'specialty chemicals'],
    patterns: [/\bchemicals?\b/, /\bchemie\b/],
  },
  {
    id: 'mining_metals',
    label: { en: 'Mining & Metals', de: 'Bergbau & Metalle' },
    aliases: ['mining', 'metals', 'raw materials'],
    patterns: [/\bmining\b/, /\bmetals\b/, /\bbergbau\b/],
  },
  {
    id: 'construction',
    label: { en: 'Construction', de: 'Bauwesen' },
    aliases: ['building industry', 'civil engineering industry'],
    patterns: [/\bconstruction\b/, /\bbauwesen\b/, /\bbauindustrie\b/],
  },
  {
    id: 'skilled_trades',
    label: { en: 'Skilled Trades', de: 'Handwerk' },
    aliases: ['trades', 'craft trades', 'manual trades', 'gewerbe', 'handwerkliche berufe', 'handwerksberufe'],
    patterns: [/\bskilled trades\b/, /\bhandwerk\b/, /\bhandwerks\b/, /\bgewerbe\b/, /\bcraft trades\b/],
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
    id: 'painting_finishing',
    label: { en: 'Painting & Finishing', de: 'Maler & Lackierer' },
    aliases: ['painting trades', 'maler', 'lackierer', 'stuckateur', 'plasterer', 'finishing trades'],
    patterns: [/\bmaler\b/, /\blackierer\b/, /\bstuckateur\b/, /\bpainting and finishing\b/, /\bpainter\b/],
  },
  {
    id: 'roofing_building_envelope',
    label: { en: 'Roofing & Building Envelope', de: 'Dach & Gebäudehülle' },
    aliases: ['roofing', 'dachdecker', 'glaser', 'building envelope', 'facade trades'],
    patterns: [/\broofing\b/, /\bdachdecker\b/, /\bglaser\b/, /\bbuilding envelope\b/, /\bfassadenbau\b/],
  },
  {
    id: 'automotive_trades',
    label: { en: 'Automotive Trades', de: 'Kfz-Handwerk' },
    aliases: ['automotive repair', 'kfz handwerk', 'kfz-mechatroniker', 'car mechanic', 'karosseriebauer'],
    patterns: [/\bkfz-handwerk\b/, /\bkfz mechatroniker\b/, /\bkarosseriebauer\b/, /\bautomotive trades\b/, /\bcar mechanic\b/],
  },
  {
    id: 'food_trades',
    label: { en: 'Food Trades', de: 'Lebensmittelhandwerk' },
    aliases: ['food crafts', 'bäcker', 'konditor', 'metzger', 'baker', 'butcher', 'pastry chef'],
    patterns: [/\bfood trades\b/, /\blebensmittelhandwerk\b/, /\bbäcker\b/, /\bkonditor\b/, /\bmetzger\b/, /\bbaker\b/, /\bbutcher\b/],
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
    aliases: ['architectural services'],
    patterns: [/\barchitecture\b/, /\barchitektur\b/],
  },
  {
    id: 'urban_planning',
    label: { en: 'Urban Planning', de: 'Stadtplanung' },
    aliases: ['city planning', 'town planning', 'urban planning'],
    patterns: [/\burgan planning\b/, /\bstadtplanung\b/, /\bcity planning\b/],
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
  if (isBlockedNonIndustryDomain(trimmed)) return null;

  const canonical = CANONICAL_BY_KEY.get(normalizeDomainKey(trimmed));
  if (canonical) return canonical;

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
  normalizeIndustryLabel,
  normalizeIndustryDomains,
  resolveCanonicalIndustry,
  resolveIndustryId,
  resolveIndustryDisplayLabel,
  listIndustryOptions,
  formatIndustryTaxonomyForPrompt,
  inferIndustriesFromText,
};
