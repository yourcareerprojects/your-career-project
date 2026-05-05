#!/usr/bin/env node
/**
 * Pairwise cosine similarity for test users' identity embeddings
 * (same identity text pipeline as production: resolveIdentityTextOnce + text-embedding-3-large).
 *
 * Loads evaluation/testUsers (same rules as evaluationRunner.js).
 *
 * Usage (from repo root):
 *   node scripts/analyzeTestUserIdentitySimilarity.js
 *
 * After changing the identity prompt, re-run this script (or scripts/reembedTestUserIdentities.js)
 * to regenerate all test-user identity texts and embeddings. Test JSON has no Mongo cache.
 *
 * Requires: OPENAI_API_KEY in .env
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  resolveIdentityTextOnce,
  buildUserIdentityVector,
} = require('../src/server/services/embedding/userProfileVectorBuilder');

const TEST_USERS_DIR = path.join(__dirname, '..', 'evaluation', 'testUsers');

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

function loadTestUsers() {
  if (!fs.existsSync(TEST_USERS_DIR)) {
    return [];
  }
  const files = fs.readdirSync(TEST_USERS_DIR).filter((f) => {
    if (f.startsWith('.') || f === '.gitkeep') return false;
    const fullPath = path.join(TEST_USERS_DIR, f);
    if (!fs.statSync(fullPath).isFile()) return false;
    return f.endsWith('.json') || f.startsWith('user');
  });
  const users = [];
  for (const f of files) {
    const filePath = path.join(TEST_USERS_DIR, f);
    const content = fs.readFileSync(filePath, 'utf8');
    let data;
    try {
      data = JSON.parse(content);
    } catch (e) {
      console.warn(`Skip invalid JSON: ${f}`);
      continue;
    }
    const id = data.id ?? data.userId ?? path.basename(f, '.json');
    const profile = data.profile ?? data.userProfile ?? data;
    const label = path.basename(f).replace(/\.json$/i, '');
    users.push({ id, profile, sourceFile: f, label });
  }
  users.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return users;
}

function normalizeUserProfile(raw) {
  return {
    userSkills: raw.userSkills ?? [],
    userSkillsInDevelopment: raw.userSkillsInDevelopment ?? [],
    userWorkExperience: raw.userWorkExperience ?? [],
    userEducation: raw.userEducation ?? {},
    userCareerPreferences: raw.userCareerPreferences ?? {},
    userInterests: raw.userInterests ?? [],
    careerGoal: raw.careerGoal ?? '',
    bio: raw.bio ?? '',
    dateOfBirth: raw.dateOfBirth ?? null,
    currentStatus: raw.currentStatus ?? '',
    yearsOfExperience: raw.yearsOfExperience,
    highestDegree: raw.highestDegree ?? '',
    mostSeniorWorkExperience: raw.mostSeniorWorkExperience ?? '',
  };
}

async function main() {
  const rawUsers = loadTestUsers();
  if (rawUsers.length < 2) {
    console.error(JSON.stringify({ error: 'Need at least 2 test users', count: rawUsers.length }, null, 2));
    process.exit(1);
  }

  const roles = [];
  for (const u of rawUsers) {
    const profile = normalizeUserProfile(u.profile);
    const identityText = await resolveIdentityTextOnce(profile);
    const vector = await buildUserIdentityVector(profile);
    if (!vector || vector.length === 0) {
      console.warn(`No vector for user ${u.id}`);
      continue;
    }
    roles.push({
      id: u.id,
      label: u.label,
      text: identityText,
      vector: Array.from(vector),
    });
  }

  const n = roles.length;
  if (n < 2) {
    console.error(JSON.stringify({ error: 'Could not embed at least 2 users', count: n }, null, 2));
    process.exit(1);
  }

  const totalPairs = (n * (n - 1)) / 2;
  const sims = new Float32Array(totalPairs);
  const highThreshold = 0.8;
  let highCount = 0;
  let pairIdx = 0;
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

  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) matrix[i][i] = 1;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosineSim(roles[i].vector, roles[j].vector);
      sims[pairIdx++] = s;
      matrix[i][j] = s;
      matrix[j][i] = s;
      if (s > highThreshold) highCount += 1;
      pushTop20({
        i,
        j,
        sim: s,
        a: roles[i].id,
        b: roles[j].id,
        labelA: roles[i].label,
        labelB: roles[j].label,
      });
    }
  }

  const top = topMin.sort((x, y) => y.sim - x.sim);

  const perUserNearest = roles.map((_, i) => {
    const others = roles
      .map((r, j) => (i === j ? null : { j, id: r.id, label: r.label, sim: matrix[i][j] }))
      .filter(Boolean)
      .sort((a, b) => b.sim - a.sim);
    return {
      userId: roles[i].id,
      label: roles[i].label,
      mostSimilar: others.slice(0, 3).map((o) => ({ userId: o.id, label: o.label, cosine: Number(o.sim.toFixed(4)) })),
      leastSimilar: others.slice(-3).reverse().map((o) => ({ userId: o.id, label: o.label, cosine: Number(o.sim.toFixed(4)) })),
    };
  });

  const m = mean(sims);
  const sorted = Array.from(sims).sort((a, b) => a - b);
  const med = medianSorted(sorted);
  const sd = stdDev(sims, m);
  const minS = sorted[0];
  const maxS = sorted[sorted.length - 1];
  const pctHigh = (100 * highCount) / totalPairs;

  const lowVariance = m > 0.6 && sd < 0.1;
  const diagnosis = lowVariance ? 'Low variance (embeddings too similar)' : 'Healthy variance';

  const top20MostSimilarPairs = top.slice(0, 20).map((t) => ({
    userA: t.a,
    userB: t.b,
    labelA: t.labelA,
    labelB: t.labelB,
    similarity: Number(t.sim.toFixed(6)),
  }));

  const out = {
    source: 'evaluation/testUsers',
    usersAnalyzed: n,
    userIds: roles.map((r) => r.id),
    totalPairs,
    summary: {
      meanCosineSimilarity: Number(m.toFixed(6)),
      medianCosineSimilarity: Number(med.toFixed(6)),
      standardDeviation: Number(sd.toFixed(6)),
      minSimilarity: Number(minS.toFixed(6)),
      maxSimilarity: Number(maxS.toFixed(6)),
    },
    highSimilarityOver080: {
      count: highCount,
      percentOfAllPairs: Number(pctHigh.toFixed(4)),
    },
    top20MostSimilarPairs,
    diagnosis,
    lowVarianceFlag: lowVariance ? 'LOW VARIANCE IN EMBEDDINGS' : null,
    rowLabels: roles.map((r) => r.id),
    pairwiseCosineMatrix: matrix.map((row) => row.map((v) => Number(v.toFixed(6)))),
    perUserNearest,
  };

  const outPath = path.join(__dirname, '..', 'evaluation', 'output', 'testUserIdentityCosineMatrix.json');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.error(`Wrote full matrix: ${outPath}`);
  } catch (e) {
    console.error('Could not write matrix file:', e.message);
  }

  const { pairwiseCosineMatrix, ...summaryForConsole } = out;
  console.log(JSON.stringify(summaryForConsole, null, 2));

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
    'passionate',
    'aspiring',
  ]);

  function textSignals(text) {
    if (!text || typeof text !== 'string') return { wordCount: 0, genericHits: 0, sample: '' };
    const lower = text.toLowerCase();
    let hits = 0;
    for (const g of generic) {
      if (lower.includes(g)) hits += 1;
    }
    return { wordCount: text.split(/\s+/).filter(Boolean).length, genericHits: hits, sample: text.slice(0, 140) };
  }

  console.log('\n--- Optional: top pairs — identity text snippet (generic-term heuristic) ---\n');
  for (const t of top.slice(0, Math.min(5, top.length))) {
    const ta = roles[t.i].text;
    const tb = roles[t.j].text;
    const sa = textSignals(ta);
    const sb = textSignals(tb);
    console.log(`Pair: ${t.a} (${t.labelA})  <->  ${t.b} (${t.labelB})  sim ${t.sim.toFixed(4)}`);
    console.log(`  A: generic types ~${sa.genericHits}, words ~${sa.wordCount}`);
    console.log(`  B: generic types ~${sb.genericHits}, words ~${sb.wordCount}`);
    console.log(`  A: ${sa.sample.replace(/\s+/g, ' ')}...`);
    console.log(`  B: ${sb.sample.replace(/\s+/g, ' ')}...`);
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
