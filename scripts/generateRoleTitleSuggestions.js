#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const {
  BAD_ROLE_TITLES_PATH,
  ROLE_TITLE_SUGGESTIONS_PATH,
  ensureTmpDir,
  normalizeLabel,
  batchArray,
  parseArgs,
} = require('./lib/skillTranslationPipeline');

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_RETRIES = 5;
const DEFAULT_ALIAS_CHUNK_SIZE = 40;

function buildPrompt(batch, genderStyle = 'neutral') {
  const style = String(genderStyle || 'neutral').toLowerCase();
  const genderRule = (() => {
    if (style === 'mwd') {
      return '- Return each title in market-standard form with " (m/w/d)" suffix (example: "Projektmanager (m/w/d)")';
    }
    if (style === 'starin') {
      return '- Prefer gender-inclusive star form "*in" where it makes linguistic sense (examples: "Projektmanager*in", "Analyst*in", "Berater*in").';
    }
    return '- Use gender-inclusive German wording by default (prefer neutral terms like "Leitung", "Fachkraft", "Spezialist" where natural)';
  })();

  return [
    'You are an expert in professional German job title localization.',
    '',
    'Translate the following role titles into German.',
    '',
    'Rules:',
    '- Use common German job-market titles',
    '- Keep concise and natural',
    '- Avoid literal awkward wording',
    '- Keep consistent naming style',
    genderRule,
    '- If "*in" is unnatural for a role, use a neutral alternative (e.g. "Leitung", "Fachkraft", "Teamleitung").',
    '- Do NOT use masculine-only forms without inclusive wording',
    '',
    'Return JSON object with key "items":',
    '{ "items": [ { "unit_id": "...", "career_path_id": "...", "de": "...", "alt_titles_de": ["..."], "hidden_titles_de": ["..."] } ] }',
    '- "unit_id" must be copied from input exactly.',
    '- "alt_titles_de" must translate each input alt title in the same order.',
    '- "hidden_titles_de" must translate each input hidden title in the same order.',
    '- If an input list is empty, return an empty list for that field.',
    '',
    `Input:\n${JSON.stringify(batch.map((b) => ({
      career_path_id: b.career_path_id,
      unit_id: b.unit_id,
      en: b.en,
      alt_titles_en: Array.isArray(b.alt_titles_en) ? b.alt_titles_en : [],
      hidden_titles_en: Array.isArray(b.hidden_titles_en) ? b.hidden_titles_en : [],
    })), null, 2)}`,
  ].join('\n');
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const batchSize = Number.parseInt(String(args.batch || '30'), 10);
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  const resume = !Boolean(args.reset);
  const genderStyle = String(args.genderStyle || 'neutral').toLowerCase();
  const aliasChunkSize = Math.max(1, Number.parseInt(String(args.aliasChunk || DEFAULT_ALIAS_CHUNK_SIZE), 10));

  if (!fs.existsSync(BAD_ROLE_TITLES_PATH)) {
    throw new Error(`Missing input file: ${BAD_ROLE_TITLES_PATH}. Run roles:find-bad-titles first.`);
  }
  let bad = JSON.parse(fs.readFileSync(BAD_ROLE_TITLES_PATH, 'utf8'));
  if (!Array.isArray(bad)) bad = [];
  if (Number.isFinite(limit) && limit > 0) bad = bad.slice(0, limit);

  const suggestionById = new Map();
  const aliasSuggestionById = new Map();
  if (resume && fs.existsSync(ROLE_TITLE_SUGGESTIONS_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(ROLE_TITLE_SUGGESTIONS_PATH, 'utf8'));
      for (const row of Array.isArray(existing) ? existing : []) {
        const id = normalizeLabel(row?.career_path_id);
        const suggested = normalizeLabel(row?.suggested_de);
        if (id && suggested) suggestionById.set(id, suggested);
        if (id) {
          aliasSuggestionById.set(id, {
            alt_titles_de: normalizeTranslationList(row?.suggested_alt_titles_de),
            hidden_titles_de: normalizeTranslationList(row?.suggested_hidden_titles_de),
          });
        }
      }
    } catch (_) {
      // ignore
    }
  }

  await connectDB();
  const cpIds = bad.map((b) => b.career_path_id).filter(Boolean);
  const docs = await CareerPath.find({ _id: { $in: cpIds } }, { _id: 1, altTitles: 1, hiddenTitles: 1 }).lean();
  const aliasById = new Map(
    docs.map((d) => [
      String(d._id),
      {
        alt_titles_en: Array.isArray(d.altTitles) ? d.altTitles.map((t) => normalizeLabel(t)).filter(Boolean) : [],
        hidden_titles_en: Array.isArray(d.hiddenTitles) ? d.hiddenTitles.map((t) => normalizeLabel(t)).filter(Boolean) : [],
      },
    ]),
  );

  const badWithAliases = bad.map((entry) => {
    const aliases = aliasById.get(entry.career_path_id) || { alt_titles_en: [], hidden_titles_en: [] };
    return {
      ...entry,
      alt_titles_en: aliases.alt_titles_en,
      hidden_titles_en: aliases.hidden_titles_en,
    };
  });

  const pending = badWithAliases.filter((entry) => !isRoleResolved(entry, suggestionById, aliasSuggestionById));
  const workUnits = buildWorkUnits(pending, aliasChunkSize);
  const batches = batchArray(workUnits, Math.max(1, batchSize));
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    console.log(`[generateRoleTitleSuggestions] batch ${i + 1}/${batches.length} size=${batch.length}`);
    const resultByUnit = await requestBatchWithFallback(batch, genderStyle);
    mergeBatchResults(batch, resultByUnit, suggestionById, aliasSuggestionById);

    const checkpoint = badWithAliases.map((entry) => ({
      career_path_id: entry.career_path_id,
      esco_id: entry.esco_id,
      en: normalizeLabel(entry.en),
      current_de: normalizeLabel(entry.de),
      suggested_de: normalizeLabel(suggestionById.get(entry.career_path_id) || ''),
      alt_titles_en: entry.alt_titles_en,
      hidden_titles_en: entry.hidden_titles_en,
      suggested_alt_titles_de: translationListWithFallback(entry.alt_titles_en, aliasSuggestionById.get(entry.career_path_id)?.alt_titles_de),
      suggested_hidden_titles_de: translationListWithFallback(entry.hidden_titles_en, aliasSuggestionById.get(entry.career_path_id)?.hidden_titles_de),
    }));
    ensureTmpDir();
    fs.writeFileSync(ROLE_TITLE_SUGGESTIONS_PATH, JSON.stringify(checkpoint, null, 2), 'utf8');
    const resolvedCount = badWithAliases.filter((entry) => isRoleResolved(entry, suggestionById, aliasSuggestionById)).length;
    console.log(`[generateRoleTitleSuggestions] resolved=${resolvedCount}/${badWithAliases.length}`);
  }

  const output = badWithAliases.map((entry) => ({
    career_path_id: entry.career_path_id,
    esco_id: entry.esco_id,
    en: normalizeLabel(entry.en),
    current_de: normalizeLabel(entry.de),
    suggested_de: normalizeLabel(suggestionById.get(entry.career_path_id) || ''),
    alt_titles_en: entry.alt_titles_en,
    hidden_titles_en: entry.hidden_titles_en,
    suggested_alt_titles_de: finalizeTranslationList(entry.alt_titles_en, aliasSuggestionById.get(entry.career_path_id)?.alt_titles_de),
    suggested_hidden_titles_de: finalizeTranslationList(entry.hidden_titles_en, aliasSuggestionById.get(entry.career_path_id)?.hidden_titles_de),
  }));
  ensureTmpDir();
  fs.writeFileSync(ROLE_TITLE_SUGGESTIONS_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[generateRoleTitleSuggestions] suggestions=${output.length}`);
  console.log(`[generateRoleTitleSuggestions] output=${ROLE_TITLE_SUGGESTIONS_PATH}`);
  await mongoose.connection.close();
}

async function requestBatchWithStyle(batch, genderStyle) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Return valid JSON only.' },
            { role: 'user', content: buildPrompt(batch, genderStyle) },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`OpenAI error ${res.status}: ${body}`);
      }
      const payload = await res.json();
      const content = payload?.choices?.[0]?.message?.content || '{}';
      let parsed = null;
      try {
        parsed = JSON.parse(content);
      } catch (parseErr) {
        const err = new Error(`MODEL_JSON_PARSE_ERROR: ${parseErr.message}`);
        err.cause = parseErr;
        throw err;
      }
      const resultByUnit = new Map();
      for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
        const unitId = normalizeLabel(item?.unit_id || item?.unitId);
        const id = normalizeLabel(
          item?.career_path_id ||
          item?.careerPathId ||
          item?.role_id ||
          item?.id ||
          item?.key
        );
        const de = normalizeLabel(item?.de);
        if (!unitId) continue;
        resultByUnit.set(unitId, {
          career_path_id: id,
          de,
          alt_titles_de: normalizeTranslationList(item?.alt_titles_de),
          hidden_titles_de: normalizeTranslationList(item?.hidden_titles_de),
        });
      }
      return resultByUnit;
    } catch (err) {
      lastErr = err;
      const retriable = String(err?.message || '').includes('ECONNRESET')
        || String(err?.message || '').includes('fetch failed')
        || String(err?.message || '').includes('429')
        || String(err?.message || '').includes('5');
      if (!retriable || attempt === MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(15000, 500 * (2 ** (attempt - 1)))));
    }
  }
  throw lastErr || new Error('Failed to request role title suggestions');
}

async function requestBatchWithFallback(batch, genderStyle) {
  try {
    return await requestBatchWithStyle(batch, genderStyle);
  } catch (err) {
    const msg = String(err?.message || '');
    if (!msg.includes('MODEL_JSON_PARSE_ERROR') || batch.length <= 1) {
      throw err;
    }

    console.warn(`[generateRoleTitleSuggestions] batch JSON parse failed; retrying ${batch.length} unit(s) individually`);
    const merged = new Map();
    for (const unit of batch) {
      const one = await requestBatchWithStyle([unit], genderStyle);
      for (const [k, v] of one.entries()) merged.set(k, v);
    }
    return merged;
  }
}

function normalizeTranslationList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => normalizeLabel(v)).filter(Boolean);
}

function translationListWithFallback(sourceList, translatedList) {
  const source = Array.isArray(sourceList) ? sourceList : [];
  const translated = Array.isArray(translatedList) ? translatedList : [];
  return finalizeTranslationList(source, translated);
}

function isRoleResolved(entry, suggestionById, aliasSuggestionById) {
  const id = entry.career_path_id;
  const titleResolved = Boolean(normalizeLabel(suggestionById.get(id) || ''));
  if (!titleResolved) return false;

  const aliasState = aliasSuggestionById.get(id) || {};
  const altResolved = hasCompleteTranslation(entry.alt_titles_en, aliasState.alt_titles_de);
  const hiddenResolved = hasCompleteTranslation(entry.hidden_titles_en, aliasState.hidden_titles_de);
  return altResolved && hiddenResolved;
}

function hasCompleteTranslation(sourceList, translatedList) {
  const source = Array.isArray(sourceList) ? sourceList : [];
  if (source.length === 0) return true;
  const translated = Array.isArray(translatedList) ? translatedList : [];
  if (translated.length !== source.length) return false;
  const normSource = source.map((item) => normalizeLabel(item));
  const normTranslated = translated.map((item) => normalizeLabel(item));
  if (!normTranslated.every(Boolean)) return false;
  // Detect fallback bug pattern: EN list copied straight into DE list.
  if (normSource.length >= 5 && arraysEqualIgnoreCase(normSource, normTranslated)) return false;
  return true;
}

function chunkWithOffset(items, size) {
  const source = Array.isArray(items) ? items : [];
  if (source.length === 0) return [{ start: 0, items: [] }];
  const chunks = [];
  for (let i = 0; i < source.length; i += size) {
    chunks.push({ start: i, items: source.slice(i, i + size) });
  }
  return chunks;
}

function buildWorkUnits(entries, aliasChunkSize) {
  const units = [];
  for (const entry of entries) {
    const altChunks = chunkWithOffset(entry.alt_titles_en, aliasChunkSize);
    const hiddenChunks = chunkWithOffset(entry.hidden_titles_en, aliasChunkSize);
    const chunkCount = Math.max(altChunks.length, hiddenChunks.length, 1);
    for (let idx = 0; idx < chunkCount; idx += 1) {
      const altChunk = altChunks[idx] || { start: 0, items: [] };
      const hiddenChunk = hiddenChunks[idx] || { start: 0, items: [] };
      units.push({
        unit_id: `${entry.career_path_id}::${idx}`,
        career_path_id: entry.career_path_id,
        en: entry.en,
        alt_titles_en: altChunk.items,
        hidden_titles_en: hiddenChunk.items,
        alt_start: altChunk.start,
        hidden_start: hiddenChunk.start,
      });
    }
  }
  return units;
}

function mergeBatchResults(batch, resultByUnit, suggestionById, aliasSuggestionById) {
  for (const unit of batch) {
    const result = resultByUnit.get(unit.unit_id);
    if (!result) continue;

    const roleId = unit.career_path_id;
    const suggestedTitle = normalizeLabel(result.de);
    if (suggestedTitle) suggestionById.set(roleId, suggestedTitle);

    const current = aliasSuggestionById.get(roleId) || { alt_titles_de: [], hidden_titles_de: [] };
    const nextAlt = current.alt_titles_de.slice();
    const nextHidden = current.hidden_titles_de.slice();
    mergeChunk(nextAlt, unit.alt_start, unit.alt_titles_en, result.alt_titles_de);
    mergeChunk(nextHidden, unit.hidden_start, unit.hidden_titles_en, result.hidden_titles_de);
    aliasSuggestionById.set(roleId, {
      alt_titles_de: nextAlt,
      hidden_titles_de: nextHidden,
    });
  }
}

function mergeChunk(targetList, start, sourceChunk, translatedChunk) {
  const source = Array.isArray(sourceChunk) ? sourceChunk : [];
  if (source.length === 0) return;
  const translated = Array.isArray(translatedChunk) ? translatedChunk : [];
  for (let i = 0; i < source.length; i += 1) {
    const value = normalizeLabel(translated[i]);
    if (value) targetList[start + i] = value;
  }
}

function finalizeTranslationList(sourceList, translatedList) {
  const source = Array.isArray(sourceList) ? sourceList : [];
  if (source.length === 0) return [];
  const translated = Array.isArray(translatedList) ? translatedList : [];
  if (translated.length !== source.length) return [];
  const normalized = translated.map((item) => normalizeLabel(item));
  if (!normalized.every(Boolean)) return [];
  return normalized;
}

function arraysEqualIgnoreCase(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (String(a[i] || '').toLowerCase() !== String(b[i] || '').toLowerCase()) return false;
  }
  return true;
}

run().catch((err) => {
  console.error('[generateRoleTitleSuggestions] failed:', err);
  process.exit(1);
});
