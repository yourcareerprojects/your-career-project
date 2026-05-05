#!/usr/bin/env node
/**
 * Re-run LLM identity text + OpenAI embedding for every profile in evaluation/testUsers.
 *
 * Uses the current prompt in:
 *   src/server/prompts/generateUserIdentityEmbeddingText.js
 *
 * Test JSON files are not backed by MongoDB and do not carry embedding cache fields,
 * so each run always calls the LLM and embedding API with the latest code.
 *
 * Usage (repo root, requires OPENAI_API_KEY in .env):
 *   node scripts/reembedTestUserIdentities.js
 *   node scripts/reembedTestUserIdentities.js --include-vectors   # adds full vectors (large JSON)
 *
 * For pairwise cosine stats after re-embedding, run:
 *   node scripts/analyzeTestUserIdentitySimilarity.js
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  resolveIdentityTextOnce,
  buildUserIdentityVector,
} = require('../src/server/services/embedding/userProfileVectorBuilder');

const TEST_USERS_DIR = path.join(__dirname, '..', 'evaluation', 'testUsers');
const OUT_PATH = path.join(__dirname, '..', 'evaluation', 'output', 'testUserIdentityReembed.json');

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
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
  const includeVectors = process.argv.includes('--include-vectors');

  const rawUsers = loadTestUsers();
  if (rawUsers.length === 0) {
    console.error(JSON.stringify({ error: 'No test users found', dir: TEST_USERS_DIR }, null, 2));
    process.exit(1);
  }

  const users = [];
  for (const u of rawUsers) {
    const profile = normalizeUserProfile(u.profile);
    const identityText = await resolveIdentityTextOnce(profile);
    const vector = await buildUserIdentityVector(profile);
    const entry = {
      id: u.id,
      label: u.label,
      sourceFile: u.sourceFile,
      identityText,
      embeddingDims: vector && vector.length ? vector.length : 0,
      embeddingOk: Boolean(vector && vector.length),
    };
    if (includeVectors && vector && vector.length) {
      entry.identityVector = Array.from(vector);
    }
    users.push(entry);
    console.error(`OK ${u.id} (${u.label}) dims=${entry.embeddingDims}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    embeddingModel: 'text-embedding-3-large',
    includeVectors,
    users,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  console.error(`Wrote ${users.length} users to ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
