#!/usr/bin/env node
/**
 * Merge CareerPath roles whose title contains both whole words "sales" and "representative"
 * into one canonical role titled "Sales representative".
 *
 * Same merge pipeline as mergeDistributionManagerCluster.js (--apply).
 *
 * Usage:
 *   node scripts/mergeSalesRepresentativeCluster.js --dry-run
 *   node scripts/mergeSalesRepresentativeCluster.js --apply
 */

require('dotenv').config();

const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');
const User = require('../src/server/models/User');
const { buildRoleVectors } = require('../src/server/services/embedding/roleVectorService');
const { mergeClusterDocs, remapEscoDeep } = require('./lib/roleClusterMerge');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';
const CANONICAL_TITLE = 'Sales representative';

const TITLE_QUERY = {
  $and: [
    { title: { $regex: '\\bsales\\b', $options: 'i' } },
    { title: { $regex: '\\brepresentative\\b', $options: 'i' } },
  ],
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  return { apply, dryRun: !apply };
}

function pickCanonicalEscoId(docs) {
  const target = CANONICAL_TITLE.toLowerCase();
  const exact = docs.filter((d) => String(d.title || '').trim().toLowerCase() === target);
  if (exact.length === 1) return exact[0].escoId;
  if (exact.length > 1) {
    return exact.map((d) => d.escoId).sort()[0];
  }
  return docs.map((d) => d.escoId).sort()[0];
}

async function main() {
  const flags = parseArgs();
  if (!process.env.OPENAI_API_KEY) {
    console.error(JSON.stringify({ error: 'OPENAI_API_KEY required' }));
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);

  const docs = await CareerPath.find(TITLE_QUERY, {}).sort({ escoId: 1 }).lean();

  if (docs.length === 0) {
    console.log(JSON.stringify({ error: 'No matching roles found' }));
    await mongoose.disconnect();
    process.exit(1);
  }

  if (docs.length === 1) {
    const m = docs[0].mergedFromEscoIds || [];
    const titleOk = String(docs[0].title || '').trim().toLowerCase() === CANONICAL_TITLE.toLowerCase();
    console.log(
      JSON.stringify({
        info: 'Single document matches query',
        escoId: docs[0].escoId,
        title: docs[0].title,
        mergedFromEscoIds_count: m.length,
        likely_already_merged: titleOk && m.length >= 3,
      }),
    );
    await mongoose.disconnect();
    process.exit(0);
  }

  const canonicalEscoId = pickCanonicalEscoId(docs);
  const merged = mergeClusterDocs(docs, canonicalEscoId, { canonicalTitle: CANONICAL_TITLE });

  const idRemap = {};
  for (const d of docs) {
    if (d.escoId !== canonicalEscoId) idRemap[d.escoId] = canonicalEscoId;
  }

  const report = {
    cluster_size: docs.length,
    canonical_esco_id: canonicalEscoId,
    canonical_title: merged.title,
    alternative_titles_count: merged.altTitles.length,
    merged_from_count: merged.mergedFromEscoIds.length,
    required_skills_count: merged.requiredSkills.length,
    dry_run: flags.dryRun,
  };

  if (flags.dryRun) {
    console.log(
      JSON.stringify(
        {
          summary: report,
          alternative_titles_sample: merged.altTitles.slice(0, 20),
          identity_preview: merged.roleIdentity.role_identity_text.slice(0, 400),
        },
        null,
        2,
      ),
    );
    await mongoose.disconnect();
    return;
  }

  try {
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
      throw new Error('buildRoleVectors returned null');
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
    const toDelete = docs.map((d) => d.escoId).filter((id) => id !== canonicalEscoId);
    if (toDelete.length) {
      await CareerPath.deleteMany({ escoId: { $in: toDelete } });
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

    console.log(
      JSON.stringify(
        {
          ok: true,
          ...report,
          dry_run: false,
          deleted_esco_ids: toDelete.length,
          users_remapped: usersRemapped,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message }));
    process.exitCode = 1;
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
