const SimulationTraitUsage = require('../../models/SimulationTraitUsage');

function objToMap(obj) {
  const m = new Map();
  if (!obj || typeof obj !== 'object') return m;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && Number.isFinite(v)) m.set(k, v);
  }
  return m;
}

function objToRoleComboMap(obj) {
  const m = new Map();
  if (!obj || typeof obj !== 'object') return m;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') m.set(k, v);
  }
  return m;
}

function mapToPlainObject(map) {
  const o = {};
  if (!(map instanceof Map)) return o;
  for (const [k, v] of map.entries()) {
    o[String(k)] = v;
  }
  return o;
}

/**
 * Trait usage store backed by Mongo (one document per user × simulationScopeKey).
 */
class MongoTraitUsageStore {
  /**
   * @param {string|import('mongoose').Types.ObjectId} userId
   * @param {string} simulationScopeKey normalized '' when no simulation scope
   */
  constructor(userId, simulationScopeKey) {
    this.userId = userId;
    this.simulationScopeKey = simulationScopeKey || '';
    /** @type {Map<string, { roleCombinationSelection: Map<string, string>, combinationCounts: Map<string, number> }>} */
    this.traitUsageByScope = new Map();
    this._loaded = false;
  }

  async load() {
    const doc = await SimulationTraitUsage.findOne({
      userId: this.userId,
      simulationScopeKey: this.simulationScopeKey,
    }).lean();

    if (!doc) {
      this._loaded = true;
      return;
    }

    for (const [scopeKey, blob] of Object.entries(doc.scopeStates || {})) {
      if (!blob || typeof blob !== 'object') continue;
      this.traitUsageByScope.set(scopeKey, {
        roleCombinationSelection: objToRoleComboMap(blob.roleCombinationSelection),
        combinationCounts: objToMap(blob.combinationCounts),
      });
    }
    this._loaded = true;
  }

  /**
   * Persist all scope buckets into one document (nested by scopeKey).
   */
  async persist() {
    const scopeStates = {};
    for (const [scopeKey, state] of this.traitUsageByScope.entries()) {
      scopeStates[scopeKey] = {
        roleCombinationSelection: mapToPlainObject(state.roleCombinationSelection),
        combinationCounts: mapToPlainObject(state.combinationCounts),
      };
    }

    await SimulationTraitUsage.findOneAndUpdate(
      { userId: this.userId, simulationScopeKey: this.simulationScopeKey },
      {
        $set: {
          scopeStates,
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
  }

  getUsedCombinationCounts(scopeKey) {
    if (!scopeKey || !this.traitUsageByScope.has(scopeKey)) return new Map();
    const state = this.traitUsageByScope.get(scopeKey);
    return state?.combinationCounts || new Map();
  }

  getCombinationCountsForSelection(scopeKey, roleKey) {
    const counts = new Map(this.getUsedCombinationCounts(scopeKey));
    if (!scopeKey || !roleKey || !this.traitUsageByScope.has(scopeKey)) return counts;
    const state = this.traitUsageByScope.get(scopeKey);
    const prevKey = state.roleCombinationSelection?.get(roleKey);
    if (!prevKey) return counts;
    counts.set(prevKey, Math.max(0, (counts.get(prevKey) || 1) - 1));
    return counts;
  }

  trackUsedTraitCombinationAcrossRoles(scopeKey, roleKey, selectedTraitIds) {
    const ids = [...new Set((selectedTraitIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
    let nextKey = '';
    if (ids.length === 1) nextKey = ids[0];
    else if (ids.length > 1) nextKey = ids.slice().sort((a, b) => a.localeCompare(b)).join('::');

    if (!scopeKey || !roleKey) return;
    if (!this.traitUsageByScope.has(scopeKey)) {
      this.traitUsageByScope.set(scopeKey, {
        roleCombinationSelection: new Map(),
        combinationCounts: new Map(),
      });
    }
    const state = this.traitUsageByScope.get(scopeKey);
    if (!state.roleCombinationSelection) {
      state.roleCombinationSelection = new Map();
      state.combinationCounts = new Map();
    }
    const prevKey = state.roleCombinationSelection.get(roleKey) || '';
    if (prevKey) {
      state.combinationCounts.set(
        prevKey,
        Math.max(0, (state.combinationCounts.get(prevKey) || 1) - 1)
      );
    }
    state.roleCombinationSelection.set(roleKey, nextKey);
    if (nextKey) {
      state.combinationCounts.set(nextKey, (state.combinationCounts.get(nextKey) || 0) + 1);
    }
  }

}

module.exports = { MongoTraitUsageStore };
