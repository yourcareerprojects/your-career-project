#!/usr/bin/env node
/**
 * evaluateHybridVectors.js
 *
 * Evaluation logging for hybrid vector architecture.
 * For 20 sample roles, logs:
 *   - structured vs identity cosine similarity
 *   - hybrid similarity differences
 *   - top-5 nearest neighbors before and after hybrid introduction
 *
 * Validates improved differentiation between:
 *   - close titles
 *   - different seniority levels
 *   - domain-adjacent roles
 *
 * Usage:
 *   node scripts/evaluateHybridVectors.js [--limit=N]
 *
 * Prerequisites: buildRoleIdentityTexts and buildRoleVectors must be run first.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const CareerPath = require('../src/server/models/CareerPath');
const { cosineSimilarity, embedTextSafe, buildCareerStepEmbeddingText } = require('../src/server/services/embedding/embeddingService');
const { getStructuredVectorForMode } = require('../src/server/services/embedding/roleVectorService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';
const SAMPLE_SIZE = 20;

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = SAMPLE_SIZE;
  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { limit };
}

/**
 * Find top-k nearest neighbors by cosine similarity.
 */
async function topKNeighbors(role, allRoles, getVector, k = 5) {
  const vec = await getVector(role);
  if (!vec) return [];

  const scored = await Promise.all(allRoles
    .filter((r) => r.escoId !== role.escoId)
    .map(async (r) => {
      const v = await getVector(r);
      const sim = v ? cosineSimilarity(vec, v) : -1;
      return { role: r, similarity: sim };
    })
  ));
  const filtered = scored.filter((x) => x.similarity >= 0).sort((a, b) => b.similarity - a.similarity);
  return filtered.slice(0, k);
}

/**
 * Text-based embedding: title + description + requiredSkills + category (OpenAI)
 */
async function getLegacyVector(step) {
  const txt = buildCareerStepEmbeddingText(step, { category: step.category || '' });
  return embedTextSafe(txt);
}

/**
 * Get hybrid vector from role (Float32Array)
 */
function getHybridVector(role) {
  const hv = role.roleVectors?.hybrid_vector || role.hybrid_vector;
  if (hv && Array.isArray(hv) && hv.length > 0) {
    return new Float32Array(hv);
  }
  return null;
}

/**
 * Get structured vector (computed from sub-vectors with NEXT_ROLE weights)
 */
function getStructuredVector(role) {
  return getStructuredVectorForMode(role, 'NEXT_ROLE');
}

/**
 * Get identity vector
 */
function getIdentityVector(role) {
  const iv = role.roleVectors?.identity_vector;
  if (iv && Array.isArray(iv) && iv.length > 0) {
    return new Float32Array(iv);
  }
  return null;
}

async function main() {
  const { limit } = parseArgs();

  console.log('=== Hybrid Vector Evaluation ===');
  console.log(`  Sample size: ${limit}`);
  console.log('');

  await mongoose.connect(MONGODB_URI);

  const docs = await CareerPath.find({
    'roleVectors.hybrid_vector': { $exists: true, $ne: [] },
    $or: [
      { 'roleVectors.structured_vector_skill_domains': { $exists: true, $ne: [] } },
      { 'roleVectors.structured_vector_domains': { $exists: true, $ne: [] } },
    ],
  })
    .limit(limit * 2) // fetch extra for neighbor pool
    .lean();

  if (docs.length < limit) {
    console.error(`ERROR: Need at least ${limit} roles with roleVectors. Found ${docs.length}.`);
    console.error(' Run buildRoleIdentityTexts and buildRoleVectors first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const sample = docs.slice(0, limit);
  const pool = docs;

  console.log('--- Per-Role Metrics ---\n');

  for (const role of sample) {
    const title = role.title || '(no title)';
    const seniority = role.seniority?.seniority_level ?? '?';

    const structVec = getStructuredVector(role);
    const identVec = getIdentityVector(role);
    const hybridVec = getHybridVector(role);

    let structVsIdentity = null;
    if (structVec && identVec) {
      structVsIdentity = cosineSimilarity(structVec, identVec);
    }

    let legacyVec = null;
    try {
      legacyVec = await getLegacyVector(role);
    } catch (_) {}

    const top5Legacy = legacyVec ? await topKNeighbors(role, pool, async (r) => {
      try {
        return getLegacyVector(r);
      } catch (_) {
        return null;
      }
    }, 5) : [];

    const top5Hybrid = hybridVec ? await topKNeighbors(role, pool, getHybridVector, 5) : [];

    console.log(`--- ${title} (seniority: ${seniority}) ---`);
    console.log(`  structured vs identity cosine similarity: ${structVsIdentity != null ? structVsIdentity.toFixed(4) : 'n/a'}`);
    console.log('  Top-5 neighbors (legacy):');
    for (const { role: r, similarity } of top5Legacy) {
      console.log(`    - ${r.title} (sim: ${similarity.toFixed(4)})`);
    }
    console.log('  Top-5 neighbors (hybrid):');
    for (const { role: r, similarity } of top5Hybrid) {
      console.log(`    - ${r.title} (sim: ${similarity.toFixed(4)})`);
    }

    // Hybrid similarity differences: compare legacy vs hybrid for same neighbor
    const legacyTitles = new Set(top5Legacy.map((x) => x.role.title?.toLowerCase()));
    const hybridTitles = new Set(top5Hybrid.map((x) => x.role.title?.toLowerCase()));
    const overlap = [...legacyTitles].filter((t) => hybridTitles.has(t)).length;
    const onlyLegacy = [...legacyTitles].filter((t) => !hybridTitles.has(t));
    const onlyHybrid = [...hybridTitles].filter((t) => !legacyTitles.has(t));

    console.log(`  Neighbor overlap (legacy ∩ hybrid): ${overlap}/5`);
    if (onlyLegacy.length > 0) console.log(`  Only in legacy top-5: ${onlyLegacy.join(', ')}`);
    if (onlyHybrid.length > 0) console.log(`  Only in hybrid top-5: ${onlyHybrid.join(', ')}`);
    console.log('');
  }

  // Summary: aggregate structured vs identity similarity
  const structIdentSims = sample
    .map((r) => {
      const sv = getStructuredVector(r);
      const iv = getIdentityVector(r);
      return (sv && iv) ? cosineSimilarity(sv, iv) : null;
    })
    .filter((x) => x != null);

  if (structIdentSims.length > 0) {
    const avg = structIdentSims.reduce((a, b) => a + b, 0) / structIdentSims.length;
    const min = Math.min(...structIdentSims);
    const max = Math.max(...structIdentSims);
    console.log('--- Summary ---');
    console.log(`  Structured vs identity (avg): ${avg.toFixed(4)}`);
    console.log(`  Structured vs identity (min-max): ${min.toFixed(4)} - ${max.toFixed(4)}`);
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
