/**
 * Shared CareerPath cluster merge (used by embedding dedupe + explicit merges).
 */

const mongoose = require('mongoose');
const {
  composeDeterministic,
  computeInputHash,
} = require('../../src/server/services/jobAnalysis/roleIdentityComposer');

function normalizeSkillKey(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function uniqStrings(arr, norm = (s) => s.toLowerCase().trim()) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const s = String(x || '').trim();
    if (!s) continue;
    const k = norm(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function pickCanonicalTitle(docs) {
  const counts = new Map();
  for (const d of docs) {
    const t = String(d.title || '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let bestKey = null;
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount || (c === bestCount && k.localeCompare(bestKey) < 0)) {
      bestCount = c;
      bestKey = k;
    }
  }
  const representative = docs.find((d) => String(d.title || '').trim().toLowerCase() === bestKey);
  return representative ? String(representative.title).trim() : String(docs[0].title || '').trim();
}

function modeField(values) {
  if (!values.length) return undefined;
  const counts = new Map();
  for (const v of values) {
    const s = String(v).trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let best = null;
  let bc = -1;
  for (const [k, c] of counts) {
    if (c > bc || (c === bc && k.localeCompare(best) < 0)) {
      bc = c;
      best = k;
    }
  }
  return best;
}

function mergeDescriptions(descs) {
  const parts = [];
  const seen = new Set();
  for (const d of descs) {
    const text = String(d || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const keys = text.split(/(?<=[.!?])\s+/);
    for (const chunk of keys) {
      const k = chunk.toLowerCase().slice(0, 200);
      if (k.length < 20 || seen.has(k)) continue;
      seen.add(k);
      parts.push(chunk.trim());
    }
  }
  return parts.join(' ').trim() || descs.map((d) => String(d || '').trim()).find(Boolean) || '';
}

function mergeSkillModels(models) {
  if (!models.length) return null;
  const core = uniqStrings(models.flatMap((m) => m.core_skills || []));
  const opt = uniqStrings(models.flatMap((m) => m.optional_skills || []));
  const weights = new Map();
  for (const m of models) {
    const w = m.skill_weights;
    if (w && typeof w.get === 'function') {
      for (const [k, v] of w) {
        const n = Number(v) || 0;
        weights.set(k, Math.max(weights.get(k) || 0, n));
      }
    } else if (w && typeof w === 'object') {
      for (const k of Object.keys(w)) {
        const n = Number(w[k]) || 0;
        weights.set(k, Math.max(weights.get(k) || 0, n));
      }
    }
  }
  return {
    core_skills: core,
    optional_skills: opt,
    skill_weights: Object.fromEntries(weights),
    extraction_confidence: Math.max(...models.map((m) => Number(m.extraction_confidence) || 0)),
    built_at: new Date(),
    built_with: models[0].built_with || 'esco_csv',
  };
}

function mergeKeyResponsibilities(docs) {
  const raw = uniqStrings(
    docs.flatMap((d) => (d.keyResponsibilities && d.keyResponsibilities.responsibilities) || []),
    (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim(),
  );
  if (!raw.length) return null;
  return {
    responsibilities: raw.slice(0, 48),
    extraction_confidence: Math.max(
      ...docs.map((d) => Number(d.keyResponsibilities?.extraction_confidence) || 0),
      0,
    ),
    built_at: new Date(),
    built_with: 'llm',
  };
}

function mergeSkillDomains(docs) {
  const byKey = new Map();
  for (const d of docs) {
    for (const sd of d.skillDomains?.skill_domains || []) {
      const dom = String(sd.domain || '').trim();
      const imp = sd.importance || 'supporting';
      const key = `${imp}|${dom.toLowerCase()}`;
      if (!byKey.has(key)) {
        byKey.set(key, { domain: dom, importance: imp, items: [] });
      }
      byKey.get(key).items.push(...(sd.mapped_items || []));
    }
  }
  const skill_domains = [...byKey.values()].map((v) => ({
    domain: v.domain,
    importance: v.importance,
    mapped_items: uniqStrings(v.items).slice(0, 36),
  }));
  if (!skill_domains.length) return null;
  return {
    skill_domains,
    extraction_confidence: Math.max(
      ...docs.map((d) => Number(d.skillDomains?.extraction_confidence) || 0),
      0,
    ),
    built_at: new Date(),
    built_with: 'llm',
  };
}

function pickSeniority(docs, canonicalTitle) {
  const ct = canonicalTitle.toLowerCase();
  const prefer = docs.find((d) => String(d.title || '').trim().toLowerCase() === ct);
  const pool = prefer ? [prefer, ...docs.filter((d) => d !== prefer)] : docs;
  const withSen = pool.filter((d) => d.seniority && d.seniority.seniority_level != null);
  if (!withSen.length) return null;
  withSen.sort(
    (a, b) => (Number(b.seniority.extraction_confidence) || 0) - (Number(a.seniority.extraction_confidence) || 0),
  );
  const s = withSen[0].seniority;
  return {
    seniority_level: s.seniority_level,
    seniority_label: s.seniority_label,
    seniority_reasoning: s.seniority_reasoning,
    extraction_confidence: s.extraction_confidence,
    built_at: new Date(),
    built_with: s.built_with || 'heuristic',
  };
}

function pickHumanIdentityText(docs, canonicalTitle) {
  const ct = canonicalTitle.toLowerCase();
  let best = '';
  for (const d of docs) {
    if (String(d.title || '').trim().toLowerCase() !== ct) continue;
    const t = d.roleIdentity?.role_identity_text;
    if (t && String(t).length > best.length) best = String(t);
  }
  if (!best) {
    for (const d of docs) {
      const t = d.roleIdentity?.role_identity_text;
      if (t && String(t).length > best.length) best = String(t);
    }
  }
  return best || mergeDescriptions(docs.map((d) => d.description));
}

function trimWordRange(text, maxW) {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= maxW) return words.join(' ');
  return words.slice(0, maxW).join(' ');
}

/** Union of absorbed escoIds: other cluster members + nested mergedFromEscoIds on any doc. */
function collectMergedTrace(docs, canonicalEscoId) {
  const ids = new Set();
  for (const d of docs) {
    if (d.escoId !== canonicalEscoId) ids.add(d.escoId);
    for (const x of d.mergedFromEscoIds || []) {
      if (x && String(x) !== canonicalEscoId) ids.add(String(x));
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {object[]} docs - CareerPath lean docs
 * @param {string} canonicalEscoId
 * @param {{ canonicalTitle?: string }} [options]
 */
function mergeClusterDocs(docs, canonicalEscoId, options = {}) {
  const sorted = [...docs].sort((a, b) => String(a.escoId).localeCompare(String(b.escoId)));
  const canonicalTitle =
    options.canonicalTitle != null && String(options.canonicalTitle).trim()
      ? String(options.canonicalTitle).trim()
      : pickCanonicalTitle(sorted);

  const altPool = [];
  for (const d of sorted) {
    altPool.push(d.title);
    for (const t of d.altTitles || []) altPool.push(t);
    for (const t of d.hiddenTitles || []) altPool.push(t);
  }
  const altTitles = uniqStrings(altPool).filter((t) => t.toLowerCase() !== canonicalTitle.toLowerCase());
  const description = mergeDescriptions(sorted.map((d) => d.description));

  const requiredSkills = uniqStrings(sorted.flatMap((d) => d.requiredSkills || []));
  const requiredSkillUris = uniqStrings(sorted.flatMap((d) => d.requiredSkillUris || []));
  let requiredSkillKeys = uniqStrings(sorted.flatMap((d) => d.requiredSkillKeys || []));
  if (!requiredSkillKeys.length && requiredSkills.length) {
    requiredSkillKeys = uniqStrings(requiredSkills.map(normalizeSkillKey).filter(Boolean));
  }

  const skillModel = mergeSkillModels(sorted.map((d) => d.skillModel).filter(Boolean));
  const keyResponsibilities = mergeKeyResponsibilities(sorted);
  const skillDomains = mergeSkillDomains(sorted);
  const seniority = pickSeniority(sorted, canonicalTitle);
  const iscoGroup = modeField(sorted.map((d) => d.iscoGroup).filter(Boolean));
  const code = sorted.find((d) => d.escoId === canonicalEscoId)?.code ?? sorted[0].code;

  const human_readable_identity = pickHumanIdentityText(sorted, canonicalTitle);

  const forCompose = {
    title: canonicalTitle,
    altTitles,
    description,
    requiredSkills,
    skillModel: skillModel || { core_skills: requiredSkills, optional_skills: [] },
    keyResponsibilities,
    skillDomains,
  };

  const det = composeDeterministic(forCompose);
  const role_identity_text = trimWordRange(det.role_identity_text, 120);

  const roleIdentity = {
    role_identity_text,
    human_readable_identity,
    input_hash: computeInputHash({
      title: canonicalTitle,
      altTitles,
      hiddenTitles: [],
      description,
    }),
    extraction_confidence: det.extraction_confidence,
    built_at: new Date(),
    built_with: 'deterministic',
  };

  const mergedFromEscoIds = collectMergedTrace(sorted, canonicalEscoId);

  return {
    escoId: canonicalEscoId,
    title: canonicalTitle,
    altTitles,
    hiddenTitles: [],
    description,
    requiredSkills,
    requiredSkillUris,
    requiredSkillKeys,
    skillModel,
    seniority,
    keyResponsibilities,
    skillDomains,
    roleIdentity,
    mergedFromEscoIds,
    code,
    iscoGroup,
    source: sorted[0].source,
    sourceVersion: sorted[0].sourceVersion,
    importedFrom: sorted[0].importedFrom,
  };
}

function isPlainObject(o) {
  if (o === null || typeof o !== 'object') return false;
  if (Array.isArray(o)) return false;
  if (o instanceof Date) return false;
  if (o instanceof mongoose.Types.ObjectId) return false;
  if (o instanceof mongoose.Types.Decimal128) return false;
  return true;
}

function remapEscoDeep(obj, map) {
  if (obj === null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) {
    let c = false;
    for (const item of obj) {
      if (remapEscoDeep(item, map)) c = true;
    }
    return c;
  }
  if (!isPlainObject(obj)) return false;
  let changed = false;
  for (const k of Object.keys(obj)) {
    if (k === 'escoId' && typeof obj[k] === 'string' && map[obj[k]]) {
      obj[k] = map[obj[k]];
      changed = true;
    } else if (remapEscoDeep(obj[k], map)) {
      changed = true;
    }
  }
  return changed;
}

module.exports = {
  mergeClusterDocs,
  remapEscoDeep,
  collectMergedTrace,
};
