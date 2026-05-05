#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const {
  BAD_SKILLS_PATH,
  SUGGESTIONS_PATH,
  ensureTmpDir,
  normalizeLabel,
  batchArray,
  parseArgs,
} = require('./lib/skillTranslationPipeline');

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_RETRIES = 5;

function buildPrompt(batch) {
  return [
    'You are an expert in professional German business language.',
    '',
    'Translate the following skills into German.',
    '',
    'Rules:',
    '- Use commonly accepted terms in the German job market',
    '- Be concise (1-3 words max)',
    '- Avoid literal translations if unnatural',
    '- Prefer terminology used in job descriptions',
    '- Be consistent across all outputs',
    '',
    'Context:',
    'These are skills used in career profiles and job descriptions.',
    '',
    'Return JSON object with key "items":',
    '{ "items": [ { "key": "...", "de": "..." } ] }',
    '',
    `Input:\n${JSON.stringify(batch.map((b) => ({ key: b.key, en: b.en })), null, 2)}`,
  ].join('\n');
}

async function requestBatchSuggestions(batch) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required to generate AI suggestions');
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Return valid JSON only.' },
            { role: 'user', content: buildPrompt(batch) },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`OpenAI error ${res.status}: ${body}`);
      }

      const payload = await res.json();
      const content = payload?.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      const map = new Map();
      for (const item of items) {
        const key = normalizeLabel(item?.key);
        const de = normalizeLabel(item?.de);
        if (!key || !de) continue;
        map.set(key, de);
      }
      return map;
    } catch (err) {
      lastErr = err;
      const delayMs = Math.min(15000, 500 * (2 ** (attempt - 1)));
      const retriable =
        String(err?.message || '').includes('ECONNRESET') ||
        String(err?.message || '').includes('fetch failed') ||
        String(err?.message || '').includes('429') ||
        String(err?.message || '').includes('5');
      if (!retriable || attempt === MAX_RETRIES) break;
      console.warn(`[generateSkillSuggestions] retry ${attempt}/${MAX_RETRIES} after error: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr || new Error('Failed to request batch suggestions');
}

function fallbackSuggestion(entry) {
  const en = normalizeLabel(entry.en);
  return en ? `[DE] ${en}` : '';
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const batchSize = Number.parseInt(String(args.batch || '30'), 10);
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  const resume = !Boolean(args.reset);

  if (!fs.existsSync(BAD_SKILLS_PATH)) {
    throw new Error(`Missing input file: ${BAD_SKILLS_PATH}. Run skills:find-bad first.`);
  }

  const raw = JSON.parse(fs.readFileSync(BAD_SKILLS_PATH, 'utf8'));
  let badSkills = Array.isArray(raw) ? raw : [];
  if (Number.isFinite(limit) && limit > 0) {
    badSkills = badSkills.slice(0, limit);
  }

  const suggestionByKey = new Map();

  if (resume && fs.existsSync(SUGGESTIONS_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(SUGGESTIONS_PATH, 'utf8'));
      for (const row of Array.isArray(existing) ? existing : []) {
        const key = normalizeLabel(row?.key);
        const suggested = normalizeLabel(row?.suggested_de);
        if (key && suggested) suggestionByKey.set(key, suggested);
      }
      console.log(`[generateSkillSuggestions] resuming with ${suggestionByKey.size} existing suggestions`);
    } catch (_) {
      // Ignore parse errors and continue from scratch.
    }
  }

  const pending = badSkills.filter((entry) => !suggestionByKey.has(entry.key));
  const batches = batchArray(pending, Math.max(1, batchSize));
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    console.log(`[generateSkillSuggestions] batch ${i + 1}/${batches.length} size=${batch.length}`);
    const map = await requestBatchSuggestions(batch);
    for (const [k, v] of map.entries()) suggestionByKey.set(k, v);

    // Checkpoint after each batch so long runs can resume safely.
    const checkpoint = badSkills.map((entry) => ({
      skill_id: entry.skill_id,
      key: entry.key,
      en: normalizeLabel(entry.en),
      current_de: normalizeLabel(entry.de),
      suggested_de: normalizeLabel(suggestionByKey.get(entry.key) || ''),
    }));
    ensureTmpDir();
    fs.writeFileSync(SUGGESTIONS_PATH, JSON.stringify(checkpoint, null, 2), 'utf8');
  }

  const output = badSkills.map((entry) => ({
    skill_id: entry.skill_id,
    key: entry.key,
    en: normalizeLabel(entry.en),
    current_de: normalizeLabel(entry.de),
    suggested_de: normalizeLabel(suggestionByKey.get(entry.key) || fallbackSuggestion(entry)),
  }));

  ensureTmpDir();
  fs.writeFileSync(SUGGESTIONS_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[generateSkillSuggestions] suggestions=${output.length}`);
  console.log(`[generateSkillSuggestions] output=${SUGGESTIONS_PATH}`);
}

run().catch((err) => {
  console.error('[generateSkillSuggestions] failed:', err);
  process.exit(1);
});
