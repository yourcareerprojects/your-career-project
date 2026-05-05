/**
 * Degree hierarchy and education matching configuration.
 *
 * Used for distance-based education scoring in the 6-dimensional career path scorer.
 * The hierarchy enables gradual penalty when user degree is below role requirement.
 *
 * @module config/degreeConfig
 */

/**
 * Numeric hierarchy for educational degrees (0 = none, 6 = professional).
 * Used for distance-based education matching.
 *
 * | Key         | Level | Description                    |
 * |-------------|-------|--------------------------------|
 * | none        | 0     | No formal degree               |
 * | high_school | 1     | High school diploma           |
 * | associate   | 2     | Associate degree              |
 * | bachelors   | 3     | Bachelor's degree             |
 * | masters     | 4     | Master's degree               |
 * | phd         | 5     | PhD / Doctorate               |
 * | professional| 6     | Professional degree (JD, MD)   |
 * | hauptschulabschluss | 1 | German lower secondary certificate |
 * | realschulabschluss  | 2 | German intermediate secondary (Mittlere Reife) |
 * | ausbildung          | 2 | Completed vocational training |
 * | fachabitur          | 3 | German vocational university entrance |
 * | staatsexamen        | 6 | German state examination (regulated professions) |
 */
const DEGREE_LEVEL_MAP = {
  none: 0,
  high_school: 1,
  hauptschulabschluss: 1,
  realschulabschluss: 2,
  ausbildung: 2,
  fachabitur: 3,
  associate: 2,
  bachelors: 3,
  masters: 4,
  phd: 5,
  staatsexamen: 6,
  professional: 6
};

/**
 * Aliases for user degree strings → canonical DEGREE_LEVEL_MAP keys.
 * Handles profile dropdown values, document enrichment output, and common variants.
 */
const DEGREE_ALIASES = {
  // none
  '': 'none',
  none: 'none',
  // high_school
  high_school: 'high_school',
  'high school': 'high_school',
  'high-school': 'high_school',
  // German secondary / vocational (profile enum slugs)
  hauptschulabschluss: 'hauptschulabschluss',
  realschulabschluss: 'realschulabschluss',
  ausbildung: 'ausbildung',
  berufsausbildung: 'ausbildung',
  lehre: 'ausbildung',
  fachabitur: 'fachabitur',
  staatsexamen: 'staatsexamen',
  // associate
  associate: 'associate',
  // bachelors
  bachelors: 'bachelors',
  bachelor: 'bachelors',
  "bachelor's": 'bachelors',
  'bachelor degree': 'bachelors',
  "bachelor's degree": 'bachelors',
  bs: 'bachelors',
  ba: 'bachelors',
  bsc: 'bachelors',
  // masters
  masters: 'masters',
  master: 'masters',
  "master's": 'masters',
  'master degree': 'masters',
  "master's degree": 'masters',
  ms: 'masters',
  msc: 'masters',
  ma: 'masters',
  mba: 'masters',
  // phd
  phd: 'phd',
  'ph.d': 'phd',
  'ph.d.': 'phd',
  doctorate: 'phd',
  doctoral: 'phd',
  // professional
  professional: 'professional',
  'professional degree': 'professional',
  jd: 'professional',
  md: 'professional'
};

/**
 * Penalty factor for underqualification in distance-based education scoring.
 * raw = max(0, 1 - abs(diff) * EDUCATION_DISTANCE_PENALTY) when user is below role requirement.
 * Default 0.3: 1 level diff → raw=0.7, 2 levels → 0.4, 3+ → 0.
 */
const EDUCATION_DISTANCE_PENALTY = 0.3;

module.exports = {
  DEGREE_LEVEL_MAP,
  DEGREE_ALIASES,
  EDUCATION_DISTANCE_PENALTY
};
