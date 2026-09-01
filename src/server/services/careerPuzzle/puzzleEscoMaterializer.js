const PuzzlePiece = require('../../models/PuzzlePiece');
const PuzzleEdge = require('../../models/PuzzleEdge');
const { serializePiece } = require('./puzzleGraphService');

/**
 * Stable catalog key for an ESCO-backed puzzle piece.
 * @param {string} escoId
 * @returns {string}
 */
function pieceKeyFromEscoId(escoId) {
  const raw = String(escoId || '').trim().toLowerCase();
  if (!raw) {
    throw new Error('escoId is required to materialize a puzzle piece');
  }
  // Keep URI-safe slug; collapse non-alphanumeric runs
  const slug = raw
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 200);
  return `esco.${slug || 'unknown'}`;
}

/**
 * Upsert a PuzzlePiece from a CareerPath document.
 * @param {object} careerPath — lean CareerPath
 * @returns {Promise<object>} lean piece
 */
async function ensurePieceFromCareerPath(careerPath) {
  if (!careerPath?._id || !careerPath.escoId) {
    throw new Error('CareerPath with _id and escoId is required');
  }

  const seniorityLevel = Number(careerPath.seniority?.seniority_level);
  const isSenior =
    Number.isFinite(seniorityLevel) && seniorityLevel >= 5;
  const category = 'occupation';

  const title = careerPath.title || { en: String(careerPath.escoId), de: null };
  const description = careerPath.description || { en: '', de: null };

  const doc = await PuzzlePiece.findOneAndUpdate(
    { key: pieceKeyFromEscoId(careerPath.escoId) },
    {
      $set: {
        key: pieceKeyFromEscoId(careerPath.escoId),
        category,
        title: {
          en: title.en || String(careerPath.escoId),
          de: title.de ?? null,
        },
        shortDescription: {
          en: description.en || '',
          de: description.de ?? null,
        },
        localeScope: ['de', 'en'],
        careerPathId: careerPath._id,
        escoId: careerPath.escoId,
        tags: ['esco', 'rule'],
        visual: {
          icon: isSenior ? 'groups' : 'work',
          colorToken: 'occupation',
        },
        status: 'active',
        metadata: {
          estimatedDurationMonths: null,
          estimatedSalary: null,
          requiredSkills: Array.isArray(careerPath.skillModel?.core_skills)
            ? careerPath.skillModel.core_skills.slice(0, 12)
            : [],
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return doc;
}

/**
 * Upsert a rule-generated edge between two pieces.
 * @returns {Promise<object>} lean edge
 */
async function ensureRuleEdge(fromPieceId, toPieceId, options = {}) {
  const {
    relationType = 'progresses_to',
    weight = 0,
    ruleId = null,
  } = options;

  if (!fromPieceId || !toPieceId) {
    throw new Error('fromPieceId and toPieceId are required');
  }

  const doc = await PuzzleEdge.findOneAndUpdate(
    {
      fromPieceId,
      toPieceId,
      relationType,
    },
    {
      $set: {
        fromPieceId,
        toPieceId,
        relationType,
        weight,
        status: 'active',
        metadata: {
          source: 'rule',
          ruleId: ruleId || null,
          durationMonths: null,
          note: null,
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return doc;
}

/**
 * Materialize CareerPath → piece + rule edge, return a next-step shaped object.
 * @param {import('mongoose').Types.ObjectId|string} fromPieceId
 * @param {object} careerPath
 * @param {{ relationType?: string, weight?: number, ruleId?: string }} options
 */
async function materializeRuleStep(fromPieceId, careerPath, options = {}) {
  const pieceDoc = await ensurePieceFromCareerPath(careerPath);
  const edgeDoc = await ensureRuleEdge(fromPieceId, pieceDoc._id, options);
  return {
    piece: serializePiece(pieceDoc),
    edge: {
      id: String(edgeDoc._id),
      relationType: edgeDoc.relationType,
      weight: edgeDoc.weight,
      metadata: edgeDoc.metadata || {},
    },
    source: 'rule',
    ruleId: options.ruleId || edgeDoc.metadata?.ruleId || null,
  };
}

module.exports = {
  pieceKeyFromEscoId,
  ensurePieceFromCareerPath,
  ensureRuleEdge,
  materializeRuleStep,
};
