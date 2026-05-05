#!/usr/bin/env node
/**
 * List CareerPath roles whose title contains every given word (whole-word, case-insensitive).
 * Usage: node scripts/findRolesTitleAllWords.js sales representative
 */
require('dotenv').config();
const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');

const words = process.argv.slice(2).filter(Boolean);
if (!words.length) {
  console.error('Usage: node scripts/findRolesTitleAllWords.js <word> [word...]');
  process.exit(1);
}

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const lookahead = words
    .map((w) => `(?=.*\\b${escapeRx(w)}\\b)`)
    .join('');
  const rx = new RegExp(`^${lookahead}.*$`, 'i');
  const docs = await CareerPath.find({ title: rx }, { escoId: 1, title: 1, _id: 0 })
    .sort({ title: 1 })
    .lean();
  console.log(JSON.stringify({ words, count: docs.length, roles: docs }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
