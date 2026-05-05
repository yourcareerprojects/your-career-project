/**
 * Allowed values for profile.seniority.highestDegree (API, Mongoose, express-validator, UI).
 * Keep server and client dropdowns in sync.
 */
const HIGHEST_DEGREE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'high_school', label: 'High school' },
  { value: 'hauptschulabschluss', label: 'Hauptschulabschluss' },
  { value: 'realschulabschluss', label: 'Realschulabschluss' },
  { value: 'ausbildung', label: 'Ausbildung' },
  { value: 'fachabitur', label: 'Fachabitur' },
  { value: 'associate', label: 'Associate' },
  { value: 'bachelors', label: "Bachelor's" },
  { value: 'masters', label: "Master's" },
  { value: 'phd', label: 'PhD' },
  { value: 'staatsexamen', label: 'Staatsexamen' },
  { value: 'professional', label: 'Professional degree' },
];

const HIGHEST_DEGREE_ALLOWED = HIGHEST_DEGREE_OPTIONS.map((o) => o.value);

const HIGHEST_DEGREE_ENUM_WITH_EMPTY = ['', ...HIGHEST_DEGREE_ALLOWED];

const HIGHEST_DEGREE_LABEL_BY_VALUE = Object.fromEntries(
  HIGHEST_DEGREE_OPTIONS.map((o) => [o.value, o.label])
);

function highestDegreeLabel(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  return HIGHEST_DEGREE_LABEL_BY_VALUE[key] || key;
}

/** Map free text or LLM output to a dropdown value (aligned with server document extraction). */
function inferHighestDegreeFromText(value) {
  const existing = String(value || '').trim();
  if (existing && HIGHEST_DEGREE_ALLOWED.includes(existing)) return existing;
  const t = String(value || '').toLowerCase();
  if (/\bph\.?d\b|doctorate|doctoral/.test(t)) return 'phd';
  if (/\bmaster\b|msc|m\.?sc|mba/.test(t)) return 'masters';
  if (/\bbachelor\b|bsc|b\.?sc|ba\b/.test(t)) return 'bachelors';
  if (/associate/.test(t)) return 'associate';
  if (/staatsexamen|state examination/.test(t)) return 'staatsexamen';
  if (/fachabitur|fachhochschulreife/.test(t)) return 'fachabitur';
  if (/\bausbildung\b|berufsausbildung|\blehre\b/.test(t)) return 'ausbildung';
  if (/realschulabschluss|mittlere reife|realschule/.test(t)) return 'realschulabschluss';
  if (/hauptschulabschluss|hauptschule/.test(t)) return 'hauptschulabschluss';
  if (/high school|secondary/.test(t)) return 'high_school';
  return '';
}

module.exports = {
  HIGHEST_DEGREE_OPTIONS,
  HIGHEST_DEGREE_ALLOWED,
  HIGHEST_DEGREE_ENUM_WITH_EMPTY,
  HIGHEST_DEGREE_LABEL_BY_VALUE,
  highestDegreeLabel,
  inferHighestDegreeFromText,
};
