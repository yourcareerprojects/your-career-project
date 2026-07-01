const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

function asStringItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean);
  }
  if (typeof value === 'object' && Array.isArray(value.raw_items)) {
    return value.raw_items.map((v) => String(v || '').trim()).filter(Boolean);
  }
  return [];
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const users = await mongoose.connection.db.collection('users').find({}, {
    projection: {
      'profile.structuredUserInfo.domains': 1,
      'profile.careerSimulationInputs.structuredUserInfo.domains': 1,
      'profile.careerPreferences.domains': 1,
    },
  }).toArray();

  const counts = new Map();
  let usersWithDomains = 0;

  for (const user of users) {
    const profile = user.profile || {};
    const structured = profile.structuredUserInfo || {};
    const csi = profile.careerSimulationInputs?.structuredUserInfo || {};
    const legacy = profile.careerPreferences?.domains || [];
    const items = [
      ...asStringItems(structured.domains),
      ...asStringItems(csi.domains),
      ...asStringItems(legacy),
    ];
    if (items.length === 0) continue;
    usersWithDomains += 1;
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item)) continue;
      seen.add(item);
      counts.set(item, (counts.get(item) || 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const redactedUri = MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');

  console.log(JSON.stringify({
    mongoUri: redactedUri,
    totalUsers: users.length,
    usersWithAtLeastOneDomain: usersWithDomains,
    distinctDomainCount: sorted.length,
    domains: sorted.map(([domain, userCount]) => ({ domain, userCount })),
  }, null, 2));

  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.connection.close();
  } catch (_) {
    // ignore
  }
  process.exit(1);
});
