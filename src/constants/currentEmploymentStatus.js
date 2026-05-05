/**
 * Allowed values for profile.seniority.currentStatus (and matching API validation).
 * Keep server (Mongoose, express-validator), client selects, and CV prompts in sync.
 *
 * UI shows {@link CURRENT_EMPLOYMENT_STATUS_OPTIONS} only. Legacy slugs remain valid in DB/API.
 */
const CURRENT_EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'pupil', label: 'Pupil' },
  { value: 'student', label: 'Student' },
  { value: 'intern', label: 'Intern or trainee' },
  { value: 'employed', label: 'Employed' },
  { value: 'part_time', label: 'Part-time employed' },
  { value: 'self-employed', label: 'Self-employed' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'unemployed', label: 'Unemployed' },
  { value: 'extended_leave', label: 'Extended leave' },
  { value: 'retired', label: 'Retired' },
];

/** Older stored values / LLM outputs still accepted by Mongoose and PATCH validators. */
const LEGACY_CURRENT_EMPLOYMENT_STATUS_VALUES = [
  'other',
  'job_seeking',
  'contract',
  'freelance',
  'career_break',
];

const CURRENT_EMPLOYMENT_STATUS_CANONICAL = CURRENT_EMPLOYMENT_STATUS_OPTIONS.map((o) => o.value);

const CURRENT_EMPLOYMENT_STATUS_ALLOWED = [
  ...CURRENT_EMPLOYMENT_STATUS_CANONICAL,
  ...LEGACY_CURRENT_EMPLOYMENT_STATUS_VALUES,
];

const CURRENT_EMPLOYMENT_STATUS_ENUM_WITH_EMPTY = ['', ...CURRENT_EMPLOYMENT_STATUS_ALLOWED];

const LEGACY_CURRENT_EMPLOYMENT_STATUS_LABELS = {
  other: 'Other',
  job_seeking: 'Actively looking',
  contract: 'Contract (legacy)',
  freelance: 'Freelance (legacy)',
  career_break: 'Career break (legacy)',
};

const CURRENT_EMPLOYMENT_STATUS_LABEL_BY_VALUE = {
  ...Object.fromEntries(CURRENT_EMPLOYMENT_STATUS_OPTIONS.map((o) => [o.value, o.label])),
  ...LEGACY_CURRENT_EMPLOYMENT_STATUS_LABELS,
};

function currentEmploymentStatusLabel(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  return CURRENT_EMPLOYMENT_STATUS_LABEL_BY_VALUE[key] || key;
}

/** Map deprecated / LLM synonyms onto canonical or legacy stored slugs. */
const STATUS_INCOMING_ALIASES = {
  contract: 'contractor',
  freelance: 'contractor',
  career_break: 'extended_leave',
  job_seeking: 'unemployed',
};

/** Coerce CV / LLM output to a stored enum, or '' if unknown. */
function sanitizeCurrentEmploymentStatus(value) {
  let v = String(value || '').trim();
  if (!v) return '';
  if (STATUS_INCOMING_ALIASES[v]) {
    v = STATUS_INCOMING_ALIASES[v];
  }
  if (CURRENT_EMPLOYMENT_STATUS_ALLOWED.includes(v)) return v;
  return '';
}

module.exports = {
  CURRENT_EMPLOYMENT_STATUS_OPTIONS,
  CURRENT_EMPLOYMENT_STATUS_CANONICAL,
  CURRENT_EMPLOYMENT_STATUS_ALLOWED,
  CURRENT_EMPLOYMENT_STATUS_ENUM_WITH_EMPTY,
  LEGACY_CURRENT_EMPLOYMENT_STATUS_VALUES,
  currentEmploymentStatusLabel,
  sanitizeCurrentEmploymentStatus,
};
