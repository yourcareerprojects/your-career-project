/**
 * Surface simulation “Cool” (userEvaluation: keep) roles as Career Puzzle
 * occupation next steps.
 */

const User = require('../../models/User');
const CareerPath = require('../../models/CareerPath');
const {
  getEvaluationFlow,
  listEvaluationFlowRoles,
} = require('../../utils/evaluationFlowRoles');
const { materializeRuleStep } = require('./puzzleEscoMaterializer');
const { NEXT_STEPS_PER_CATEGORY } = require('./puzzleGraphService');

const SIMULATION_COOL_RULE_ID = 'simulation_cool_keep';
const SIMULATION_COOL_WEIGHT = 50;

const CAREER_PATH_PROJECTION = {
  escoId: 1,
  title: 1,
  description: 1,
  iscoGroup: 1,
  domain: 1,
  seniority: 1,
  skillModel: 1,
  altTitles: 1,
  altTitlesDe: 1,
};

function isKeepEvaluation(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return key === 'keep' || key === 'cool';
}

/**
 * @param {object|null|undefined} role
 * @returns {string}
 */
function extractEscoId(role) {
  if (!role || typeof role !== 'object') return '';
  return String(role.escoId || role.step?.escoId || '')
    .trim();
}

/**
 * @param {object|null|undefined} role
 * @returns {string}
 */
function extractCareerPathId(role) {
  if (!role || typeof role !== 'object') return '';
  const raw =
    role.careerPathId ||
    role.step?.careerPathId ||
    role._id ||
    role.step?._id ||
    '';
  return raw ? String(raw).trim() : '';
}

/**
 * Collect Cool-rated roles from one evaluationFlow (roles[] preferred).
 * @param {object|null|undefined} flow
 * @returns {object[]}
 */
function collectKeepRolesFromFlow(flow) {
  return listEvaluationFlowRoles(flow).filter(
    (role) => role && isKeepEvaluation(role.userEvaluation)
  );
}

/**
 * Ordered Cool role refs for a user (last sim → saved sims).
 * @param {object} user — lean User with simulation fields
 * @returns {Array<{ escoId: string, careerPathId: string }>}
 */
function collectCoolOccupationRefsFromUser(user) {
  const refs = [];
  const seenEsco = new Set();
  const seenPath = new Set();

  const pushRole = (role) => {
    const escoId = extractEscoId(role);
    const careerPathId = extractCareerPathId(role);
    if (!escoId && !careerPathId) return;
    if (escoId) {
      const key = escoId.toLowerCase();
      if (seenEsco.has(key)) return;
      seenEsco.add(key);
    }
    if (careerPathId) {
      if (seenPath.has(careerPathId)) return;
      seenPath.add(careerPathId);
    }
    refs.push({ escoId, careerPathId });
  };

  const flows = [];
  const lastFlow = getEvaluationFlow(user?.lastSimulationResult);
  if (lastFlow) flows.push(lastFlow);

  const saved = Array.isArray(user?.simulationResults)
    ? [...user.simulationResults]
    : [];
  saved.sort((a, b) => {
    const ta = new Date(a?.timestamp || a?.updatedAt || 0).getTime();
    const tb = new Date(b?.timestamp || b?.updatedAt || 0).getTime();
    return tb - ta;
  });
  for (const sim of saved) {
    if (sim?.status && sim.status !== 'active') continue;
    const flow = getEvaluationFlow(sim);
    if (flow) flows.push(flow);
  }

  for (const flow of flows) {
    for (const role of collectKeepRolesFromFlow(flow)) {
      pushRole(role);
    }
  }

  return refs;
}

/**
 * Resolve Cool refs to CareerPath lean docs (order preserved).
 * @param {Array<{ escoId: string, careerPathId: string }>} refs
 * @param {{ excludeEscoIds?: string[], limit?: number }} [options]
 */
async function resolveCoolCareerPaths(refs, options = {}) {
  const excludeEsco = new Set(
    (options.excludeEscoIds || []).map((id) => String(id).toLowerCase())
  );
  const limit = Math.max(0, options.limit ?? NEXT_STEPS_PER_CATEGORY);
  const out = [];
  const usedEsco = new Set();

  for (const ref of refs || []) {
    if (out.length >= limit) break;
    const escoId = String(ref.escoId || '').trim();
    const careerPathId = String(ref.careerPathId || '').trim();
    if (escoId && excludeEsco.has(escoId.toLowerCase())) continue;
    if (escoId && usedEsco.has(escoId.toLowerCase())) continue;

    let doc = null;
    if (careerPathId && /^[a-f0-9]{24}$/i.test(careerPathId)) {
      doc = await CareerPath.findById(careerPathId)
        .select(CAREER_PATH_PROJECTION)
        .lean();
    }
    if (!doc && escoId) {
      doc = await CareerPath.findOne({ escoId })
        .select(CAREER_PATH_PROJECTION)
        .lean();
    }
    if (!doc?.escoId || !doc?._id) continue;
    if (excludeEsco.has(String(doc.escoId).toLowerCase())) continue;
    if (usedEsco.has(String(doc.escoId).toLowerCase())) continue;

    usedEsco.add(String(doc.escoId).toLowerCase());
    out.push(doc);
  }

  return out;
}

/**
 * Materialize Cool-ranked simulation roles as occupation next steps from the tip.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} fromPieceId
 * @param {{
 *   excludePieceIds?: Array,
 *   excludeEscoIds?: string[],
 *   limit?: number,
 * }} [options]
 * @returns {Promise<Array>}
 */
async function generateSimulationCoolOccupationSteps(
  userId,
  fromPieceId,
  options = {}
) {
  if (!userId || !fromPieceId) return [];

  const limit = Math.max(
    0,
    options.limit ?? NEXT_STEPS_PER_CATEGORY
  );
  if (limit <= 0) return [];

  const user = await User.findById(userId)
    .select(
      'lastSimulationResult.results.evaluationFlow simulationResults.status simulationResults.timestamp simulationResults.results.evaluationFlow'
    )
    .lean();
  if (!user) return [];

  const refs = collectCoolOccupationRefsFromUser(user);
  if (!refs.length) return [];

  const excludePieceIds = new Set(
    (options.excludePieceIds || []).map((id) => String(id))
  );
  const careerPaths = await resolveCoolCareerPaths(refs, {
    excludeEscoIds: options.excludeEscoIds || [],
    limit,
  });

  const steps = [];
  for (const careerPath of careerPaths) {
    if (steps.length >= limit) break;
    const step = await materializeRuleStep(fromPieceId, careerPath, {
      relationType: 'progresses_to',
      weight: SIMULATION_COOL_WEIGHT,
      ruleId: SIMULATION_COOL_RULE_ID,
    });
    if (!step?.piece?.id) continue;
    if (excludePieceIds.has(String(step.piece.id))) continue;
    excludePieceIds.add(String(step.piece.id));
    steps.push({
      ...step,
      source: 'simulation_cool',
      ruleId: SIMULATION_COOL_RULE_ID,
    });
  }

  return steps;
}

module.exports = {
  SIMULATION_COOL_RULE_ID,
  SIMULATION_COOL_WEIGHT,
  isKeepEvaluation,
  extractEscoId,
  extractCareerPathId,
  collectKeepRolesFromFlow,
  getEvaluationFlow,
  collectCoolOccupationRefsFromUser,
  resolveCoolCareerPaths,
  generateSimulationCoolOccupationSteps,
};
