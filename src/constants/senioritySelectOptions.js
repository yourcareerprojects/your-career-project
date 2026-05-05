/**
 * Shared seniority dropdown options (SeniorityForm, CV review dialog).
 * Keep aligned with profile API and Mongoose validators.
 */
const MOST_SENIOR_OPTIONS = [
  { value: 'intern', label: 'Intern' },
  { value: 'entry_level', label: 'Entry-level' },
  { value: 'mid_level', label: 'Mid-level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'manager', label: 'Manager' },
  { value: 'director', label: 'Director' },
  { value: 'vp', label: 'VP' },
  { value: 'c_suite', label: 'C-Suite' }
];

const YEARS_OPTIONS = Array.from({ length: 51 }, (_, i) => ({ value: i, label: i.toString() }));

const MOST_SENIOR_ALLOWED = MOST_SENIOR_OPTIONS.map((o) => o.value);

/** Map job title / free text to a most-senior dropdown slug (aligned with server document extraction). */
function inferMostSeniorRoleFromText(raw) {
  const existing = String(raw || '').trim();
  if (existing && MOST_SENIOR_ALLOWED.includes(existing)) return existing;
  const t = String(raw || '').toLowerCase().trim();
  if (!t) return '';
  if (/\bchief\b|\bcxo\b|\bceo\b|\bcto\b|\bcfo\b/.test(t)) return 'c_suite';
  if (/\bvp\b|vice president/.test(t)) return 'vp';
  if (/\bdirector\b/.test(t)) return 'director';
  if (/\bmanager\b|head of/.test(t)) return 'manager';
  if (/\blead\b|principal/.test(t)) return 'lead';
  if (/\bsenior\b|sr\b/.test(t)) return 'senior';
  if (/\bjunior\b|jr\b|entry/.test(t)) return 'entry_level';
  if (/\bintern\b|internship/.test(t)) return 'intern';
  return 'mid_level';
}

module.exports = {
  MOST_SENIOR_OPTIONS,
  MOST_SENIOR_ALLOWED,
  YEARS_OPTIONS,
  inferMostSeniorRoleFromText,
};
