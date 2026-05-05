#!/usr/bin/env node
/**
 * Tokenize CareerPath.title values; count how many distinct roles contain each word
 * and total occurrences. Lists words appearing in >= 2 titles.
 *
 * Usage: node scripts/analyzeRoleTitleWordFrequency.js
 * Output: summary to stdout; full word list JSON to evaluation/output/roleTitleWordFrequency.json
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');

const OUT = path.join(__dirname, '..', 'evaluation', 'output', 'roleTitleWordFrequency.json');

function tokenize(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const titleCount = await CareerPath.countDocuments({ title: { $exists: true, $ne: '' } });

  /** @type {Map<string, Set<string>>} */
  const wordToEscoIds = new Map();
  /** @type {Map<string, number>} */
  const wordTotalOccurrences = new Map();

  const cursor = CareerPath.find({ title: { $exists: true, $ne: '' } }, { escoId: 1, title: 1 })
    .lean()
    .cursor();

  for await (const doc of cursor) {
    const id = doc.escoId || String(doc._id);
    const words = tokenize(doc.title);
    const seenInDoc = new Set();
    for (const w of words) {
      wordTotalOccurrences.set(w, (wordTotalOccurrences.get(w) || 0) + 1);
      if (!seenInDoc.has(w)) {
        seenInDoc.add(w);
        if (!wordToEscoIds.has(w)) wordToEscoIds.set(w, new Set());
        wordToEscoIds.get(w).add(id);
      }
    }
  }

  await mongoose.disconnect();

  const wordsMultiTitle = [];
  for (const [word, idSet] of wordToEscoIds) {
    const rolesContainingWord = idSet.size;
    if (rolesContainingWord < 2) continue;
    wordsMultiTitle.push({
      word,
      rolesContainingWord,
      totalOccurrences: wordTotalOccurrences.get(word) || 0,
    });
  }

  wordsMultiTitle.sort((a, b) => {
    if (b.rolesContainingWord !== a.rolesContainingWord) return b.rolesContainingWord - a.rolesContainingWord;
    if (b.totalOccurrences !== a.totalOccurrences) return b.totalOccurrences - a.totalOccurrences;
    return a.word.localeCompare(b.word);
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    totalRolesWithTitle: titleCount,
    wordsAppearingInAtLeastTwoTitles: wordsMultiTitle.length,
    words: wordsMultiTitle,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        totalRolesWithTitle: titleCount,
        distinctWordsInAnyTitle: wordToEscoIds.size,
        wordsAppearingInTwoOrMoreTitles: wordsMultiTitle.length,
        outputFile: OUT,
        top40ByRoleCount: wordsMultiTitle.slice(0, 40),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
