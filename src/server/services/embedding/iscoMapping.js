/**
 * ISCO-08 code to label mapping for occupation group embedding.
 *
 * Resolves iscoGroup codes (e.g. "2654") to human-readable labels for
 * the occupation_group structured vector category.
 *
 * Hierarchy: Major (1 digit) → Sub-major (2) → Minor (3) → Unit (4)
 * @see https://www.ilo.org/public/english/bureau/stat/isco/isco08/
 *
 * @module services/embedding/iscoMapping
 */

/** ISCO-08 Major groups (1 digit) */
const MAJOR_GROUPS = {
  0: 'armed forces occupations',
  1: 'managers',
  2: 'professionals',
  3: 'technicians and associate professionals',
  4: 'clerical support workers',
  5: 'service and sales workers',
  6: 'skilled agricultural forestry and fishery workers',
  7: 'craft and related trades workers',
  8: 'plant and machine operators and assemblers',
  9: 'elementary occupations',
};

/** ISCO-08 Sub-major groups (2 digits) – Professionals (2x) and selected others */
const SUB_MAJOR_GROUPS = {
  11: 'chief executives senior officials and legislators',
  12: 'administrative and commercial managers',
  13: 'production and specialized services managers',
  14: 'hospitality retail and other services managers',
  21: 'science and engineering professionals',
  22: 'health professionals',
  23: 'teaching professionals',
  24: 'business and administration professionals',
  25: 'information and communications technology professionals',
  26: 'legal social and cultural professionals',
  31: 'science and engineering associate professionals',
  32: 'health associate professionals',
  33: 'business and administration associate professionals',
  34: 'legal social cultural and related associate professionals',
  35: 'information and communications technicians',
  41: 'general and keyboard clerks',
  42: 'customer services clerks',
  43: 'numerical and material recording clerks',
  44: 'other clerical support workers',
  51: 'personal service workers',
  52: 'sales workers',
  53: 'personal care workers',
  54: 'protective services workers',
  61: 'market-oriented skilled agricultural workers',
  62: 'market-oriented skilled forestry fishery and hunting workers',
  63: 'subsistence farmers fishers hunters and gatherers',
  71: 'building and related trades workers',
  72: 'metal machinery and related trades workers',
  73: 'handicraft and printing workers',
  74: 'electrical and electronics trades workers',
  75: 'food processing wood working garment and other craft workers',
  81: 'stationary plant and machine operators',
  82: 'assemblers',
  83: 'drivers and mobile plant operators',
  91: 'cleaners and helpers',
  92: 'agricultural forestry and fishery labourers',
  93: 'labourers in mining construction manufacturing and transport',
  94: 'food preparation assistants',
  95: 'street and related sales and services workers',
  96: 'refuse workers and other elementary workers',
};

/**
 * Resolve ISCO code to one or more labels (most specific first).
 * Returns labels for embedding; multiple levels can be included for richer matching.
 *
 * @param {string} iscoGroup – 1–4 digit ISCO code (e.g. "2654", "25", "2")
 * @returns {string[]} Labels for embedding (e.g. ["journalists", "legal social and cultural professionals", "professionals"])
 */
function resolveIscoToLabels(iscoGroup) {
  if (!iscoGroup || typeof iscoGroup !== 'string') return [];
  const code = String(iscoGroup).trim();
  if (!code) return [];

  const labels = [];
  const len = code.length;

  // 2+ digits: try sub-major first
  if (len >= 2) {
    const sub = parseInt(code.slice(0, 2), 10);
    if (SUB_MAJOR_GROUPS[sub]) labels.push(SUB_MAJOR_GROUPS[sub]);
  }
  // Always include major group as fallback / broader signal
  if (len >= 1) {
    const major = parseInt(code.charAt(0), 10);
    const majorLabel = MAJOR_GROUPS[major];
    if (majorLabel && !labels.includes(majorLabel)) {
      labels.push(majorLabel);
    }
  }

  return labels;
}

/**
 * Build occupation group text for embedding from a CareerPath document.
 *
 * @param {object} doc – CareerPath with iscoGroup
 * @returns {string} Newline-separated labels for embedding
 */
function buildOccupationGroupText(doc) {
  const labels = resolveIscoToLabels(doc?.iscoGroup);
  if (labels.length === 0) return '';
  return labels.join('\n');
}

/** Format label for display (capitalize words) */
function formatLabelForDisplay(label) {
  if (!label || typeof label !== 'string') return '';
  return label
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Valid ISCO codes from our known set (Major + Sub-major) */
function getValidIscoCodes() {
  const codes = new Set();
  Object.keys(MAJOR_GROUPS).forEach((k) => codes.add(String(k)));
  Object.keys(SUB_MAJOR_GROUPS).forEach((k) => codes.add(String(k)));
  return codes;
}

module.exports = {
  resolveIscoToLabels,
  buildOccupationGroupText,
  getValidIscoCodes,
  formatLabelForDisplay,
  MAJOR_GROUPS,
  SUB_MAJOR_GROUPS,
};
