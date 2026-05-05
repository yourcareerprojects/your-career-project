const path = require('path');
const User = require('../../models/User');
const RoleFitExplanation = require('../../models/RoleFitExplanation');
const { MongoTraitUsageStore } = require('./mongoTraitUsageStore');
const { hashTraitSet, hashRoleContext } = require('./roleFitExplanationHashes');
const { canonicalRoleId } = require('./canonicalRoleId');
const { generateRoleFitExplanationLLM } = require('../ai/generateRoleFitExplanationLLM');

let babelRegistered = false;

function ensureBabelForRoleFitCore() {
  if (babelRegistered) return;
  babelRegistered = true;
  require('@babel/register')({
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    ignore: [/node_modules/],
    only: [
      /generateRoleFitExplanation\.js$/,
      /roleFitExplanationCopy\.js$/,
      /roleFitExplanationTraits\.js$/,
      /localizedContentService\.js$/,
    ],
  });
}

function loadRoleFitCore() {
  ensureBabelForRoleFitCore();
  // eslint-disable-next-line global-require
  return require(path.join(__dirname, '../../../client/utils/generateRoleFitExplanation.js'));
}

function normalizeUiLanguage(language) {
  const raw = String(language || 'en').toLowerCase().split('-')[0];
  return raw === 'de' ? 'de' : 'en';
}

function normalizeSimulationScopeKey(simulationScopeId) {
  return String(simulationScopeId || '').trim().slice(0, 512);
}

/**
 * Cached role-fit explanation (Mongo) + persisted simulation trait usage.
 *
 * @param {{
 *   userId: string,
 *   language?: string,
 *   role: object,
 *   simulationScopeId?: string,
 *   roleContext?: object,
 *   debug?: boolean,
 * }} params
 */
async function getOrCreateRoleFitExplanation(params) {
  const {
    userId,
    language,
    role,
    simulationScopeId,
    roleContext,
    debug = false,
  } = params;

  if (!role || typeof role !== 'object') {
    throw new Error('role is required');
  }

  const languageNorm = normalizeUiLanguage(language);
  const simulationScopeKey = normalizeSimulationScopeKey(simulationScopeId);

  const user = await User.findById(userId).select('profile').lean();
  if (!user) {
    throw new Error('User not found');
  }

  const userProfile = { profile: user.profile };
  const roleId = canonicalRoleId(role);

  const traitUsageStore = new MongoTraitUsageStore(userId, simulationScopeKey);
  await traitUsageStore.load();

  const { generateRoleFitExplanationCore } = loadRoleFitCore();

  const generationDeps = {
    tryLoadCached: async ({ selectedTraitIds, roleContext: rc }) => {
      const traitsHash = hashTraitSet(selectedTraitIds);
      const roleContextHash = hashRoleContext(rc);
      const doc = await RoleFitExplanation.findOne({
        userId,
        roleId,
        language: languageNorm,
        traitsHash,
        roleContextHash,
        simulationScopeKey,
      })
        .select('text source')
        .lean();
      if (!doc) return null;
      return { text: doc.text, source: doc.source };
    },
    saveCached: async ({ selectedTraitIds, roleContext: rc, text, source }) => {
      const traitsHash = hashTraitSet(selectedTraitIds);
      const roleContextHash = hashRoleContext(rc);
      const src = source === 'llm' ? 'llm' : 'fallback';
      try {
        await RoleFitExplanation.findOneAndUpdate(
          {
            userId,
            roleId,
            language: languageNorm,
            traitsHash,
            roleContextHash,
            simulationScopeKey,
          },
          { $set: { text, source: src } },
          { upsert: true, new: true }
        );
      } catch (err) {
        if (err && err.code === 11000) {
          await RoleFitExplanation.updateOne(
            {
              userId,
              roleId,
              language: languageNorm,
              traitsHash,
              roleContextHash,
              simulationScopeKey,
            },
            { $set: { text, source: src } }
          );
          return;
        }
        throw err;
      }
    },
    persistTraitUsage: () => traitUsageStore.persist(),
  };

  const result = await generateRoleFitExplanationCore(userProfile, role, {
    lang: languageNorm,
    language: languageNorm,
    simulationScopeId,
    roleContext,
    traitUsageStore,
    llmCaller: async (payload) => generateRoleFitExplanationLLM(payload),
    generationDeps,
    debug,
  });

  return {
    text: result.text,
    explanationSource: result.explanationSource,
    fromCache: Boolean(result.fromCache),
    branch: result.branch,
    selectedTraitIds: result.selectedTraitIds,
    traitCapExhausted: result.traitCapExhausted,
  };
}

module.exports = {
  getOrCreateRoleFitExplanation,
  normalizeUiLanguage,
  normalizeSimulationScopeKey,
};
