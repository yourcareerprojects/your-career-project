#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const {
  BAD_ROLE_RESPONSIBILITIES_PATH,
  ROLE_RESPONSIBILITY_SUGGESTIONS_PATH,
  ensureTmpDir,
  normalizeLabel,
  batchArray,
  parseArgs,
} = require('./lib/skillTranslationPipeline');

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_RETRIES = 5;

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => normalizeLabel(item)).filter(Boolean);
}

function getResponsibilityStyle(value) {
  const normalized = String(value || 'infinitive').trim().toLowerCase();
  if (normalized === 'sie') return 'sie';
  return 'infinitive';
}

function buildStyleRule(style) {
  if (style === 'sie') {
    return [
      '- Use "Sie ..." phrasing for every responsibility (third-person plural, not polite address)',
      '- Start every responsibility exactly with "Sie "',
      '- Keep the same "Sie ..."-style consistently across all items',
    ];
  }
  return [
    '- Use infinitive-led phrasing for every responsibility (examples: "Analysieren ...", "Koordinieren ...", "Sicherstellen ...")',
    '- Do not start responsibilities with "Sie "',
    '- Keep the same infinitive style consistently across all items',
  ];
}

function buildPrompt(batch, style) {
  return [
    'You are an expert in professional German localization for role responsibilities.',
    '',
    'Translate each English key responsibility into natural, concise, professional German.',
    '',
    'Rules:',
    '- Keep the meaning faithful to the original sentence',
    '- Keep action-oriented phrasing suitable for job descriptions',
    '- Use gender-inclusive German wording',
    '- Prefer neutral wording without gendered person nouns where possible',
    '- If a person noun is necessary, use star form: singular "*in", plural "*innen" (examples: "Mitarbeiter*in", "Mitarbeiter*innen")',
    '- Never use masculine-only forms',
    ...buildStyleRule(style),
    '- Preserve list length and order exactly',
    '- Do not add or remove items',
    '- Avoid placeholders and literal awkward wording',
    '',
    'Return JSON object with key "items":',
    '{ "items": [ { "career_path_id": "...", "responsibilities_de": ["..."] } ] }',
    '- "career_path_id" must match input exactly.',
    '- "responsibilities_de" must have the same number of items as "responsibilities_en" in the same order.',
    '',
    `Input:\n${JSON.stringify(batch.map((b) => ({
      career_path_id: b.career_path_id,
      role_title_en: b.role_title_en,
      responsibilities_en: b.responsibilities_en,
    })), null, 2)}`,
  ].join('\n');
}

async function requestBatchSuggestions(batch, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required to generate AI suggestions');

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
            { role: 'user', content: buildPrompt(batch, style) },
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
        const list = normalizeList(item?.responsibilities_de);
        if (!id || list.length === 0) continue;
        map.set(id, list);
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
      console.warn(`[generateRoleResponsibilitySuggestions] retry ${attempt}/${MAX_RETRIES} after error: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr || new Error('Failed to request batch suggestions');
}

function hasCompleteSuggestion(entry, suggestedList) {
  const source = normalizeList(entry?.responsibilities_en);
  const translated = normalizeList(suggestedList);
  if (source.length === 0) return true;
  if (translated.length !== source.length) return false;
  return translated.every(Boolean);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const batchSize = Number.parseInt(String(args.batch || '20'), 10);
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  const resume = !Boolean(args.reset);
  const style = getResponsibilityStyle(args.style);

  if (!fs.existsSync(BAD_ROLE_RESPONSIBILITIES_PATH)) {
    throw new Error(
      `Missing input file: ${BAD_ROLE_RESPONSIBILITIES_PATH}. Run responsibilities:find-bad first.`
    );
  }

  let entries = JSON.parse(fs.readFileSync(BAD_ROLE_RESPONSIBILITIES_PATH, 'utf8'));
  if (!Array.isArray(entries)) entries = [];
  if (Number.isFinite(limit) && limit > 0) entries = entries.slice(0, limit);
  entries = entries.map((entry) => ({
    ...entry,
    responsibilities_en: normalizeList(entry?.responsibilities_en),
    responsibilities_de: normalizeList(entry?.responsibilities_de),
  }));

  const suggestionById = new Map();
  if (resume && fs.existsSync(ROLE_RESPONSIBILITY_SUGGESTIONS_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(ROLE_RESPONSIBILITY_SUGGESTIONS_PATH, 'utf8'));
      for (const row of Array.isArray(existing) ? existing : []) {
        const id = normalizeLabel(row?.career_path_id);
        const suggested = normalizeList(row?.suggested_responsibilities_de);
        if (id && suggested.length > 0) suggestionById.set(id, suggested);
      }
      console.log(
        `[generateRoleResponsibilitySuggestions] resuming with ${suggestionById.size} existing suggestions`
      );
    } catch (_) {
      // Ignore parse errors and continue from scratch.
    }
  }

  const pending = entries.filter((entry) => !hasCompleteSuggestion(entry, suggestionById.get(entry.career_path_id)));
  const batches = batchArray(pending, Math.max(1, batchSize));
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    console.log(
      `[generateRoleResponsibilitySuggestions] batch ${i + 1}/${batches.length} size=${batch.length} style=${style}`
    );
    const map = await requestBatchSuggestions(batch, style);
    for (const [id, suggestedList] of map.entries()) suggestionById.set(id, suggestedList);

    const checkpoint = entries.map((entry) => ({
      career_path_id: entry.career_path_id,
      esco_id: entry.esco_id,
      role_title_en: entry.role_title_en,
      responsibilities_en: entry.responsibilities_en,
      current_responsibilities_de: entry.responsibilities_de,
      suggested_responsibilities_de: normalizeList(suggestionById.get(entry.career_path_id)),
    }));
    ensureTmpDir();
    fs.writeFileSync(ROLE_RESPONSIBILITY_SUGGESTIONS_PATH, JSON.stringify(checkpoint, null, 2), 'utf8');
  }

  const output = entries.map((entry) => ({
    career_path_id: entry.career_path_id,
    esco_id: entry.esco_id,
    role_title_en: entry.role_title_en,
    responsibilities_en: entry.responsibilities_en,
    current_responsibilities_de: entry.responsibilities_de,
    suggested_responsibilities_de: normalizeList(suggestionById.get(entry.career_path_id)),
  }));
  ensureTmpDir();
  fs.writeFileSync(ROLE_RESPONSIBILITY_SUGGESTIONS_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[generateRoleResponsibilitySuggestions] suggestions=${output.length}`);
  console.log(`[generateRoleResponsibilitySuggestions] output=${ROLE_RESPONSIBILITY_SUGGESTIONS_PATH}`);
}

run().catch((err) => {
  console.error('[generateRoleResponsibilitySuggestions] failed:', err);
  process.exit(1);
});
