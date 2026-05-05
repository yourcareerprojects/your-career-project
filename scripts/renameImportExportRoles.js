#!/usr/bin/env node
/**
 * Rename two import/export roles to shorter titles; preserve old title in altTitles;
 * rebuild deterministic role identity text and roleVectors (OpenAI embeddings).
 *
 * Usage: node scripts/renameImportExportRoles.js
 *
 * Requires: MONGODB_URI, OPENAI_API_KEY
 */

require('dotenv').config();

const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');
const { buildRoleVectors } = require('../src/server/services/embedding/roleVectorService');
const {
  composeDeterministic,
  computeInputHash,
} = require('../src/server/services/jobAnalysis/roleIdentityComposer');

const RENAMES = [
  {
    from: 'import export manager in computers, computer peripheral equipment and software',
    to: 'import export manager',
  },
  {
    from: 'import export specialist in textiles and textile semi-finished and raw materials',
    to: 'import export specialist',
  },
];

function trimWordRange(text, maxW) {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= maxW) return words.join(' ');
  return words.slice(0, maxW).join(' ');
}

function uniqAltTitles(preferred, existing) {
  const seen = new Set();
  const out = [];
  for (const t of [preferred, ...(existing || [])]) {
    const s = String(t || '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

async function processOne(doc, newTitle) {
  const oldTitle = doc.title;
  const altTitles = uniqAltTitles(oldTitle, doc.altTitles).filter(
    (t) => t.toLowerCase() !== newTitle.toLowerCase(),
  );

  const working = {
    ...doc,
    title: newTitle,
    altTitles,
  };

  const det = composeDeterministic(working);
  const role_identity_text = trimWordRange(det.role_identity_text, 120);

  working.roleIdentity = {
    ...(doc.roleIdentity || {}),
    role_identity_text,
    input_hash: computeInputHash({
      title: newTitle,
      altTitles,
      hiddenTitles: doc.hiddenTitles || [],
      description: doc.description || '',
    }),
    extraction_confidence: det.extraction_confidence,
    built_at: new Date(),
    built_with: 'deterministic',
  };

  const vectors = await buildRoleVectors(working);
  if (!vectors) {
    throw new Error('buildRoleVectors returned null');
  }

  return {
    title: newTitle,
    altTitles,
    roleIdentity: working.roleIdentity,
    roleVectors: vectors,
    lastUpdated: new Date(),
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error(JSON.stringify({ error: 'OPENAI_API_KEY required' }));
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const results = [];

  for (const { from, to } of RENAMES) {
    const doc = await CareerPath.findOne({ title: from }).lean();
    if (!doc) {
      results.push({ from, to, ok: false, error: 'not_found' });
      continue;
    }
    try {
      const update = await processOne(doc, to);
      await CareerPath.updateOne({ _id: doc._id }, { $set: update });
      results.push({
        from,
        to,
        ok: true,
        escoId: doc.escoId,
        altTitles_count: update.altTitles.length,
      });
    } catch (e) {
      results.push({ from, to, ok: false, error: e.message });
    }
  }

  await mongoose.disconnect();
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
