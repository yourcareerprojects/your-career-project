/**
 * Database helpers for occupation domain classification.
 * @module services/occupationDomainClassification/domainClassificationDb
 */

const CareerPath = require('../../models/CareerPath');
const { UNASSIGNED_ROLE_DOMAIN } = require('../../../constants/industries');

const CLASSIFICATION_PROJECTION = {
  escoId: 1,
  title: 1,
  altTitles: 1,
  altTitlesDe: 1,
  description: 1,
  iscoGroup: 1,
  requiredSkills: 1,
  skillModel: 1,
  keyResponsibilities: 1,
  skillDomains: 1,
  domain: 1,
  domainClassification: 1,
};

/**
 * Build Mongo filter for occupations to classify.
 * Default: domain === UNASSIGNED. With force: all matching optional filters.
 *
 * @param {{ force?: boolean, escoPrefix?: string|null, escoIds?: string[]|null }} options
 */
function buildClassificationFilter({ force = false, escoPrefix = null, escoIds = null } = {}) {
  const filter = {};

  if (Array.isArray(escoIds) && escoIds.length > 0) {
    filter.escoId = { $in: escoIds };
  } else if (escoPrefix) {
    filter.escoId = new RegExp(`^${String(escoPrefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  }

  if (!force) {
    filter.domain = UNASSIGNED_ROLE_DOMAIN;
  }

  return filter;
}

/**
 * @param {object} filter
 * @returns {Promise<number>}
 */
async function countOccupationsToClassify(filter) {
  return CareerPath.countDocuments(filter);
}

/**
 * Cursor-style batch fetch ordered by _id.
 *
 * @param {object} filter
 * @param {{ afterId?: import('mongoose').Types.ObjectId|null, limit?: number }} options
 */
async function fetchOccupationBatch(filter, { afterId = null, limit = 50 } = {}) {
  const query = afterId ? { ...filter, _id: { $gt: afterId } } : { ...filter };
  return CareerPath.find(query, CLASSIFICATION_PROJECTION)
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
}

/**
 * Persist a validated classification onto a CareerPath.
 *
 * @param {string|import('mongoose').Types.ObjectId} careerPathId
 * @param {{
 *   domain: string,
 *   confidence: number,
 *   model: string,
 *   reason?: string,
 *   needsManualReview: boolean,
 *   classifiedAt?: Date,
 * }} classification
 */
async function saveOccupationDomainClassification(careerPathId, classification) {
  const classifiedAt = classification.classifiedAt || new Date();
  return CareerPath.updateOne(
    { _id: careerPathId },
    {
      $set: {
        domain: classification.domain,
        domainClassification: {
          confidence: classification.confidence,
          classifiedAt,
          model: classification.model,
          reason: classification.reason || '',
          needsManualReview: Boolean(classification.needsManualReview),
        },
        lastUpdated: classifiedAt,
      },
    }
  );
}

module.exports = {
  CLASSIFICATION_PROJECTION,
  buildClassificationFilter,
  countOccupationsToClassify,
  fetchOccupationBatch,
  saveOccupationDomainClassification,
  UNASSIGNED_ROLE_DOMAIN,
};
