#!/usr/bin/env node
/**
 * Verify CareerPath merge: counts, merged trace, distinct escoId, sample doc.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const total = await CareerPath.countDocuments({});
  const distinct = await CareerPath.distinct('escoId').then((a) => a.length);
  const mergedCanon = await CareerPath.countDocuments({
    mergedFromEscoIds: { $exists: true, $not: { $size: 0 } },
  });
  const withIdentity = await CareerPath.countDocuments({
    'roleVectors.identity_vector': { $exists: true, $type: 'array', $not: { $size: 0 } },
  });

  const sumAbsorbed = await CareerPath.aggregate([
    { $match: { mergedFromEscoIds: { $exists: true, $ne: [] } } },
    { $project: { n: { $size: '$mergedFromEscoIds' } } },
    { $group: { _id: null, total: { $sum: '$n' } } },
  ]);
  const absorbedRoles = sumAbsorbed[0]?.total ?? 0;

  const sample = await CareerPath.findOne(
    { mergedFromEscoIds: { $exists: true, $not: { $size: 0 } } },
    {
      escoId: 1,
      title: 1,
      mergedFromEscoIds: 1,
      'roleIdentity.role_identity_text': 1,
      'roleVectors.dims': 1,
    },
  ).lean();

  console.log(
    JSON.stringify(
      {
        ok: total === distinct && total > 0,
        totalCareerPaths: total,
        distinctEscoIds: distinct,
        canonicalsWithMergedFromEscoIds: mergedCanon,
        documentsWithIdentityVector: withIdentity,
        totalAbsorbedRoleSlots: absorbedRoles,
        impliedPreMergeUniqueRoles: total + absorbedRoles,
        sampleMergedCanonical: sample
          ? {
              escoId: sample.escoId,
              title: sample.title,
              mergedFromCount: sample.mergedFromEscoIds?.length,
              identityTextWords: sample.roleIdentity?.role_identity_text
                ? sample.roleIdentity.role_identity_text.split(/\s+/).filter(Boolean).length
                : 0,
              embeddingDims: sample.roleVectors?.dims ?? null,
            }
          : null,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
