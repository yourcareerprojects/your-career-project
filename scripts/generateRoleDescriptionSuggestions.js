#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const {
  BAD_ROLE_DESCRIPTIONS_PATH,
  ROLE_DESCRIPTION_SUGGESTIONS_PATH,
  ensureTmpDir,
  normalizeDescriptionBody,
  normalizeLabel,
  batchArray,
  parseArgs,
} = require('./lib/skillTranslationPipeline');

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_RETRIES = 5;

function buildPrompt(batch) {
  return [
    'You are an expert in professional German business language and ESCO-style occupation texts.',
    '',
    'Translate each English role description into natural German for career and job-matching UIs.',
    '',
    'Rules:',
    '- Preserve structure: same number of paragraphs / line breaks as far as the English source implies',
    '- Use clear, professional wording suitable for job descriptions and career exploration',
    '- Keep terminology consistent with the German job market',
    '- Use gender-inclusive wording (e.g. star form *in / *innen where a person noun is needed)',
    '- Do not add facts or remove content; stay faithful in meaning and scope',
    '- Avoid placeholders, meta-commentary, or English left untranslated',
    '',
    'Return JSON object with key "items":',
    '{ "items": [ { "career_path_id": "...", "de": "..." } ] }',
    '- "career_path_id" must match input exactly.',
    '',
    `Input:\n${JSON.stringify(batch.map((b) => ({
      career_path_id: b.career_path_id,
      role_title_en: b.role_title_en,
      en: b.en,
    })), null, 2)}`,
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
        const id = normalizeLabel(item?.career_path_id || item?.careerPathId || item?.id);
        const de = typeof item?.de === 'string' ? item.de.replace(/\r\n/g, '\n').trim() : '';
        if (!id || !de) continue;
        map.set(id, de);
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
      console.warn(`[generateRoleDescriptionSuggestions] retry ${attempt}/${MAX_RETRIES} after error: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr || new Error('Failed to request batch suggestions');
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const batchSize = Number.parseInt(String(args.batch || '8'), 10);
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  const resume = !Boolean(args.reset);

  if (!fs.existsSync(BAD_ROLE_DESCRIPTIONS_PATH)) {
    throw new Error(
      `Missing input file: ${BAD_ROLE_DESCRIPTIONS_PATH}. Run roles:find-bad-descriptions first.`,
    );
  }

  const raw = JSON.parse(fs.readFileSync(BAD_ROLE_DESCRIPTIONS_PATH, 'utf8'));
  let bad = Array.isArray(raw) ? raw : [];
  if (Number.isFinite(limit) && limit > 0) {
    bad = bad.slice(0, limit);
  }

  const suggestionById = new Map();

  if (resume && fs.existsSync(ROLE_DESCRIPTION_SUGGESTIONS_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(ROLE_DESCRIPTION_SUGGESTIONS_PATH, 'utf8'));
      for (const row of Array.isArray(existing) ? existing : []) {
        const id = normalizeLabel(row?.career_path_id);
        const suggested = typeof row?.suggested_de === 'string' ? row.suggested_de.replace(/\r\n/g, '\n').trim() : '';
        if (id && suggested) suggestionById.set(id, suggested);
      }
      console.log(`[generateRoleDescriptionSuggestions] resuming with ${suggestionById.size} existing suggestions`);
    } catch (_) {
      // Ignore parse errors and continue from scratch.
    }
  }

  const pending = bad.filter((entry) => !suggestionById.has(entry.career_path_id));
  const batches = batchArray(pending, Math.max(1, batchSize));
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    console.log(`[generateRoleDescriptionSuggestions] batch ${i + 1}/${batches.length} size=${batch.length}`);
    const map = await requestBatchSuggestions(batch);
    for (const [k, v] of map.entries()) suggestionById.set(k, v);

    const checkpoint = bad.map((entry) => ({
      career_path_id: entry.career_path_id,
      esco_id: normalizeLabel(entry.esco_id),
      role_title_en: normalizeLabel(entry.role_title_en),
      en: normalizeDescriptionBody(entry.en),
      current_de: normalizeDescriptionBody(entry.de),
      suggested_de: suggestionById.get(entry.career_path_id) || '',
    }));
    ensureTmpDir();
    fs.writeFileSync(ROLE_DESCRIPTION_SUGGESTIONS_PATH, JSON.stringify(checkpoint, null, 2), 'utf8');
  }

  const output = bad.map((entry) => ({
    career_path_id: entry.career_path_id,
    esco_id: normalizeLabel(entry.esco_id),
    role_title_en: normalizeLabel(entry.role_title_en),
    en: normalizeDescriptionBody(entry.en),
    current_de: normalizeDescriptionBody(entry.de),
    suggested_de: normalizeDescriptionBody(suggestionById.get(entry.career_path_id) || ''),
  }));

  ensureTmpDir();
  fs.writeFileSync(ROLE_DESCRIPTION_SUGGESTIONS_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[generateRoleDescriptionSuggestions] suggestions=${output.length}`);
  console.log(`[generateRoleDescriptionSuggestions] output=${ROLE_DESCRIPTION_SUGGESTIONS_PATH}`);
}

run().catch((err) => {
  console.error('[generateRoleDescriptionSuggestions] failed:', err);
  process.exit(1);
});
