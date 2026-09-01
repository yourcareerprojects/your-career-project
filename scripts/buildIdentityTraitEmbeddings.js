#!/usr/bin/env node
/**
 * buildIdentityTraitEmbeddings.js
 *
 * Precomputes OpenAI embeddings for every identity trait in identityTraitCatalog.js.
 * Output is written to src/constants/identityTraitEmbeddings.json for fast runtime loading
 * via traitEmbeddingsStore.js (no API calls during identity profile assembly).
 *
 * Model: text-embedding-3-large (3072 dimensions, L2-normalized)
 *
 * ── When to regenerate ──────────────────────────────────────────────────────
 * Re-run this script whenever you change any trait in identityTraitCatalog.js:
 *   - added / removed traits
 *   - name, description, category, or keyword changes
 *
 * The script is idempotent: unchanged traits are skipped based on a SHA-256 hash
 * of their embedding text. Use --force to regenerate every trait.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   npm run build:identity-trait-embeddings
 *   npm run build:identity-trait-embeddings:dry
 *   npm run build:identity-trait-embeddings:force
 *
 *   node scripts/buildIdentityTraitEmbeddings.js [--force] [--dry-run] [--batch-size=N]
 *
 * Prerequisites:
 *   OPENAI_API_KEY in .env
 *
 * After regeneration:
 *   Commit src/constants/identityTraitEmbeddings.json so deployments load embeddings
 *   without calling OpenAI at runtime.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { assertCatalogIntegrity, listTraitDefinitions } = require('../src/constants/identityTraitCatalog');
const {
  buildTraitEmbeddingTextMap,
} = require('../src/server/services/careerIdentity/traitEmbeddingText');
const {
  EMBEDDINGS_FILE,
  EMBEDDING_MODEL,
  STORE_VERSION,
} = require('../src/server/services/careerIdentity/traitEmbeddingsStore');
const { embedTextBatch, EMBEDDING_DIMS } = require('../src/server/services/embedding/embeddingService');

function parseArgs() {
  const flags = {
    force: false,
    dryRun: false,
    batchSize: 100,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--force') flags.force = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--batch-size=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) flags.batchSize = n;
    }
  }

  return flags;
}

function loadExistingStore() {
  if (!fs.existsSync(EMBEDDINGS_FILE)) {
    return { traits: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(EMBEDDINGS_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { traits: {} };
  } catch (err) {
    console.warn(`Warning: could not read existing embeddings file (${err.message}); rebuilding all traits.`);
    return { traits: {} };
  }
}

function writeStoreAtomic(payload) {
  const dir = path.dirname(EMBEDDINGS_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${EMBEDDINGS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, EMBEDDINGS_FILE);
}

async function main() {
  const flags = parseArgs();

  console.log('=== Build Identity Trait Embeddings ===');
  console.log(`  Model:      ${EMBEDDING_MODEL}`);
  console.log(`  Dims:       ${EMBEDDING_DIMS}`);
  console.log(`  Output:     ${EMBEDDINGS_FILE}`);
  console.log(`  Force:      ${flags.force}`);
  console.log(`  Dry run:    ${flags.dryRun}`);
  console.log(`  Batch size: ${flags.batchSize}`);
  console.log('');

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY must be set in .env');
    process.exit(1);
  }

  assertCatalogIntegrity();

  const catalogTraits = listTraitDefinitions();
  const textMap = buildTraitEmbeddingTextMap();
  const existing = loadExistingStore();
  const existingTraits = existing.traits && typeof existing.traits === 'object' ? existing.traits : {};

  const outputTraits = {};
  const toEmbed = [];

  for (const trait of catalogTraits) {
    const { text, textHash } = textMap.get(trait.id);
    const prev = existingTraits[trait.id];

    if (
      !flags.force &&
      prev &&
      prev.textHash === textHash &&
      Array.isArray(prev.embedding) &&
      prev.embedding.length === EMBEDDING_DIMS
    ) {
      outputTraits[trait.id] = {
        textHash,
        embedding: prev.embedding,
      };
      continue;
    }

    toEmbed.push({ traitId: trait.id, text, textHash });
  }

  const removedTraitIds = Object.keys(existingTraits).filter(
    (id) => !textMap.has(id)
  );

  console.log(`Catalog traits:     ${catalogTraits.length}`);
  console.log(`Reuse unchanged:    ${catalogTraits.length - toEmbed.length}`);
  console.log(`Embed (API calls):  ${toEmbed.length}`);
  if (removedTraitIds.length > 0) {
    console.log(`Remove stale:       ${removedTraitIds.length} (${removedTraitIds.join(', ')})`);
  }
  console.log('');

  if (toEmbed.length > 0) {
    for (let start = 0; start < toEmbed.length; start += flags.batchSize) {
      const batch = toEmbed.slice(start, start + flags.batchSize);
      const texts = batch.map((row) => row.text);
      const vectors = await embedTextBatch(texts);

      for (let i = 0; i < batch.length; i += 1) {
        const row = batch[i];
        const vec = vectors[i];
        if (!vec || vec.length !== EMBEDDING_DIMS) {
          throw new Error(`Embedding failed or wrong dims for trait ${row.traitId}`);
        }
        outputTraits[row.traitId] = {
          textHash: row.textHash,
          embedding: Array.from(vec),
        };
      }

      const done = Math.min(start + batch.length, toEmbed.length);
      process.stdout.write(`\rEmbedded ${done}/${toEmbed.length} traits...`);
    }
    console.log('\n');
  }

  const payload = {
    version: STORE_VERSION,
    model: EMBEDDING_MODEL,
    dims: EMBEDDING_DIMS,
    builtAt: new Date().toISOString(),
    catalogTraitCount: catalogTraits.length,
    traits: outputTraits,
  };

  const missing = catalogTraits.filter((t) => !outputTraits[t.id]);
  if (missing.length > 0) {
    throw new Error(`Missing embeddings for traits: ${missing.map((t) => t.id).join(', ')}`);
  }

  if (flags.dryRun) {
    console.log('Dry run — no file written.');
    console.log(`Would write ${Object.keys(outputTraits).length} trait embeddings to ${EMBEDDINGS_FILE}`);
    return;
  }

  writeStoreAtomic(payload);
  console.log(`Wrote ${Object.keys(outputTraits).length} trait embeddings to ${EMBEDDINGS_FILE}`);
  console.log('\nDone. Commit identityTraitEmbeddings.json with your catalog changes.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
