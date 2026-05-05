require('dotenv').config();

const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set in .env');
  }

  await mongoose.connect(uri);
  const User = require('../src/server/models/User');

  const count = await User.countDocuments();
  console.log(`users_count=${count}`);

  if (count > 0) {
    const sample = await User.find({}, { email: 1 }).limit(5).lean();
    console.log('sample_emails=', sample.map((u) => u.email));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

