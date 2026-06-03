const { buildMessages } = require('../../prompts/generateInputQualityDiagnosis');
const { buildBatchScoringMessages } = require('../../prompts/generateInputQualityBatchScoring');
const { buildFollowUpOnlyMessages } = require('../../prompts/generateInputQualityFollowUpQuestions');
const {
  getCachedProfileReviewDiagnosis,
  setCachedProfileReviewDiagnosis,
} = require('./inputQualityDiagnosisSessionCache');
const { openaiProvider } = require('./roleIdentityComposer');
const { normalizeForProcessing } = require('../ai/normalizeForProcessing');
const { translateText } = require('../ai/translateText');

/** @typedef {'too_short'|'too_generic'|'low_specificity'|'low_information_density'|'unclear_language'|'no_concrete_examples'|'no_tools_or_methods'|'no_outcomes'|'low_relevance'|'incomplete_scope'|'inconsistent_with_other_fields'} QualityIssue */

const ALLOWED_ISSUES = /** @type {const} */ ([
  'too_short',
  'too_generic',
  'low_specificity',
  'low_information_density',
  'unclear_language',
  'no_concrete_examples',
  'no_tools_or_methods',
  'no_outcomes',
  'low_relevance',
  'incomplete_scope',
  'inconsistent_with_other_fields'
]);

const ALLOWED_SET = new Set(ALLOWED_ISSUES);

const GENERIC_RE =
  /\b(various|several|many|things|stuff|worked on|helped with|good communication|team player|hard\s*worker|detail[-\s]?oriented|passionate|synergy|go-?getter|self-?starter|nice|great|awesome)\b/i;

const OUTCOME_RE =
  /\b(increased|decreased|reduced|improved|saved|grew|delivered|achieved|launched|shipped|cut|raised|accelerated|revenue|margin|uptime|sla|kpi|roi|nps|conversion|retention|latency|throughput)\b/i;

const TOOL_RE =
  /\b(sql|python|aws|gcp|azure|kubernetes|k8s|docker|javascript|typescript|java|react|node\.?js|tableau|power\s*bi|looker|snowflake|databricks|spark|kafka|airflow|dbt|etl|elt|excel|sheets|jira|confluence|git(hub|lab)?|ci\/cd|jenkins|terraform|ansible|salesforce|hubspot|sap|workday|figma|photoshop|seo|sem|ga4|mixpanel|amplitude|api|graphql|rest|mongodb|postgres|mysql|redis|tensorflow|pytorch|mlflow)\b/i;

const TASK_VERB_RE =
  /\b(built|led|managed|designed|implemented|developed|owned|ran|drove|analyzed|modeled|architected|migrated|automated|optimized|scoped|defined|negotiated|hired|coached|partnered)\b/i;

function hasNumber(s) {
  return /\d/.test(String(s || ''));
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function roundScore(x) {
  return Math.round(clamp01(x) * 100) / 100;
}

function stripFences(raw) {
  let cleaned = String(raw || '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  return cleaned;
}

/**
 * @param {string} text
 * @param {Record<string, string>|undefined} otherFields
 * @returns {boolean}
 */
function detectInconsistentWithOtherFields(text, otherFields) {
  const t = String(text || '').trim().toLowerCase();
  if (t.length < 24) return false;
  if (!otherFields || typeof otherFields !== 'object') return false;
  for (const v of Object.values(otherFields)) {
    const o = String(v || '').trim().toLowerCase();
    if (o.length < 24) continue;
    if (t === o) return true;
  }
  return false;
}

/**
 * @param {unknown} parsed
 * @param {string} field
 * @returns {{ field: string, quality_score: number, dimension_scores: object, issues: QualityIssue[], follow_up_questions: string[] } | null}
 */
function coerceParsedDiagnosis(parsed, field) {
  if (!parsed || typeof parsed !== 'object') return null;
  const dimIn = parsed.dimension_scores;
  if (!dimIn || typeof dimIn !== 'object') return null;

  const specificity = roundScore(dimIn.specificity);
  const information_density = roundScore(dimIn.information_density);
  const clarity = roundScore(dimIn.clarity);
  const relevance = roundScore(dimIn.relevance);
  const completeness = roundScore(dimIn.completeness);

  const dimension_scores = {
    specificity,
    information_density,
    clarity,
    relevance,
    completeness
  };

  const issuesRaw = Array.isArray(parsed.issues) ? parsed.issues : [];
  /** @type {QualityIssue[]} */
  const issues = [];
  for (const item of issuesRaw) {
    const label = String(item || '').trim();
    if (ALLOWED_SET.has(label)) issues.push(/** @type {QualityIssue} */ (label));
  }

  const quRaw = Array.isArray(parsed.follow_up_questions) ? parsed.follow_up_questions : [];
  const follow_up_questions = quRaw.map((q) => String(q || '').trim()).filter(Boolean);

  const outField = String(parsed.field || field || '').trim() || String(field || '').trim();

  const quality_score = roundScore(
    (specificity + information_density + clarity + relevance + completeness) / 5
  );

  return {
    field: outField,
    quality_score,
    dimension_scores,
    issues,
    follow_up_questions
  };
}

/**
 * @param {string} raw
 * @param {string} field
 */
function parseDiagnosisJson(raw, field) {
  const cleaned = stripFences(raw);
  const parsed = JSON.parse(cleaned);
  return coerceParsedDiagnosis(parsed, field);
}

/**
 * @param {string} raw
 * @param {readonly string[]} fieldOrder
 * @returns {{ field: string, quality_score: number, dimension_scores: object, issues: QualityIssue[] }[] | null}
 */
function parseBatchScoringJson(raw, fieldOrder) {
  const cleaned = stripFences(raw);
  const parsed = JSON.parse(cleaned);
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : null;
  if (!sections || sections.length < fieldOrder.length) return null;

  /** @type {Map<string, { field: string, quality_score: number, dimension_scores: object, issues: QualityIssue[] }>} */
  const byField = new Map();
  for (const item of sections) {
    const coerced = coerceParsedDiagnosis({ ...item, follow_up_questions: [] }, String(item?.field || ''));
    if (!coerced) continue;
    const { follow_up_questions: _fq, ...scoring } = coerced;
    byField.set(coerced.field, scoring);
  }

  const out = [];
  for (const field of fieldOrder) {
    const row = byField.get(field);
    if (!row) return null;
    out.push(row);
  }
  return out;
}

/**
 * @param {string} raw
 * @param {string} field
 * @returns {string[]}
 */
function parseFollowUpQuestionsJson(raw, field) {
  const cleaned = stripFences(raw);
  const parsed = JSON.parse(cleaned);
  if (Array.isArray(parsed?.follow_up_questions)) {
    return parsed.follow_up_questions.map((q) => String(q || '').trim()).filter(Boolean);
  }
  const coerced = coerceParsedDiagnosis(parsed, field);
  return coerced?.follow_up_questions ?? [];
}

/**
 * @param {{ quality_score: number, field: string }[]} diagnoses
 */
function sortDiagnosesByQuality(diagnoses) {
  return [...diagnoses].sort((a, b) => {
    if (a.quality_score !== b.quality_score) return a.quality_score - b.quality_score;
    return String(a.field).localeCompare(String(b.field));
  });
}

/**
 * @param {Record<string, string>} normalizedTextMap
 * @param {{ field: string, quality_score: number, dimension_scores: object, issues: QualityIssue[] }} row
 */
function mergeInconsistentIssueForField(normalizedTextMap, row) {
  const text = normalizedTextMap[row.field] ?? '';
  const otherFields = { ...normalizedTextMap };
  delete otherFields[row.field];
  let issues = [...row.issues];
  if (detectInconsistentWithOtherFields(text, otherFields) && !issues.includes('inconsistent_with_other_fields')) {
    issues.push('inconsistent_with_other_fields');
  }
  return finalizeDiagnosis({
    ...row,
    issues: [...new Set(issues)],
    follow_up_questions: []
  });
}

/**
 * @param {{ field: string, quality_score: number, dimension_scores: object, issues: QualityIssue[], follow_up_questions: string[] }} d
 */
function finalizeDiagnosis(d) {
  const { specificity, information_density, clarity, relevance, completeness } = d.dimension_scores;
  const mean = (specificity + information_density + clarity + relevance + completeness) / 5;
  return {
    ...d,
    quality_score: roundScore(mean)
  };
}

/**
 * @param {string} fieldLabel
 * @param {QualityIssue[]} issues
 * @param {number} quality_score
 */
function defaultQuestionsForIssues(fieldLabel, issues, quality_score) {
  const label = fieldLabel || 'this field';
  const set = new Set(issues);
  const high = quality_score >= 0.8;

  /** @type {string[]} */
  const pool = [];

  if (set.has('inconsistent_with_other_fields')) {
    pool.push(
      `Which statement should be the single source of truth for ${label}, and what should we remove or rephrase elsewhere so it matches?`
    );
  }
  if (set.has('too_short') || set.has('low_specificity') || set.has('incomplete_scope')) {
    pool.push(
      high
        ? `For ${label}, what are 2–3 recurring weekly responsibilities a hiring manager could verify from your CV or a reference check?`
        : `What concrete tasks did you own in ${label} (weekly or monthly), stated as verb + object + scope?`
    );
  }
  if (set.has('no_tools_or_methods') || set.has('low_information_density')) {
    pool.push(
      high
        ? `Which tools or methods are you strongest in for ${label}, and what is one nuanced tradeoff you handled when choosing between them?`
        : `What specific tools, systems, or methods did you use for ${label} (names and how you used them)?`
    );
  }
  if (set.has('no_outcomes') || set.has('no_concrete_examples')) {
    pool.push(
      high
        ? `What measurable or observable outcome best proves impact for ${label} (metric, baseline vs result, timeframe), without guessing numbers you cannot support?`
        : `What measurable or qualitative outcome resulted from your work in ${label} (what changed for users, customers, or the business)?`
    );
  }
  if (set.has('too_generic') || set.has('low_relevance')) {
    pool.push(
      `What domain, product area, or role-relevant keywords should appear in ${label} so it matches the jobs you want (skills, industries, deliverables)?`
    );
  }
  if (set.has('unclear_language')) {
    pool.push(
      `Can you rewrite ${label} in 2–4 short sentences: context, your actions, tools, and outcome—each sentence with one main idea?`
    );
  }

  const seen = new Set();
  const out = [];
  for (const q of pool) {
    const k = q.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
    if (out.length >= 3) break;
  }

  while (out.length < 3) {
    if (high) {
      out.push(
        `What scope boundary should we clarify for ${label} (team size, budget authority, geography, seniority of stakeholders)?`
      );
    } else {
      out.push(
        `What context should we add for ${label} (company type, team, timeframe, or constraints you worked within)?`
      );
    }
    const k = out[out.length - 1].toLowerCase();
    if (seen.has(k)) {
      out[out.length - 1] = `${out[out.length - 1]} (Add one sentence that was not in your original text.)`;
    }
    seen.add(out[out.length - 1].toLowerCase());
  }

  return out.slice(0, 3);
}

/**
 * Derive dimension scores from heuristics (strict; typically below 0.8).
 *
 * @param {string} raw
 * @param {QualityIssue[]} issues
 */
function heuristicDimensionScores(raw, issues) {
  const words = raw ? raw.split(/\s+/).filter(Boolean) : [];
  const wc = words.length;
  const uniq = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/gi, '')));
  const density = wc ? uniq.size / wc : 0;

  let specificity = 0.25;
  if (wc >= 25) specificity += 0.2;
  if (wc >= 55) specificity += 0.15;
  if (hasNumber(raw)) specificity += 0.12;
  if (TASK_VERB_RE.test(raw)) specificity += 0.1;
  if (GENERIC_RE.test(raw)) specificity -= 0.18;
  if (issues.includes('too_short')) specificity = Math.min(specificity, 0.28);

  let information_density = 0.3 + Math.min(0.35, density * 0.55);
  if (issues.includes('low_information_density')) information_density -= 0.15;
  if (wc < 8) information_density = Math.min(information_density, 0.25);

  let clarity = 0.45;
  if (raw && /[.!?]/.test(raw)) clarity += 0.15;
  if (wc > 0 && wc < 80) clarity += 0.08;
  if (issues.includes('unclear_language')) clarity -= 0.22;
  if (issues.includes('too_short')) clarity = Math.min(clarity, 0.35);

  let relevance = 0.35;
  if (TOOL_RE.test(raw)) relevance += 0.22;
  if (TASK_VERB_RE.test(raw)) relevance += 0.12;
  if (OUTCOME_RE.test(raw)) relevance += 0.1;
  if (issues.includes('low_relevance')) relevance -= 0.15;

  let completeness = 0.35;
  if (TASK_VERB_RE.test(raw)) completeness += 0.15;
  if (TOOL_RE.test(raw)) completeness += 0.18;
  if (OUTCOME_RE.test(raw)) completeness += 0.18;
  if (issues.includes('incomplete_scope')) completeness -= 0.12;
  if (issues.includes('too_short')) completeness = Math.min(completeness, 0.3);

  return {
    specificity: roundScore(specificity),
    information_density: roundScore(information_density),
    clarity: roundScore(clarity),
    relevance: roundScore(relevance),
    completeness: roundScore(completeness)
  };
}

/**
 * Heuristic diagnosis when the model is unavailable or output is invalid.
 *
 * @param {string} field
 * @param {string} text
 * @param {Record<string, string>|undefined} otherFields
 */
function buildDeterministicDiagnosis(field, text, otherFields) {
  const raw = String(text || '').trim();
  const words = raw ? raw.split(/\s+/).filter(Boolean) : [];
  const wc = words.length;
  const chars = raw.length;

  /** @type {QualityIssue[]} */
  const issues = [];

  if (chars < 1) {
    issues.push('too_short', 'low_specificity', 'low_relevance', 'incomplete_scope');
  } else {
    if (wc < 10 || chars < 40) issues.push('too_short');
    if (GENERIC_RE.test(raw) && wc < 40) issues.push('too_generic');
    const uniq = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/gi, '')));
    const density = wc ? uniq.size / wc : 0;
    if (density < 0.55 && wc > 15) issues.push('low_information_density');
    if (!TOOL_RE.test(raw) && wc > 8) issues.push('no_tools_or_methods');
    if (!OUTCOME_RE.test(raw) && wc > 8) issues.push('no_outcomes');
    if (!TASK_VERB_RE.test(raw) && wc > 8) issues.push('no_concrete_examples');
    if (!hasNumber(raw) && wc > 12 && !TOOL_RE.test(raw)) issues.push('low_specificity');
    if (wc >= 10 && (!TOOL_RE.test(raw) || !OUTCOME_RE.test(raw))) issues.push('incomplete_scope');
    if (!/[.!?]/.test(raw) && wc > 25) issues.push('unclear_language');
    if (wc > 8 && !TASK_VERB_RE.test(raw) && !TOOL_RE.test(raw)) issues.push('low_relevance');
  }

  if (detectInconsistentWithOtherFields(raw, otherFields)) {
    issues.push('inconsistent_with_other_fields');
  }

  const rawDims = heuristicDimensionScores(raw, issues);
  /** Heuristic path stays conservative (avoid implying LLM-level quality). */
  const dimension_scores = {
    specificity: roundScore(Math.min(0.75, rawDims.specificity)),
    information_density: roundScore(Math.min(0.75, rawDims.information_density)),
    clarity: roundScore(Math.min(0.75, rawDims.clarity)),
    relevance: roundScore(Math.min(0.75, rawDims.relevance)),
    completeness: roundScore(Math.min(0.75, rawDims.completeness))
  };
  const base = finalizeDiagnosis({
    field: String(field || '').trim() || 'field',
    quality_score: 0,
    dimension_scores,
    issues: [...new Set(issues)],
    follow_up_questions: []
  });

  return {
    ...base,
    follow_up_questions: defaultQuestionsForIssues(base.field, base.issues, base.quality_score)
  };
}

/**
 * Normalize optional other-fields map to plain trimmed strings.
 *
 * @param {unknown} otherFields
 * @returns {Record<string, string>|undefined}
 */
function normalizeOtherFields(otherFields) {
  if (!otherFields || typeof otherFields !== 'object' || Array.isArray(otherFields)) return undefined;
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(otherFields)) {
    out[String(k)] = String(v ?? '').trim();
  }
  return out;
}

async function normalizeTextMapForProcessing(map, lang) {
  const input = map && typeof map === 'object' ? map : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = await normalizeForProcessing(String(value ?? ''), lang, translateText);
  }
  return output;
}

async function localizeFollowUpQuestion(question, lang, translator = translateText) {
  const target = String(lang || 'en').toLowerCase().split('-')[0] || 'en';
  const raw = String(question || '').trim();
  if (!raw || target === 'en') return raw;
  try {
    const translated = await translator({ text: raw, targetLang: target });
    return String(translated || '').trim() || raw;
  } catch (_err) {
    return raw;
  }
}

/**
 * Quality diagnosis for a single profile input field (LLM when configured, else heuristics).
 *
 * @param {{ field: string, text: string, otherFields?: Record<string, unknown>, lang?: string, textAlreadyNormalized?: boolean }} params
 * @param {{ llmProvider?: typeof openaiProvider, providerOpts?: object }} [options]
 * @returns {Promise<{ field: string, quality_score: number, dimension_scores: { specificity: number, information_density: number, clarity: number, relevance: number, completeness: number }, issues: QualityIssue[], follow_up_questions: string[] }>}
 */
async function evaluateInputFieldQuality(params, options = {}) {
  const field = String(params?.field || '').trim() || 'field';
  const language = String(params?.lang || 'en').toLowerCase().split('-')[0] || 'en';
  // ENGLISH_ONLY_PIPELINE: deterministic regex/NLP heuristics below operate on EN-normalized text.
  let text;
  let otherFields;
  if (params?.textAlreadyNormalized === true) {
    text = String(params?.text ?? '');
    otherFields = normalizeOtherFields(params?.otherFields);
  } else {
    text = String(await normalizeForProcessing(String(params?.text ?? ''), language, translateText) ?? '');
    const otherFieldsRaw = normalizeOtherFields(params?.otherFields);
    otherFields = await normalizeTextMapForProcessing(otherFieldsRaw, language);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return buildDeterministicDiagnosis(field, text, otherFields);
  }

  try {
    const provider = options.llmProvider || openaiProvider;
    const raw = await provider(buildMessages({ field, text, otherFields }), {
      temperature: 0.15,
      ...(options.providerOpts || {})
    });
    const parsed = parseDiagnosisJson(raw, field);
    if (!parsed) throw new Error('Invalid diagnosis JSON shape');

    let mergedIssues = [...parsed.issues];
    if (detectInconsistentWithOtherFields(text, otherFields) && !mergedIssues.includes('inconsistent_with_other_fields')) {
      mergedIssues.push('inconsistent_with_other_fields');
    }
    mergedIssues = [...new Set(mergedIssues)];

    let diagnosis = finalizeDiagnosis({ ...parsed, issues: mergedIssues });

    if (diagnosis.follow_up_questions.length !== 3) {
      diagnosis = {
        ...diagnosis,
        follow_up_questions: defaultQuestionsForIssues(diagnosis.field, diagnosis.issues, diagnosis.quality_score)
      };
    }

    return diagnosis;
  } catch (err) {
    console.warn('[inputQualityDiagnosisService] Falling back to heuristic diagnosis:', err.message);
    return buildDeterministicDiagnosis(field, text, otherFields);
  }
}

const PROFILE_REVIEW_IDENTITY_KEYS = /** @type {const} */ ([
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement'
]);

/** Step 2→3 flow: only these sections are scored (5 identity + responsibilities + learning goals). */
const REVIEW_STEP3_QUALITY_FIELD_ORDER = /** @type {const} */ ([
  ...PROFILE_REVIEW_IDENTITY_KEYS.map((k) => `userIdentity.${k}`),
  'structuredUserInfo.keyResponsibilities',
  'structuredUserInfo.skillsInDevelopment'
]);

/**
 * @param {object} sui
 * @param {string} key
 */
function joinStructuredReviewText(sui, key) {
  const s = sui && typeof sui === 'object' ? sui : {};
  if (key === 'skills') {
    return (Array.isArray(s.skills) ? s.skills : [])
      .map((item) => (typeof item === 'string' ? item : String(item?.name || '')).trim())
      .filter(Boolean)
      .join('\n');
  }
  const arr = Array.isArray(s[key]) ? s[key] : [];
  return arr.map((x) => String(x || '').trim()).filter(Boolean).join('\n');
}

/**
 * Text map for the seven sections used in the extraction review step 3 quality pass.
 *
 * @param {{ userIdentity?: object, structuredUserInfo?: object }} snapshot
 * @returns {Record<string, string>}
 */
function buildStep3ReviewTextMap(snapshot = {}) {
  const ui = snapshot.userIdentity && typeof snapshot.userIdentity === 'object' ? snapshot.userIdentity : {};
  const sui =
    snapshot.structuredUserInfo && typeof snapshot.structuredUserInfo === 'object'
      ? snapshot.structuredUserInfo
      : {};
  /** @type {Record<string, string>} */
  const map = {};
  for (const k of PROFILE_REVIEW_IDENTITY_KEYS) {
    map[`userIdentity.${k}`] = String(ui[k] || '').trim();
  }
  map['structuredUserInfo.keyResponsibilities'] = joinStructuredReviewText(sui, 'keyResponsibilities');
  map['structuredUserInfo.skillsInDevelopment'] = joinStructuredReviewText(sui, 'skillsInDevelopment');
  return map;
}

/** Short label for heuristic follow-up templates (not shown to user verbatim in all cases). */
function fieldLabelForDefaultQuestions(field) {
  if (field === 'structuredUserInfo.keyResponsibilities') return 'key responsibilities';
  if (field === 'structuredUserInfo.skillsInDevelopment') return 'learning goals';
  const key = String(field || '').startsWith('userIdentity.') ? String(field).slice('userIdentity.'.length) : String(field);
  const pretty = {
    workEnjoyMost: 'what kind of work you enjoy most',
    topicsIndustriesInterest: 'topics or industries you are interested in',
    naturallyGoodAt: 'what you are naturally good at',
    workEnvironmentFit: 'the work environment that suits you best',
    workingLifeAchievement: 'what you want to achieve in your working life'
  };
  return pretty[key] || key;
}

/**
 * @param {{ field: string, quality_score: number, issues: QualityIssue[], follow_up_questions: string[] }} diagnosis
 */
function pickSingleFollowUpQuestion(diagnosis) {
  const qs = (diagnosis.follow_up_questions || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (qs[0]) return qs[0];
  const label = fieldLabelForDefaultQuestions(diagnosis.field);
  const pooled = defaultQuestionsForIssues(label, diagnosis.issues, diagnosis.quality_score);
  return (
    pooled[0] ||
    'What concrete detail could you add here to make your experience clearer for role matching?'
  );
}

/**
 * Heuristic scoring for all seven sections (no LLM).
 *
 * @param {Record<string, string>} normalizedTextMap
 */
function scoreAllSectionsHeuristically(normalizedTextMap) {
  return REVIEW_STEP3_QUALITY_FIELD_ORDER.map((field) => {
    const otherFields = { ...normalizedTextMap };
    delete otherFields[field];
    return buildDeterministicDiagnosis(field, normalizedTextMap[field] ?? '', otherFields);
  });
}

/**
 * Variant B: one batched LLM scoring call for all sections, then follow-up-only LLM for the three weakest.
 *
 * @param {Record<string, string>} normalizedTextMap
 * @param {{ llmProvider?: typeof openaiProvider, providerOpts?: object }} options
 */
async function scoreSectionsWithBatchLlm(normalizedTextMap, options = {}) {
  const provider = options.llmProvider || openaiProvider;
  const providerOpts = { temperature: 0.15, ...(options.providerOpts || {}) };

  /** @type {{ field: string, quality_score: number, dimension_scores: object, issues: QualityIssue[], follow_up_questions: string[] }[]} */
  let scoringDiagnoses;

  try {
    const raw = await provider(buildBatchScoringMessages(normalizedTextMap), providerOpts);
    const parsed = parseBatchScoringJson(raw, REVIEW_STEP3_QUALITY_FIELD_ORDER);
    if (!parsed) throw new Error('Invalid batch scoring JSON shape');
    scoringDiagnoses = parsed.map((row) => mergeInconsistentIssueForField(normalizedTextMap, row));
  } catch (err) {
    console.warn('[inputQualityDiagnosisService] Batch scoring failed, using heuristics:', err.message);
    scoringDiagnoses = scoreAllSectionsHeuristically(normalizedTextMap);
  }

  return scoringDiagnoses;
}

/**
 * @param {{ field: string, quality_score: number, dimension_scores: object, issues: QualityIssue[], follow_up_questions?: string[] }} diagnosis
 * @param {Record<string, string>} normalizedTextMap
 * @param {{ llmProvider?: typeof openaiProvider, providerOpts?: object }} options
 */
async function attachFollowUpQuestionsViaLlm(diagnosis, normalizedTextMap, options = {}) {
  const provider = options.llmProvider || openaiProvider;
  const providerOpts = { temperature: 0.15, ...(options.providerOpts || {}) };
  const text = normalizedTextMap[diagnosis.field] ?? '';
  const otherFields = { ...normalizedTextMap };
  delete otherFields[diagnosis.field];

  /** @type {string[]} */
  let follow_up_questions = [];
  try {
    const raw = await provider(
      buildFollowUpOnlyMessages({
        field: diagnosis.field,
        text,
        issues: diagnosis.issues,
        quality_score: diagnosis.quality_score,
        dimension_scores: diagnosis.dimension_scores,
        otherFields
      }),
      providerOpts
    );
    follow_up_questions = parseFollowUpQuestionsJson(raw, diagnosis.field);
  } catch (err) {
    console.warn(
      `[inputQualityDiagnosisService] Follow-up LLM failed for ${diagnosis.field}:`,
      err.message
    );
  }

  if (follow_up_questions.length !== 3) {
    follow_up_questions = defaultQuestionsForIssues(
      fieldLabelForDefaultQuestions(diagnosis.field),
      diagnosis.issues,
      diagnosis.quality_score
    );
  }

  return { ...diagnosis, follow_up_questions };
}

/**
 * @param {Record<string, string>} normalizedTextMap
 * @param {{ llmProvider?: typeof openaiProvider, providerOpts?: object }} options
 */
async function evaluateProfileReviewFollowUpsWithLlm(normalizedTextMap, options = {}) {
  const scoringDiagnoses = scoreAllSectionsHeuristically(normalizedTextMap);
  const worstThree = sortDiagnosesByQuality(scoringDiagnoses).slice(0, 3);
  return Promise.all(
    worstThree.map((d) => attachFollowUpQuestionsViaLlm(d, normalizedTextMap, options))
  );
}

/**
 * Score only the seven review sections, then return the three lowest-quality categories with one follow-up each.
 *
 * @param {{ userIdentity?: object, structuredUserInfo?: object }} snapshot
 * @param {{ llmProvider?: typeof openaiProvider, providerOpts?: object, translateFn?: typeof translateText, userId?: string, force?: boolean }} [options]
 * @returns {Promise<{ followUps: { field: string, quality_score: number, dimension_scores: object, issues: QualityIssue[], follow_up_question: string }[], cached?: boolean }>}
 */
async function evaluateProfileReviewFollowUps(snapshot = {}, options = {}) {
  const language = String(options?.lang || 'en').toLowerCase().split('-')[0] || 'en';
  const userId = options?.userId;

  if (!options?.force) {
    const cached = getCachedProfileReviewDiagnosis(userId, snapshot, language);
    if (cached) return { followUps: cached.followUps, cached: true };
  }

  const textMap = buildStep3ReviewTextMap(snapshot);
  const translateFn = typeof options?.translateFn === 'function' ? options.translateFn : translateText;
  const normalizedTextMap = await normalizeTextMapForProcessing(textMap, language);

  const apiKey = process.env.OPENAI_API_KEY;
  const worstThree =
    apiKey && String(apiKey).trim()
      ? await evaluateProfileReviewFollowUpsWithLlm(normalizedTextMap, options)
      : sortDiagnosesByQuality(scoreAllSectionsHeuristically(normalizedTextMap)).slice(0, 3);

  const followUps = await Promise.all(
    worstThree.map(async (d) => ({
      field: d.field,
      quality_score: d.quality_score,
      dimension_scores: d.dimension_scores,
      issues: d.issues,
      follow_up_question: await localizeFollowUpQuestion(pickSingleFollowUpQuestion(d), language, translateFn)
    }))
  );

  const result = { followUps, cached: false };
  setCachedProfileReviewDiagnosis(userId, snapshot, language, result);
  return result;
}

module.exports = {
  ALLOWED_ISSUES,
  evaluateInputFieldQuality,
  buildDeterministicDiagnosis,
  evaluateProfileReviewFollowUps,
  buildStep3ReviewTextMap,
  parseBatchScoringJson,
  parseFollowUpQuestionsJson,
  sortDiagnosesByQuality,
  REVIEW_STEP3_QUALITY_FIELD_ORDER
};
