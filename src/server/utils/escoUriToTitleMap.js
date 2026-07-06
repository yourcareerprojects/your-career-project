/**
 * ESCO skill URI → English title resolution (MongoDB-backed).
 * @deprecated Prefer importing from `escoSkillLookupService` directly.
 */
const {
  getEscoUriToTitleMap,
  findTitleForEscoUri,
  resolveEscoSkillTitles,
} = require('../services/escoSkillLookupService');

module.exports = {
  getEscoUriToTitleMap,
  findTitleForEscoUri,
  resolveEscoSkillTitles,
};
