/**
 * ISCO-08 code to display label mapping (client-side).
 * Mirrors server iscoMapping for displaying industry sectors in profile view.
 */

const MAJOR_GROUPS = {
  0: 'Armed forces occupations',
  1: 'Managers',
  2: 'Professionals',
  3: 'Technicians and associate professionals',
  4: 'Clerical support workers',
  5: 'Service and sales workers',
  6: 'Skilled agricultural, forestry and fishery workers',
  7: 'Craft and related trades workers',
  8: 'Plant and machine operators and assemblers',
  9: 'Elementary occupations'
};

const SUB_MAJOR_GROUPS = {
  11: 'Chief executives, senior officials and legislators',
  12: 'Administrative and commercial managers',
  13: 'Production and specialized services managers',
  14: 'Hospitality, retail and other services managers',
  21: 'Science and engineering professionals',
  22: 'Health professionals',
  23: 'Teaching professionals',
  24: 'Business and administration professionals',
  25: 'Information and communications technology professionals',
  26: 'Legal, social and cultural professionals',
  31: 'Science and engineering associate professionals',
  32: 'Health associate professionals',
  33: 'Business and administration associate professionals',
  34: 'Legal, social, cultural and related associate professionals',
  35: 'Information and communications technicians',
  41: 'General and keyboard clerks',
  42: 'Customer services clerks',
  43: 'Numerical and material recording clerks',
  44: 'Other clerical support workers',
  51: 'Personal service workers',
  52: 'Sales workers',
  53: 'Personal care workers',
  54: 'Protective services workers',
  61: 'Market-oriented skilled agricultural workers',
  62: 'Market-oriented skilled forestry, fishery and hunting workers',
  63: 'Subsistence farmers, fishers, hunters and gatherers',
  71: 'Building and related trades workers',
  72: 'Metal, machinery and related trades workers',
  73: 'Handicraft and printing workers',
  74: 'Electrical and electronics trades workers',
  75: 'Food processing, wood working, garment and other craft workers',
  81: 'Stationary plant and machine operators',
  82: 'Assemblers',
  83: 'Drivers and mobile plant operators',
  91: 'Cleaners and helpers',
  92: 'Agricultural, forestry and fishery labourers',
  93: 'Labourers in mining, construction, manufacturing and transport',
  94: 'Food preparation assistants',
  95: 'Street and related sales and services workers',
  96: 'Refuse workers and other elementary workers'
};

/**
 * Resolve ISCO code to display label.
 * @param {string} code - 1-4 digit ISCO code or legacy free-text (e.g. "Technology")
 * @returns {string} Human-readable label; legacy non-ISCO values shown as-is
 */
export function resolveIscoCodeToLabel(code) {
  if (!code || typeof code !== 'string') return '';
  const c = String(code).trim();
  if (!c) return '';
  if (SUB_MAJOR_GROUPS[c] !== undefined) return SUB_MAJOR_GROUPS[c];
  if (MAJOR_GROUPS[c] !== undefined) return MAJOR_GROUPS[c];
  if (/^\d{1,4}$/.test(c)) {
    // Graceful hierarchy fallback for 3/4-digit codes:
    // 4-digit -> try 3-digit parent -> 2-digit parent -> 1-digit major
    // 3-digit -> try 2-digit parent -> 1-digit major
    if (c.length >= 3) {
      const subMajor = c.slice(0, 2);
      if (SUB_MAJOR_GROUPS[subMajor] !== undefined) return SUB_MAJOR_GROUPS[subMajor];
      const major = c.charAt(0);
      if (MAJOR_GROUPS[major] !== undefined) return MAJOR_GROUPS[major];
    }
    return `${c} (Unknown)`;
  }
  return c;
}

/**
 * Resolve a code to its effective display code/label after hierarchical fallback.
 * Example: "332" -> { displayCode: "33", label: "Business and administration associate professionals" }
 *
 * @param {string} code
 * @returns {{ displayCode: string, label: string }}
 */
export function resolveIscoDisplayEntry(code) {
  if (!code || typeof code !== 'string') return { displayCode: '', label: '' };
  const c = String(code).trim();
  if (!c) return { displayCode: '', label: '' };

  if (SUB_MAJOR_GROUPS[c] !== undefined) return { displayCode: c, label: SUB_MAJOR_GROUPS[c] };
  if (MAJOR_GROUPS[c] !== undefined) return { displayCode: c, label: MAJOR_GROUPS[c] };

  if (/^\d{1,4}$/.test(c)) {
    if (c.length >= 3) {
      const subMajor = c.slice(0, 2);
      if (SUB_MAJOR_GROUPS[subMajor] !== undefined) {
        return { displayCode: subMajor, label: SUB_MAJOR_GROUPS[subMajor] };
      }
      const major = c.charAt(0);
      if (MAJOR_GROUPS[major] !== undefined) {
        return { displayCode: major, label: MAJOR_GROUPS[major] };
      }
    }
    return { displayCode: c, label: `${c} (Unknown)` };
  }
  return { displayCode: c, label: c };
}

/**
 * Resolve array of ISCO codes to display string.
 * @param {string[]} codes - Array of ISCO codes
 * @returns {string} Comma-separated labels
 */
export function resolveIscoCodesToLabels(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return '';
  return codes
    .map((c) => resolveIscoCodeToLabel(c))
    .filter(Boolean)
    .join(', ');
}
