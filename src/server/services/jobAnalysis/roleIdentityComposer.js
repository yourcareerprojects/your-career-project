/**
 * Role Identity Composer
 *
 * Generates a structured "Role Identity Text" from a CareerPath document's
 * fields.  The text is designed to be embedded into a dense vector for
 * semantic similarity matching, recommendation ranking, and explainable AI.
 *
 * Two methods are available:
 *
 *   1. **deterministic** — Algorithmically composes the text from
 *      structured fields using a fixed template with controlled semantic
 *      weighting.  Fast, free, and perfectly reproducible.
 *
 *   2. **llm** — Sends the fields to an LLM with the generateRoleIdentityText
 *      prompt template for a more fluent, context-aware paragraph.
 *
 * Both methods follow the same semantic weighting constraints:
 *   - Skill domains and key responsibilities carry the strongest influence.
 *   - Required skills are normalized and integrated naturally.
 *   - Titles are mentioned briefly (not dominant).
 *   - Optional skills have the lowest emphasis.
 *   - Seniority is excluded entirely.
 *
 * @module services/jobAnalysis/roleIdentityComposer
 */

const crypto = require('crypto');
const { buildMessages } = require('../../prompts/generateRoleIdentityText');
const { getEnglishField, getEnglishDomainName } = require('../../utils/i18nFields');
const logger = require('../../utils/logger');
const {
  TIMEOUT_MS_LLM,
  normalizeExternalApiError,
  combineSignals,
} = require('../../utils/httpTimeouts');
const {
  recordOpenAiProviderMetrics,
  getCvPipeline,
} = require('../../utils/metricsLogger');

// ---------------------------------------------------------------------------
// OpenAI-compatible provider (shared pattern)
// ---------------------------------------------------------------------------

/**
 * Minimal OpenAI-compatible chat completion caller.
 * Uses the native `fetch` available in Node 18+.
 *
 * @param {{ role: string, content: string }[]} messages
 * @param {object} [opts]
 * @param {string} [opts.apiKey]      – Defaults to process.env.OPENAI_API_KEY
 * @param {string} [opts.baseUrl]     – Defaults to https://api.openai.com/v1
 * @param {string} [opts.model]       – Defaults to "gpt-4o-mini"
 * @param {number} [opts.temperature] – Defaults to 0.15 (low for stability)
 * @returns {Promise<string>} The assistant message content
 */
async function openaiProvider(messages, opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set.  Configure it in .env or pass a custom llmProvider.'
    );
  }

  const baseUrl = (opts.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = opts.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.15;
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs)
      ? opts.timeoutMs
      : TIMEOUT_MS_LLM;

  const started = Date.now();
  try {
    const signal = combineSignals(opts.signal, timeoutMs);

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages,
        response_format: { type: 'json_object' },
      }),
      signal,
    });

    const durationMs = Date.now() - started;

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const pipeCtx = getCvPipeline();
      logger.error('OpenAI chat completions HTTP error', {
        ...(pipeCtx ? { requestId: pipeCtx.requestId } : {}),
        status: res.status,
        durationMs,
        model,
        bodyPreview: body.slice(0, 400),
      });
      throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const content =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      '';

    if (!content) {
      const pipeCtx = getCvPipeline();
      logger.error('OpenAI chat completions empty content', {
        ...(pipeCtx ? { requestId: pipeCtx.requestId } : {}),
        durationMs,
        model,
      });
      throw new Error('Empty response from OpenAI API');
    }

    recordOpenAiProviderMetrics({
      provider: 'openai_compatible',
      model,
      durationMs,
      httpStatus: res.status,
      timedOut: false,
      retry: false,
      signalTimeoutMs: timeoutMs,
    });

    return content;
  } catch (err) {
    const durationMs = Date.now() - started;
    const norm = normalizeExternalApiError(err, { model, durationMs });
    const pipeCtx = getCvPipeline();
    logger.error('OpenAI chat completions request failed', {
      ...(pipeCtx ? { requestId: pipeCtx.requestId } : {}),
      ...norm,
    });
    recordOpenAiProviderMetrics({
      provider: 'openai_compatible',
      model,
      durationMs,
      httpStatus: norm.httpStatus,
      timedOut: Boolean(norm.isTimeout || norm.isAbort),
      retry: false,
      signalTimeoutMs: timeoutMs,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/**
 * Validate and normalise the raw LLM output into the expected schema.
 *
 * @param {string} raw – Raw text returned by the LLM (should be JSON)
 * @returns {{ role_identity_text: string }}
 * @throws {Error} If the output cannot be parsed or fails validation
 */
function validateExtraction(raw) {
  let cleaned = String(raw).trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`LLM output is not valid JSON: ${err.message}`);
  }

  if (!parsed.role_identity_text || typeof parsed.role_identity_text !== 'string') {
    throw new Error('Missing or invalid "role_identity_text" string');
  }

  let text = parsed.role_identity_text.trim();
  if (text.length < 50) {
    throw new Error(`Role identity text too short (${text.length} chars)`);
  }
  let words = countWords(text);
  if (words > 90) {
    // LLM occasionally overshoots by a few words; trim safely instead of failing the whole role.
    text = trimToWordCap(text, 90);
    words = countWords(text);
  }
  if (words < 35 || words > 90) {
    throw new Error(`Role identity text must be 35-90 words after normalization (got ${words})`);
  }

  return { role_identity_text: text };
}

// ---------------------------------------------------------------------------
// Input hash for change detection
// ---------------------------------------------------------------------------

/**
 * Merge ESCO altLabels and hiddenLabels title lists for the same uses as altTitles alone:
 * role identity text, embedding prompts, and change detection. Dedupes case-insensitively;
 * order preserved (altTitles first, then hiddenTitles).
 *
 * @param {object} doc – CareerPath-like { altTitles?, hiddenTitles? }
 * @returns {string[]}
 */
function mergeAltAndHiddenTitleAliases(doc) {
  const combined = [...(doc.altTitles || []), ...(doc.hiddenTitles || [])];
  const seen = new Set();
  const out = [];
  for (const t of combined) {
    const s = String(t || '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/**
 * Compute a deterministic hash of the input fields used to generate the
 * identity text.  Allows change detection without re-composing.
 *
 * @param {object} doc – A CareerPath document (or lean object)
 * @returns {string} 16-character hex hash
 */
function computeInputHash(doc) {
  const hashPayload = JSON.stringify({
    title: doc.title != null ? getEnglishField(doc.title) : '',
    altTitles: (doc.altTitles || []).slice().sort(),
    hiddenTitles: (doc.hiddenTitles || []).slice().sort(),
    description: doc.description != null ? getEnglishField(doc.description) : '',
  });

  return crypto.createHash('sha256').update(hashPayload).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Deterministic composer — utilities
// ---------------------------------------------------------------------------

/**
 * Stop words excluded from token-overlap comparisons so that shared
 * function words do not inflate similarity scores.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'not',
  'no', 'nor', 'so', 'if', 'then', 'than', 'that', 'this', 'these',
  'those', 'such', 'also', 'its', 'it', 'they', 'them', 'their',
]);

/**
 * Clean a single text item: trim whitespace, collapse runs, strip trailing
 * punctuation that would cause double-period artifacts when joined.
 */
function cleanItem(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.;,]+$/, '');
}

/**
 * Lowercase the first character of a string unless it looks like an
 * acronym (two consecutive uppercase letters).
 */
function lowercaseFirst(text) {
  if (!text) return '';
  if (text.length > 1 &&
      text[0] === text[0].toUpperCase() &&
      text[1] === text[1].toUpperCase() &&
      text[1] !== text[1].toLowerCase()) {
    return text; // leave acronyms like "IT", "QC", "HR" intact
  }
  return text[0].toLowerCase() + text.slice(1);
}

/**
 * Normalise a text string for deduplication comparison:
 * lowercase, strip non-alphanumeric, collapse whitespace.
 */
function normalizeForDedup(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenise text for deduplication.  Filters out stop words and tokens
 * shorter than 3 characters so that similarity is based on content words.
 */
function tokenizeForDedup(text) {
  return normalizeForDedup(text)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/**
 * Compute token overlap between two token arrays.
 * Returns intersection / min(|A|, |B|) so that a short phrase fully
 * contained in a longer one scores 1.0.
 */
function tokenOverlap(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setB = new Set(tokensB);
  const intersection = tokensA.filter((t) => setB.has(t)).length;
  return intersection / Math.min(tokensA.length, tokensB.length);
}

/**
 * Remove near-duplicates within a single array.
 * Keeps the first (longest) occurrence when two items overlap above
 * the threshold.
 *
 * @param {string[]} items
 * @param {number}   [threshold=0.75]
 * @returns {string[]}
 */
function deduplicateWithin(items, threshold = 0.75) {
  // Sort longest first so the more detailed variant survives
  const sorted = items
    .map((item) => ({ raw: item, cleaned: cleanItem(item) }))
    .filter((o) => o.cleaned.length > 0)
    .sort((a, b) => b.cleaned.length - a.cleaned.length);

  const kept = [];
  const keptTokens = [];

  for (const { raw, cleaned } of sorted) {
    const tokens = tokenizeForDedup(cleaned);
    const isDup = keptTokens.some((kt) => tokenOverlap(tokens, kt) >= threshold);
    if (!isDup) {
      kept.push(raw);
      keptTokens.push(tokens);
    }
  }

  return kept;
}

/**
 * Remove items from `items` that are near-duplicates of anything already
 * in `pool`.  Items in `pool` are never removed.
 *
 * @param {string[]} items
 * @param {string[]} pool
 * @param {number}   [threshold=0.75]
 * @returns {string[]}
 */
function deduplicateAgainst(items, pool, threshold = 0.75) {
  const poolTokens = pool.map((p) => tokenizeForDedup(cleanItem(p)));
  return items.filter((item) => {
    const tokens = tokenizeForDedup(cleanItem(item));
    return !poolTokens.some((pt) => tokenOverlap(tokens, pt) >= threshold);
  });
}

// ---------------------------------------------------------------------------
// Deterministic composer — High Precision utilities
// ---------------------------------------------------------------------------

/**
 * Join an array of text fragments in natural English ("a", "b", and "c").
 */
function joinNatural(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Count words in a text string.
 */
function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Extract the first N complete sentences from text.
 * Never truncates mid-sentence.
 *
 * @param {string} text
 * @param {number} [maxSentences=2]
 * @returns {string}
 */
function extractFirstSentences(text, maxSentences = 2) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  const rx = /[.!?](?:\s+|$)/g;
  const boundaries = [];
  let match;
  while ((match = rx.exec(clean)) !== null) {
    boundaries.push(match.index + 1);
  }

  if (boundaries.length === 0) return clean;
  const take = Math.min(maxSentences, boundaries.length);
  return clean.slice(0, boundaries[take - 1]).trim();
}

/**
 * Trim text to the last complete sentence that fits within a word cap.
 * Trims from the end, preserving sentence boundaries.
 *
 * @param {string} text
 * @param {number} maxWords
 * @returns {string}
 */
function trimToWordCap(text, maxWords) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');

  // Find last sentence boundary within maxWords
  let pos = maxWords;
  while (pos > maxWords * 0.3) {
    const w = words[pos - 1];
    if (w && /[.!?]$/.test(w)) {
      return words.slice(0, pos).join(' ');
    }
    pos--;
  }

  // Fallback: trim to word boundary
  return words.slice(0, maxWords).join(' ');
}

/**
 * Functional sentence templates for core domains. Each produces a different
 * structure to avoid repetition. Domain name appears once as context.
 */
const CORE_DOMAIN_TEMPLATES = [
  (domain, activities, leadIn) => `The role requires ${leadIn} ${activities} within ${domain.toLowerCase()}.`,
  (domain, activities, leadIn) => `Centred on ${domain.toLowerCase()}, the role demands ${leadIn} ${activities}.`,
  (domain, activities, leadIn) => `The role draws on ${leadIn} ${activities} across ${domain.toLowerCase()}.`,
];

/** Common verb stems for detecting verb-led activity items. */
const COMMON_VERBS = new Set([
  'coordinate', 'manage', 'implement', 'ensure', 'design', 'develop', 'operate',
  'conduct', 'perform', 'provide', 'maintain', 'monitor', 'create', 'analyse',
  'analyze', 'evaluate', 'assess', 'plan', 'organise', 'organize', 'support',
  'lead', 'oversee', 'handle', 'execute', 'deliver', 'report', 'communicate',
  'negotiate', 'adapt', 'adjust', 'resolve', 'remove', 'record', 'produce',
  'maximise', 'maximize', 'optimise', 'optimize', 'apply', 'install', 'test',
  'write', 'read', 'interpret', 'calibrate', 'troubleshoot', 'set', 'tend',
  'wear', 'study', 'assist', 'comply', 'follow', 'inspect', 'supervise', 'train',
  'coach', 'recruit', 'build', 'deploy', 'keep', 'make', 'ensure',
]);

function isVerbLed(item) {
  const first = String(item || '').trim().toLowerCase().split(/\s+/)[0] || '';
  return COMMON_VERBS.has(first);
}

/**
 * Convert activity items into a flowing phrase.
 * Uses "ability to" for verb-led items, "expertise in" for noun-led.
 */
function toVerbPhrase(items, maxItems = 4) {
  const take = items.slice(0, maxItems).map((t) => lowercaseFirst(cleanItem(t)));
  if (take.length === 0) return '';
  if (take.length === 1) return take[0];
  const phrase = take.length === 2
    ? `${take[0]} and ${take[1]}`
    : `${take.slice(0, -1).join(', ')}, and ${take[take.length - 1]}`;
  return phrase;
}

/** Return the appropriate lead-in for a phrase based on whether items are verb-led. */
function phraseLeadIn(items) {
  const verbLed = items.slice(0, 4).filter(isVerbLed);
  return verbLed.length >= items.slice(0, 4).length * 0.5
    ? 'the ability to'
    : 'expertise in';
}

// ---------------------------------------------------------------------------
// Deterministic composer — High Precision Identity Text (Version A)
// ---------------------------------------------------------------------------

const HP_WORD_TARGET = 280;
const HP_WORD_CAP = 350;
const HP_MAX_CORE_CLUSTERS = 3;
const HP_MAX_SECONDARY_CLUSTERS = 2;

/**
 * Deterministically compose a High-Precision Role Identity Text.
 *
 * Structure:
 *   Para 1: Functional essence (1–2 sentences from description)
 *   Para 2: Core competency clusters (max 3), functional sentences
 *   Para 3: Secondary domains (max 2), compressed
 *   Para 4: Condensed capability profile (domain-based, no long skill lists)
 *   Final:  Title + alternative titles (single compact mention)
 *   Optional: Supporting domains (brief)
 *
 * Target: 220–320 words. Hard cap: 350 words.
 * No "include", "encompasses", "further activities" patterns.
 *
 * @param {object} doc – A CareerPath document (or lean object)
 * @returns {{ role_identity_text: string, extraction_confidence: number }}
 */
function composeDeterministic(doc) {
  const paragraphs = [];
  let dataRichness = 0;

  // ── Extract and deduplicate ────────────────────────────────────────────

  const skillDomains = doc.skillDomains?.skill_domains || [];
  const coreDomains = skillDomains.filter((d) => d.importance === 'core');
  const importantDomains = skillDomains.filter((d) => d.importance === 'important');
  const supportingDomains = skillDomains.filter((d) => d.importance === 'supporting');
  const rawResponsibilities = doc.keyResponsibilities?.responsibilities || [];
  const rawCoreSkills = doc.skillModel?.core_skills || doc.requiredSkills || [];

  const usedPool = [];

  const coreDomainData = coreDomains.slice(0, HP_MAX_CORE_CLUSTERS).map((d) => {
    const items = deduplicateWithin(d.mapped_items || []);
    const dName = d.domain != null ? getEnglishDomainName(d.domain) : '';
    return { domain: dName, items };
  });
  for (const d of coreDomainData) usedPool.push(...d.items);

  const dedupedResponsibilities = deduplicateAgainst(
    deduplicateWithin(rawResponsibilities),
    usedPool,
  );
  usedPool.push(...dedupedResponsibilities);

  const importantDomainData = importantDomains.slice(0, HP_MAX_SECONDARY_CLUSTERS).map((d) => {
    const items = deduplicateAgainst(
      deduplicateWithin(d.mapped_items || []),
      usedPool,
    );
    const dName = d.domain != null ? getEnglishDomainName(d.domain) : '';
    return { domain: dName, items };
  });

  const dedupedCoreSkills = deduplicateAgainst(
    deduplicateWithin(rawCoreSkills),
    usedPool,
  );

  // ── Paragraph 1: Functional essence ────────────────────────────────────

  const descEn = doc.description != null ? getEnglishField(doc.description) : '';
  const titleEn = doc.title != null ? getEnglishField(doc.title) : '';
  const essence = extractFirstSentences(descEn, 2);
  if (essence) {
    paragraphs.push(essence);
    dataRichness += 1;
  } else if (titleEn && coreDomainData.length > 0) {
    const domainNames = coreDomainData.map((d) => d.domain.toLowerCase());
    paragraphs.push(
      `The ${titleEn} role operates at the intersection of ${joinNatural(domainNames)}.`,
    );
  } else if (titleEn) {
    paragraphs.push(`The ${titleEn} role.`);
  }

  // ── Paragraph 2: Core competency clusters (max 3, functional sentences) ─

  const coreActive = coreDomainData.filter((d) => d.items.length > 0);
  if (coreActive.length > 0) {
    const sentences = coreActive.map((d, i) => {
      const template = CORE_DOMAIN_TEMPLATES[i % CORE_DOMAIN_TEMPLATES.length];
      const phrase = toVerbPhrase(d.items, 3);
      const leadIn = phraseLeadIn(d.items);
      return template(d.domain, phrase, leadIn);
    });
    paragraphs.push(sentences.join(' '));
    dataRichness += 2;
  }

  // Integrate key responsibilities into core paragraph if not redundant
  if (dedupedResponsibilities.length > 0) {
    const respPhrase = dedupedResponsibilities.length <= 3
      ? toVerbPhrase(dedupedResponsibilities, 3)
      : toVerbPhrase(dedupedResponsibilities.slice(0, 3), 3);
    const dutyClause = dedupedResponsibilities.length <= 3
      ? `The role must be able to ${respPhrase}.`
      : `Primary duties involve being able to ${respPhrase}.`;
    if (paragraphs.length > 0) {
      paragraphs[paragraphs.length - 1] += ` ${dutyClause}`;
    } else {
      paragraphs.push(dutyClause);
    }
  }

  // ── Paragraph 3: Secondary domains (max 2, compressed) ─────────────────

  const secondaryActive = importantDomainData.filter((d) => d.items.length > 0);
  if (secondaryActive.length > 0) {
    const names = secondaryActive.map((d) => d.domain.toLowerCase());
    const allItems = secondaryActive.flatMap((d) => d.items).slice(0, 4);
    const phrase = toVerbPhrase(allItems, 4);
    const leadIn = phraseLeadIn(allItems);
    paragraphs.push(
      `The role also engages ${joinNatural(names)}, requiring ${leadIn} ${phrase}.`,
    );
    dataRichness += 1;
  }

  // ── Paragraph 4: Condensed capability profile ─────────────────────────
  // Domain names as capability areas; no long skill enumeration.

  const allDomainNames = [
    ...coreActive.map((d) => d.domain),
    ...secondaryActive.map((d) => d.domain),
  ];
  if (allDomainNames.length > 0 || dedupedCoreSkills.length > 0) {
    if (allDomainNames.length >= 2) {
      const capabilityPhrase = joinNatural(allDomainNames.slice(0, 4).map((n) => n.toLowerCase()));
      paragraphs.push(`Competencies span ${capabilityPhrase}.`);
    } else if (dedupedCoreSkills.length > 0) {
      const topSkills = dedupedCoreSkills.slice(0, 4);
      paragraphs.push(`The role draws on expertise in ${joinNatural(topSkills)}.`);
    }
    dataRichness += 1;
  }

  // ── Final: Title + alternative titles (alt + hidden ESCO labels) ─────

  if (titleEn) {
    const alts = mergeAltAndHiddenTitleAliases(doc).slice(0, 4);
    const titleSentence = alts.length > 0
      ? `Designated as ${titleEn}, also known as ${joinNatural(alts)}.`
      : `Designated as ${titleEn}.`;
    paragraphs.push(titleSentence);
  }

  // ── Optional: Supporting domains (brief) ────────────────────────────────

  if (supportingDomains.length > 0) {
    const names = supportingDomains
      .map((d) => (d.domain != null ? getEnglishDomainName(d.domain) : '').toLowerCase())
      .filter(Boolean)
      .slice(0, 4);
    paragraphs.push(`Supporting areas: ${joinNatural(names)}.`);
  }

  // ── Assemble and enforce word cap ──────────────────────────────────────

  let text = paragraphs.filter(Boolean).join(' ');
  const wordCount = countWords(text);

  if (wordCount > HP_WORD_CAP) {
    text = trimToWordCap(text, HP_WORD_CAP);
  }

  // ── Confidence ────────────────────────────────────────────────────────

  let confidence = 0;
  if (dataRichness >= 5) confidence = 0.85;
  else if (dataRichness >= 4) confidence = 0.75;
  else if (dataRichness >= 2) confidence = 0.55;
  else if (dataRichness >= 1) confidence = 0.35;
  else confidence = 0.15;

  return {
    role_identity_text: text,
    extraction_confidence: confidence,
  };
}

// ---------------------------------------------------------------------------
// LLM-based composer
// ---------------------------------------------------------------------------

/**
 * Format skill domains into a structured text block for the LLM prompt.
 *
 * @param {Array<{ domain: string, importance: string, mapped_items: string[] }>} domains
 * @returns {string}
 */
function formatSkillDomainsForPrompt(domains) {
  if (!domains || domains.length === 0) return '';

  return domains
    .map((d) => {
      const items = (d.mapped_items || []).join(', ');
      const dName = d.domain != null ? getEnglishField(d.domain) : '';
      return `[${d.importance}] ${dName}: ${items}`;
    })
    .join('\n');
}

/**
 * Keep only high-signal alternative titles for embedding text generation.
 * Filters low-signal seniority/experience qualifiers and limits count.
 *
 * @param {string[]} altTitles – May include both alt and hidden labels (merged caller-side).
 * @param {number} [max=3]
 * @returns {string[]}
 */
function selectAlternativeTitlesForEmbedding(altTitles, max = 3) {
  const DROP_TOKENS = [
    'junior', 'senior', 'graduate', 'intern', 'trainee', 'entry level',
    'specialised', 'specialized',
  ];
  const GENERIC_TITLE_TOKENS = new Set([
    'worker', 'staff', 'assistant', 'helper', 'team', 'member', 'employee',
  ]);

  const cleaned = (altTitles || [])
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .filter((t) => {
      const low = t.toLowerCase();
      if (DROP_TOKENS.some((token) => low.includes(token))) return false;
      const tokens = low
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      if (tokens.length === 0) return false;
      // Drop aliases that are mostly generic tokens and add little semantic value.
      const genericCount = tokens.filter((tok) => GENERIC_TITLE_TOKENS.has(tok)).length;
      return !(tokens.length <= 3 && genericCount >= 2);
    });

  // Deduplicate case-insensitively while preserving order.
  const seen = new Set();
  const unique = [];
  for (const title of cleaned) {
    const key = title.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(title);
    }
  }

  return unique.slice(0, max);
}

/**
 * Generate a Role Identity Text using an LLM.
 *
 * @param {object} input
 * @param {string}   input.title                 – Job role title
 * @param {string}   [input.alternative_titles]  – Comma-separated alternative titles
 * @param {string}   [input.description]         – Free-text role description
 * @param {string}   [input.required_skills]     – Comma-separated required skills
 * @param {string}   [input.optional_skills]     – Comma-separated optional skills
 * @param {string}   [input.skill_domains]       – Formatted skill domains block
 * @param {string}   [input.key_responsibilities] – Newline-separated responsibilities
 * @param {object} [options]
 * @param {Function} [options.llmProvider]        – async (messages) => string
 * @param {object}   [options.providerOpts]       – Extra options forwarded to the provider
 * @returns {Promise<{ role_identity_text: string }>}
 */
async function composeLLM(input, options = {}) {
  const { title } = input || {};

  if (!title) {
    throw new Error('"title" must be provided');
  }

  const messages = buildMessages(input);
  const provider = options.llmProvider || openaiProvider;
  const raw = await provider(messages, options.providerOpts || {});

  return validateExtraction(raw);
}

// ---------------------------------------------------------------------------
// Main entry points
// ---------------------------------------------------------------------------

/**
 * Compose a Role Identity Text from a CareerPath document.
 *
 * Maps CareerPath fields to the appropriate input format and returns a result
 * object ready to be stored in CareerPath.roleIdentity.
 *
 * @param {object} doc – A CareerPath document (or lean object)
 * @param {string}   doc.title
 * @param {string[]} [doc.altTitles]
 * @param {string[]} [doc.hiddenTitles] – Treated like altTitles for identity and embeddings
 * @param {string}   [doc.description]
 * @param {string[]} [doc.requiredSkills]
 * @param {object}   [doc.skillModel]
 * @param {object}   [doc.keyResponsibilities]
 * @param {object}   [doc.skillDomains]
 * @param {object} [options]
 * @param {'deterministic'|'llm'} [options.method='llm'] – Composition method
 * @param {Function} [options.llmProvider]   – Custom LLM provider function
 * @param {object}   [options.providerOpts]  – Options forwarded to the LLM provider
 * @returns {Promise<{
 *   role_identity_text: string,
 *   input_hash: string,
 *   extraction_confidence: number,
 *   built_at: Date,
 *   built_with: string
 * }>}
 */
async function composeFromCareerPath(doc, options = {}) {
  const method = options.method || 'llm';
  const inputHash = computeInputHash(doc);

  let result;

  if (method === 'deterministic') {
    result = composeDeterministic(doc);
  } else {
    // LLM-based composition
    const altTitles = selectAlternativeTitlesForEmbedding(mergeAltAndHiddenTitleAliases(doc), 3);

    const llmResult = await composeLLM(
      {
        title: doc.title != null ? getEnglishField(doc.title) : '',
        alternative_titles: altTitles.length > 0 ? altTitles.join(', ') : undefined,
        description: doc.description != null ? getEnglishField(doc.description) : undefined,
      },
      {
        llmProvider: options.llmProvider,
        providerOpts: options.providerOpts,
      }
    );

    // Confidence derived from available source fields (title, alt titles, description)
    const dataLayers = [
      doc.title != null ? getEnglishField(doc.title) : '',
      altTitles.length > 0,
      doc.description != null ? getEnglishField(doc.description) : '',
    ].filter(Boolean).length;

    let confidence = 0.60;
    if (dataLayers >= 3) confidence = 0.90;
    else if (dataLayers >= 2) confidence = 0.80;

    result = {
      role_identity_text: llmResult.role_identity_text,
      extraction_confidence: confidence,
    };
  }

  return {
    role_identity_text: result.role_identity_text,
    input_hash: inputHash,
    extraction_confidence: result.extraction_confidence,
    built_at: new Date(),
    built_with: method,
  };
}

/**
 * Check whether a document's identity text needs rebuilding by comparing
 * the current input hash against the stored one.
 *
 * @param {object} doc – A CareerPath document with roleIdentity subdocument
 * @returns {boolean} true if the identity text should be rebuilt
 */
function needsRebuild(doc) {
  if (!doc.roleIdentity || !doc.roleIdentity.role_identity_text) {
    return true;
  }
  if (!doc.roleIdentity.input_hash) {
    return true;
  }
  const currentHash = computeInputHash(doc);
  return currentHash !== doc.roleIdentity.input_hash;
}

module.exports = {
  composeFromCareerPath,
  composeDeterministic,
  composeLLM,
  computeInputHash,
  needsRebuild,
  validateExtraction,
  formatSkillDomainsForPrompt,
  selectAlternativeTitlesForEmbedding,
  openaiProvider,
};
