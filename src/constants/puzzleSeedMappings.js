/**
 * Map profile.seniority fields → curated puzzle piece keys (catalog seeds).
 * Keys must match pieces in the DACH seed pack.
 */

/** @type {Record<string, string>} */
const HIGHEST_DEGREE_TO_PIECE_KEY = {
  none: 'edu.none',
  high_school: 'edu.abitur',
  hauptschulabschluss: 'edu.hauptschulabschluss',
  realschulabschluss: 'edu.realschulabschluss',
  ausbildung: 'edu.ausbildung',
  fachabitur: 'edu.fachabitur',
  associate: 'edu.associate',
  bachelors: 'edu.bachelors',
  masters: 'edu.masters',
  phd: 'edu.phd',
  staatsexamen: 'edu.staatsexamen',
  professional: 'edu.professional',
  '': 'edu.none',
};

/** @type {Record<string, string>} */
const EXPERIENCE_TO_PIECE_KEY = {
  '': 'exp.none',
  intern: 'exp.intern',
  entry_level: 'exp.entry_level',
  mid_level: 'exp.mid_level',
  senior: 'exp.senior',
  lead: 'exp.lead',
  manager: 'exp.manager',
  director: 'exp.director',
  vp: 'exp.vp',
  c_suite: 'exp.c_suite',
};

const DEFAULT_EDUCATION_PIECE_KEY = 'edu.none';
const DEFAULT_EXPERIENCE_PIECE_KEY = 'exp.none';

/**
 * @param {string} [highestDegree]
 * @returns {string}
 */
function mapHighestDegreeToPieceKey(highestDegree) {
  const key = String(highestDegree ?? '').trim();
  return HIGHEST_DEGREE_TO_PIECE_KEY[key] || DEFAULT_EDUCATION_PIECE_KEY;
}

/**
 * @param {string} [mostSeniorWorkExperience]
 * @returns {string}
 */
function mapExperienceToPieceKey(mostSeniorWorkExperience) {
  const key = String(mostSeniorWorkExperience ?? '').trim();
  if (key === '') return DEFAULT_EXPERIENCE_PIECE_KEY;
  return EXPERIENCE_TO_PIECE_KEY[key] || DEFAULT_EXPERIENCE_PIECE_KEY;
}

module.exports = {
  HIGHEST_DEGREE_TO_PIECE_KEY,
  EXPERIENCE_TO_PIECE_KEY,
  DEFAULT_EDUCATION_PIECE_KEY,
  DEFAULT_EXPERIENCE_PIECE_KEY,
  mapHighestDegreeToPieceKey,
  mapExperienceToPieceKey,
};
