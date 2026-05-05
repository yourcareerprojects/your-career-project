#!/usr/bin/env node
/**
 * Graph-merge CareerPath roles where identity_vector cosine similarity > threshold.
 * Transitive clusters → one canonical document per cluster; others deleted.
 *
 * Usage:
 *   node scripts/deduplicateRolesByEmbedding.js --dry-run
 *   node scripts/deduplicateRolesByEmbedding.js --apply
 *
 * Requires: MONGODB_URI, OPENAI_API_KEY
 */

require('dotenv').config();

const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');
const User = require('../src/server/models/User');
const { buildRoleVectors } = require('../src/server/services/embedding/roleVectorService');
const { mergeClusterDocs, remapEscoDeep } = require('./lib/roleClusterMerge');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

function parseArgs() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  return {
    apply,
    dryRun: !apply,
    threshold: (() => {
      const a = argv.find((x) => x.startsWith('--threshold='));
      if (!a) return 0.8;
      const v = parseFloat(a.split('=')[1]);
      return Number.isFinite(v) ? v : 0.8;
    })(),
  };
}

function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function l2norm(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

function cosineSim(a, b) {
  const na = l2norm(a);
  const nb = l2norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

class UnionFind {
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }

  find(i) {
    if (this.p[i] !== i) this.p[i] = this.find(this.p[i]);
    return this.p[i];
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[rb] = ra;
  }
}

async function main() {
  const flags = parseArgs();
  if (!process.env.OPENAI_API_KEY) {
    console.error(JSON.stringify({ error: 'OPENAI_API_KEY required' }));
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);

  const cursor = CareerPath.find(
    {
      'roleVectors.identity_vector': { $exists: true, $type: 'array' },
      $expr: { $gt: [{ $size: '$roleVectors.identity_vector' }, 0] },
    },
    {},
  )
    .lean()
    .cursor();

  const roles = [];
  for await (const doc of cursor) {
    const v = doc.roleVectors?.identity_vector;
    if (!Array.isArray(v) || !v.length) continue;
    roles.push({ ...doc, _identityVec: v });
  }

  const n = roles.length;
  if (n < 2) {
    console.log(JSON.stringify({ error: 'Not enough roles with identity_vector', count: n }));
    await mongoose.disconnect();
    process.exit(1);
  }

  const uf = new UnionFind(n);
  let edgeCount = 0;
  const thr = flags.threshold;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cosineSim(roles[i]._identityVec, roles[j]._identityVec) > thr) {
        uf.union(i, j);
        edgeCount++;
      }
    }
  }

  const comp = new Map();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    if (!comp.has(r)) comp.set(r, []);
    comp.get(r).push(i);
  }

  const multiClusters = [...comp.values()].filter((idxs) => idxs.length > 1);
  const idRemap = {};
  const outputClusters = [];

  for (const idxs of multiClusters) {
    const clusterDocs = idxs.map((i) => {
      const d = { ...roles[i] };
      delete d._identityVec;
      return d;
    });
    const canonicalEscoId = clusterDocs.map((d) => d.escoId).sort()[0];
    for (const d of clusterDocs) {
      if (d.escoId !== canonicalEscoId) idRemap[d.escoId] = canonicalEscoId;
    }
    const merged = mergeClusterDocs(clusterDocs, canonicalEscoId);
    outputClusters.push({
      new_role_id: canonicalEscoId,
      canonical_title: merged.title,
      alternative_titles: merged.altTitles,
      merged_role_identity_text: merged.roleIdentity.role_identity_text,
      human_readable_identity: merged.roleIdentity.human_readable_identity,
      structured_summary: {
        required_skills_count: merged.requiredSkills.length,
        responsibilities_count: merged.keyResponsibilities?.responsibilities?.length ?? 0,
        skill_domain_clusters: merged.skillDomains?.skill_domains?.length ?? 0,
        isco_group: merged.iscoGroup ?? null,
      },
      original_role_ids: clusterDocs.map((d) => d.escoId).sort(),
    });
  }

  const summary = {
    roles_input: n,
    edges_above_threshold: edgeCount,
    threshold: thr,
    multi_clusters: multiClusters.length,
    roles_removed: Object.keys(idRemap).length,
    roles_after: n - Object.keys(idRemap).length,
    dry_run: flags.dryRun,
  };

  if (flags.dryRun) {
    console.log(JSON.stringify({ summary, clusters: outputClusters }, null, 2));
    await mongoose.disconnect();
    return;
  }

  /** @type {object[]} */
  const applyErrors = [];
  for (let c = 0; c < multiClusters.length; c++) {
    const idxs = multiClusters[c];
    const clusterDocs = idxs.map((i) => {
      const d = { ...roles[i] };
      delete d._identityVec;
      return d;
    });
    const canonicalEscoId = clusterDocs.map((d) => d.escoId).sort()[0];
    try {
      const merged = mergeClusterDocs(clusterDocs, canonicalEscoId);
      if (!merged.skillModel && merged.requiredSkills.length) {
        merged.skillModel = {
          core_skills: merged.requiredSkills,
          optional_skills: [],
          skill_weights: {},
          extraction_confidence: 0,
          built_at: new Date(),
          built_with: 'manual',
        };
      }
      const vectors = await buildRoleVectors(merged);
      if (!vectors) {
        applyErrors.push({ canonicalEscoId, error: 'buildRoleVectors returned null' });
        continue;
      }
      const setPayload = {
        title: merged.title,
        altTitles: merged.altTitles,
        hiddenTitles: merged.hiddenTitles,
        description: merged.description,
        requiredSkills: merged.requiredSkills,
        requiredSkillUris: merged.requiredSkillUris,
        requiredSkillKeys: merged.requiredSkillKeys,
        skillModel: merged.skillModel,
        seniority: merged.seniority,
        keyResponsibilities: merged.keyResponsibilities,
        skillDomains: merged.skillDomains,
        roleIdentity: merged.roleIdentity,
        mergedFromEscoIds: merged.mergedFromEscoIds,
        code: merged.code,
        iscoGroup: merged.iscoGroup,
        roleVectors: vectors,
        lastUpdated: new Date(),
      };
      await CareerPath.updateOne({ escoId: canonicalEscoId }, { $set: setPayload });
      const toDelete = clusterDocs.map((d) => d.escoId).filter((id) => id !== canonicalEscoId);
      if (toDelete.length) {
        await CareerPath.deleteMany({ escoId: { $in: toDelete } });
      }
    } catch (e) {
      applyErrors.push({ canonicalEscoId, error: e.message });
    }
  }

  let usersRemapped = 0;
  if (Object.keys(idRemap).length) {
    const userCursor = User.find({}).cursor();
    for await (const user of userCursor) {
      const o = user.toObject({ depopulate: true });
      if (remapEscoDeep(o, idRemap)) {
        await User.collection.replaceOne({ _id: o._id }, o);
        usersRemapped++;
      }
    }
  }

  await mongoose.disconnect();

  console.log(
    JSON.stringify(
      {
        summary: { ...summary, dry_run: false, users_remapped: usersRemapped, apply_errors: applyErrors },
        clusters: outputClusters,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
