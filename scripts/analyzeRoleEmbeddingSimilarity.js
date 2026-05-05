#!/usr/bin/env node
/**
 * Pairwise cosine similarity analysis for role identity embeddings (MongoDB CareerPath).
 *
 * Usage: node scripts/analyzeRoleEmbeddingSimilarity.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');

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

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((x, y) => x + y, 0) / arr.length;
}

function stdDev(arr, m) {
  if (arr.length < 2) return 0;
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function medianSorted(sorted) {
  const n = sorted.length;
  if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const cursor = CareerPath.find(
    {
      'roleVectors.identity_vector': { $exists: true, $type: 'array' },
      $expr: { $gt: [{ $size: '$roleVectors.identity_vector' }, 0] },
    },
    {
      escoId: 1,
      title: 1,
      'roleIdentity.role_identity_text': 1,
      'roleVectors.identity_vector': 1,
    }
  )
    .lean()
    .cursor();

  const roles = [];
  for await (const doc of cursor) {
    const v = doc.roleVectors?.identity_vector;
    if (!Array.isArray(v) || v.length === 0) continue;
    roles.push({
      id: doc.escoId || String(doc._id),
      title: doc.title || doc.escoId || String(doc._id),
      text: doc.roleIdentity?.role_identity_text || null,
      vector: v,
    });
  }

  await mongoose.disconnect();

  const n = roles.length;
  if (n < 2) {
    console.log(JSON.stringify({ error: 'Need at least 2 roles with identity_vector', count: n }, null, 2));
    process.exit(n === 0 ? 1 : 0);
  }

  const totalPairs = (n * (n - 1)) / 2;
  const sims = new Float32Array(totalPairs);
  /** Pairs with novelty < 0.20 ⇔ cosine > 0.80 (aligned with simulation: novelty = 1 − similarity). */
  const noveltyLowThresholdCos = 0.8;
  let lowNoveltyPairCount = 0;
  let pairIdx = 0;
  /** @type {{ i: number, j: number, sim: number, a: string, b: string, idA: string, idB: string }[]} */
  const topMin = [];

  function pushTop20(entry) {
    if (topMin.length < 20) {
      topMin.push(entry);
      topMin.sort((x, y) => x.sim - y.sim);
      return;
    }
    if (entry.sim <= topMin[0].sim) return;
    topMin[0] = entry;
    topMin.sort((x, y) => x.sim - y.sim);
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosineSim(roles[i].vector, roles[j].vector);
      sims[pairIdx++] = s;
      if (s > noveltyLowThresholdCos) lowNoveltyPairCount += 1;
      pushTop20({
        i,
        j,
        sim: s,
        a: roles[i].title,
        b: roles[j].title,
        idA: roles[i].id,
        idB: roles[j].id,
      });
    }
  }

  const top = topMin.sort((x, y) => y.sim - x.sim);

  const m = mean(sims);
  const sorted = Array.from(sims).sort((a, b) => a - b);
  const med = medianSorted(sorted);
  const sd = stdDev(sims, m);
  const minS = sorted[0];
  const maxS = sorted[sorted.length - 1];
  const pctPairsNoveltyBelow020 = (100 * lowNoveltyPairCount) / totalPairs;
  const pctPairsNoveltyAtLeast020 = 100 - pctPairsNoveltyBelow020;

  const lowVariance = m > 0.6 && sd < 0.1;
  const diagnosis = lowVariance ? 'Low variance (embeddings too similar)' : 'Healthy variance';

  const top20 = top.slice(0, 20).map((t) => ({
    roleA: t.a,
    roleB: t.b,
    roleIdA: t.idA,
    roleIdB: t.idB,
    cosineSimilarity: Number(t.sim.toFixed(6)),
    noveltyScore: Number((1 - t.sim).toFixed(6)),
  }));

  const out = {
    rolesAnalyzed: n,
    totalPairs,
    summary: {
      meanCosineSimilarity: Number(m.toFixed(6)),
      medianCosineSimilarity: Number(med.toFixed(6)),
      standardDeviation: Number(sd.toFixed(6)),
      minSimilarity: Number(minS.toFixed(6)),
      maxSimilarity: Number(maxS.toFixed(6)),
    },
    lowNoveltyPairs: {
      noveltyThreshold: 0.2,
      description: 'Pairs with novelty < 0.20 (cosine similarity > 0.80)',
      count: lowNoveltyPairCount,
      percentOfAllPairs: Number(pctPairsNoveltyBelow020.toFixed(4)),
    },
    percentOfPairsWithNoveltyAtLeast020: Number(pctPairsNoveltyAtLeast020.toFixed(4)),
    top20MostSimilarPairs: top20,
    diagnosis,
    lowVarianceFlag: lowVariance ? 'LOW VARIANCE IN EMBEDDINGS' : null,
  };

  console.log(JSON.stringify(out, null, 2));

  // Optional: short text overlap hint for top pairs (generic terms)
  const generic = new Set([
    'problem-solving',
    'problem solving',
    'collaboration',
    'communication',
    'team',
    'stakeholder',
    'analysis',
    'management',
    'development',
    'support',
    'quality',
    'customer',
    'business',
    'technical',
    'skills',
    'experience',
    'responsible',
    'ensure',
    'work',
  ]);

  function textSignals(text) {
    if (!text || typeof text !== 'string') return { wordCount: 0, genericHits: 0, sample: '' };
    const lower = text.toLowerCase();
    let hits = 0;
    for (const g of generic) {
      if (lower.includes(g)) hits += 1;
    }
    return { wordCount: text.split(/\s+/).filter(Boolean).length, genericHits: hits, sample: text.slice(0, 120) };
  }

  console.log('\n--- Optional: top-pair identity text signals (generic-term overlap heuristic) ---\n');
  for (const t of top.slice(0, 5)) {
    const ta = roles[t.i].text;
    const tb = roles[t.j].text;
    const sa = textSignals(ta);
    const sb = textSignals(tb);
    console.log(`Pair: "${t.a}"  <->  "${t.b}"  (sim ${t.sim.toFixed(4)})`);
    console.log(`  A: generic term types matched: ${sa.genericHits}, words ~${sa.wordCount}`);
    console.log(`  B: generic term types matched: ${sb.genericHits}, words ~${sb.wordCount}`);
    if (sa.sample) console.log(`  A preview: ${sa.sample.replace(/\s+/g, ' ')}...`);
    if (sb.sample) console.log(`  B preview: ${sb.sample.replace(/\s+/g, ' ')}...`);
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
