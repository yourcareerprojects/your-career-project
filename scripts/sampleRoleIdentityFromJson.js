#!/usr/bin/env node
/**
 * Sample N random roles from final_roles_refined.json and print LLM role identity texts.
 *
 * Usage:
 *   node scripts/sampleRoleIdentityFromJson.js [--count=5] [--seed=123]
 *
 * Requires OPENAI_API_KEY (and optional OPENAI_MODEL, OPENAI_BASE_URL).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { composeFromCareerPath } = require('../src/server/services/jobAnalysis/roleIdentityComposer');

function parseArgs() {
  const out = { count: 5, seed: null };
  for (const arg of process.argv.slice(2)) {
    const mCount = arg.match(/^--count=(\d+)$/);
    if (mCount) out.count = Math.min(50, Math.max(1, parseInt(mCount[1], 10)));
    const mSeed = arg.match(/^--seed=(\d+)$/);
    if (mSeed) out.seed = parseInt(mSeed[1], 10);
  }
  return out;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom(arr, count, rand) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function toCareerPathDoc(role) {
  return {
    title: role.title || '',
    altTitles: Array.isArray(role.alternative_titles) ? role.alternative_titles : [],
    description: role.description || '',
  };
}

async function main() {
  const { count, seed } = parseArgs();
  const rand =
    seed != null ? mulberry32(seed) : () => crypto.randomInt(0, 1_000_000_000) / 1_000_000_000;

  const jsonPath = path.join(__dirname, '..', 'final_roles_refined.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('Missing file:', jsonPath);
    process.exit(1);
  }

  console.error('Loading JSON (may take a few seconds)…');
  const roles = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const pool = roles.filter((r) => r && r.title && r.description && String(r.description).length > 80);
  if (pool.length < count) {
    console.error(`Only ${pool.length} roles with description; need at least ${count}.`);
    process.exit(1);
  }

  const sample = pickRandom(pool, count, rand);

  for (let i = 0; i < sample.length; i++) {
    const role = sample[i];
    const doc = toCareerPathDoc(role);
    process.stdout.write(`\n========== Sample ${i + 1} / ${count} ==========\n`);
    process.stdout.write(`Title: ${doc.title}\n`);
    process.stdout.write(`ESCO id: ${role.id || '(none)'}\n\n`);
    process.stdout.write('--- Role description (source) ---\n');
    process.stdout.write(`${doc.description.trim()}\n\n`);

    const result = await composeFromCareerPath(doc, { method: 'llm' });
    process.stdout.write('--- Role identity text (LLM) ---\n');
    process.stdout.write(`${result.role_identity_text}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
