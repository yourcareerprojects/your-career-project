require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/server/models/User');
const localizedContentService = require('../src/server/services/localization/localizedContentService');
const {
  getProfileDisplayNarrativesReadiness,
  getProfileNarrativeQualityReadiness,
  getEffectiveIdentityAnswersForNarratives,
} = require('../src/server/services/profile/profileNarrativeReadinessService');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = await User.find({})
    .sort({ updatedAt: -1 })
    .limit(5)
    .lean();

  for (const u of users) {
    const p = u.profile || {};
    const display = getProfileDisplayNarrativesReadiness(p, 'en');
    const quality = getProfileNarrativeQualityReadiness(p, 'en');
    const effectiveIdentity = getEffectiveIdentityAnswersForNarratives(p, 'en');
    const identityFilled = Object.values(effectiveIdentity).filter((v) => String(v || '').trim()).length;

    console.log('\n---', u.email || u._id);
    console.log('  display ready:', display.ready, 'pending:', display.pending);
    console.log('  quality ready:', quality.ready, 'pending:', quality.pending);
    console.log('  effective identity fields filled:', identityFilled);

    const w = p.who_are_you || {};
    const enSummary = String(localizedContentService.get(w.summary_text, 'en') || '').trim();
    const deSummary = String(localizedContentService.get(w.summary_text, 'de') || '').trim();
    console.log('  who_are_you en summary len:', enSummary.length, 'de summary len:', deSummary.length);

    const structured = p.structuredUserInfo || {};
    for (const key of ['skills', 'skillDomains', 'domains', 'keyResponsibilities']) {
      const dim = structured[key];
      const rawItems = Array.isArray(dim?.raw_items) ? dim.raw_items.length : (Array.isArray(dim) ? dim.length : 0);
      if (rawItems === 0) continue;
      const summary = String(localizedContentService.get(dim?.summary_text, 'en') || '').trim();
      console.log(`  ${key}: raw_items=${rawItems}, en summary len=${summary.length}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
