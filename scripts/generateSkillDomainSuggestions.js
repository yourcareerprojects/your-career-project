#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const {
  BAD_SKILL_DOMAINS_PATH,
  SKILL_DOMAIN_SUGGESTIONS_PATH,
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
    'Translate the following skill domains into German.',
    '',
    'Rules:',
    '- Use commonly accepted terms in the German job market',
    '- Be concise (1-4 words max)',
    '- Prefer terminology used in job descriptions',
    '- Keep consistent vocabulary across outputs',
    '',
    'Return JSON object with key "items":',
    '{ "items": [ { "key": "...", "de": "..." } ] }',
    '',
    `Input:\n${JSON.stringify(batch.map((b) => ({ key: b.domain_key, en: b.en })), null, 2)}`,
  ].join('\n');
}

async function requestBatch(batch) {
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
      const map = new Map();
      for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
        const key = normalizeLabel(item?.key);
        const de = normalizeLabel(item?.de);
        if (key && de) map.set(key, de);
      }
      return map;
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
  throw lastErr || new Error('Failed to request domain suggestions');
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const batchSize = Number.parseInt(String(args.batch || '30'), 10);
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  const resume = !Boolean(args.reset);

  if (!fs.existsSync(BAD_SKILL_DOMAINS_PATH)) {
    throw new Error(`Missing input file: ${BAD_SKILL_DOMAINS_PATH}. Run skills-domains:find-bad first.`);
  }
  let bad = JSON.parse(fs.readFileSync(BAD_SKILL_DOMAINS_PATH, 'utf8'));
  if (!Array.isArray(bad)) bad = [];
  if (Number.isFinite(limit) && limit > 0) bad = bad.slice(0, limit);

  const suggestionByKey = new Map();
  if (resume && fs.existsSync(SKILL_DOMAIN_SUGGESTIONS_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(SKILL_DOMAIN_SUGGESTIONS_PATH, 'utf8'));
      for (const row of Array.isArray(existing) ? existing : []) {
        const key = normalizeLabel(row?.domain_key);
        const suggested = normalizeLabel(row?.suggested_de);
        if (key && suggested) suggestionByKey.set(key, suggested);
      }
    } catch (_) {
      // ignore
    }
  }

  const pending = bad.filter((b) => !suggestionByKey.has(b.domain_key));
  const batches = batchArray(pending, Math.max(1, batchSize));
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    console.log(`[generateSkillDomainSuggestions] batch ${i + 1}/${batches.length} size=${batch.length}`);
    const map = await requestBatch(batch);
    for (const [k, v] of map.entries()) suggestionByKey.set(k, v);

    const checkpoint = bad.map((entry) => ({
      domain_key: entry.domain_key,
      en: normalizeLabel(entry.en),
      current_de: normalizeLabel(entry.de),
      suggested_de: normalizeLabel(suggestionByKey.get(entry.domain_key) || ''),
    }));
    ensureTmpDir();
    fs.writeFileSync(SKILL_DOMAIN_SUGGESTIONS_PATH, JSON.stringify(checkpoint, null, 2), 'utf8');
  }

  const output = bad.map((entry) => ({
    domain_key: entry.domain_key,
    en: normalizeLabel(entry.en),
    current_de: normalizeLabel(entry.de),
    suggested_de: normalizeLabel(suggestionByKey.get(entry.domain_key) || `[DE] ${normalizeLabel(entry.en)}`),
  }));
  ensureTmpDir();
  fs.writeFileSync(SKILL_DOMAIN_SUGGESTIONS_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[generateSkillDomainSuggestions] suggestions=${output.length}`);
  console.log(`[generateSkillDomainSuggestions] output=${SKILL_DOMAIN_SUGGESTIONS_PATH}`);
}

run().catch((err) => {
  console.error('[generateSkillDomainSuggestions] failed:', err);
  process.exit(1);
});
