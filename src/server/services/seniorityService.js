/**
 * Seniority Service
 *
 * Infers the most appropriate seniority level for a job role based on its
 * title, description, required skills, and ISCO group code.
 *
 * Seniority Scale:
 *   0 = Entry / Intern / Trainee
 *   1 = Junior
 *   2 = Junior–Mid (some autonomy, still developing)
 *   3 = Mid-level (independent contributor)
 *   4 = Senior (deep expertise, mentoring)
 *   5 = Lead / Principal (technical or functional leadership)
 *   6 = Head / Director / Expert (strategic responsibility)
 *
 * Strategy: multi-signal heuristic combining:
 *   1. ISCO major group → base seniority (structural signal)
 *   2. Title keyword analysis → strongest override signal
 *   3. Description keyword analysis → supporting signal
 *   4. Skill complexity (count + leadership/management skills) → supporting signal
 *   5. Confidence is computed from signal agreement and clarity
 */

// ── Seniority labels ───────────────────────────────────────────────────────

const SENIORITY_LABELS = {
  0: 'Entry / Intern / Trainee',
  1: 'Junior',
  2: 'Junior–Mid',
  3: 'Mid-level',
  4: 'Senior',
  5: 'Lead / Principal',
  6: 'Head / Director / Expert'
};

// ── 1. ISCO major group → base seniority ───────────────────────────────────
//
// ISCO-08 major groups carry structural information about qualification levels:
//   0 = Armed forces            → 3 (varied, default mid)
//   1 = Managers                → 5 (leadership/management roles)
//   2 = Professionals           → 3-4 (degree-level, independent)
//   3 = Technicians & assoc.    → 2-3 (diploma/certificate level)
//   4 = Clerical support        → 1-2 (routine administrative)
//   5 = Service & sales         → 1-2 (service delivery)
//   6 = Skilled agri/forestry   → 2-3 (trade-level skills)
//   7 = Craft & related trades  → 2-3 (apprenticeship level)
//   8 = Plant/machine operators → 1-2 (operational)
//   9 = Elementary occupations  → 0-1 (minimal formal quals)

function getIscoBaseSeniority(iscoGroup) {
  if (!iscoGroup || typeof iscoGroup !== 'string') return null;
  const major = parseInt(iscoGroup.charAt(0), 10);
  if (!Number.isFinite(major)) return null;

  switch (major) {
    case 0: return 3; // Armed forces — varied, assume mid
    case 1: return 5; // Managers
    case 2: return 3; // Professionals (independent contributors)
    case 3: return 2; // Technicians & associate professionals
    case 4: return 1; // Clerical support
    case 5: return 2; // Service & sales workers
    case 6: return 3; // Skilled agricultural / forestry / fishery
    case 7: return 3; // Craft & related trades
    case 8: return 2; // Plant & machine operators
    case 9: return 0; // Elementary occupations
    default: return null;
  }
}

// ── 2. Title keyword analysis ──────────────────────────────────────────────
//
// Title keywords are the strongest signal. We scan for patterns that clearly
// indicate seniority direction. Each pattern returns a { level, weight } pair.
// Higher weight = stronger signal. If multiple patterns match, the highest-
// weight match wins.

const TITLE_PATTERNS = [
  // Level 6 — Head / Director / Expert (strategic)
  { re: /\bchief\b/i,                     level: 6, weight: 10 },
  { re: /\bdirector\b/i,                  level: 6, weight: 10 },
  { re: /\bhead of\b/i,                   level: 6, weight: 10 },
  { re: /\bhead\b(?!\s+(chef|waiter|bartender|gardener|baker|cook|butcher|housekeeper|greenkeeper|sommelier))/i,
                                            level: 6, weight: 8 },
  { re: /\bvice[\s-]?president\b/i,       level: 6, weight: 10 },
  { re: /\bexecutive\b/i,                 level: 6, weight: 8 },
  { re: /\bchief executive\b/i,           level: 6, weight: 10 },

  // Level 5 — Lead / Principal
  { re: /\blead\b/i,                      level: 5, weight: 8 },
  { re: /\bprincipal\b/i,                 level: 5, weight: 8 },
  { re: /\bteam leader\b/i,              level: 5, weight: 9 },
  { re: /\bsupervisor\b/i,               level: 5, weight: 7 },
  { re: /\bcoordinator\b/i,              level: 4, weight: 5 },
  { re: /\bmanager\b/i,                   level: 5, weight: 7 },
  { re: /\bsuperintendent\b/i,           level: 5, weight: 7 },
  { re: /\bforeman\b/i,                   level: 5, weight: 7 },
  { re: /\bforewoman\b/i,                level: 5, weight: 7 },

  // Level 4 — Senior
  { re: /\bsenior\b/i,                    level: 4, weight: 9 },
  { re: /\badvanced\b/i,                  level: 4, weight: 6 },
  { re: /\bspecialist\b/i,                level: 4, weight: 5 },
  { re: /\bconsultant\b/i,                level: 4, weight: 5 },
  { re: /\bexpert\b/i,                    level: 4, weight: 6 },

  // Level 1 — Junior / Entry
  { re: /\bjunior\b/i,                    level: 1, weight: 9 },
  { re: /\bapprentice\b/i,               level: 0, weight: 9 },
  { re: /\bintern\b/i,                    level: 0, weight: 9 },
  { re: /\btrainee\b/i,                   level: 0, weight: 9 },
  { re: /\bassistant\b/i,                 level: 1, weight: 6 },
  { re: /\baide\b/i,                       level: 1, weight: 6 },
  { re: /\bhelper\b/i,                    level: 0, weight: 7 },
  { re: /\bauxiliary\b/i,                 level: 1, weight: 6 },
];

function analyzeTitleKeywords(title) {
  if (!title) return null;

  let bestMatch = null;

  for (const pattern of TITLE_PATTERNS) {
    if (pattern.re.test(title)) {
      if (!bestMatch || pattern.weight > bestMatch.weight) {
        bestMatch = { level: pattern.level, weight: pattern.weight, keyword: pattern.re.source };
      }
    }
  }

  return bestMatch;
}

// ── 3. Description keyword analysis ────────────────────────────────────────
//
// Description signals provide supporting evidence. We count occurrences of
// keywords associated with different seniority tiers and compute a
// weighted signal.

const DESC_SENIOR_KEYWORDS = [
  'strategic', 'strategy', 'leadership', 'oversee', 'govern',
  'direct', 'policy', 'organisation-wide', 'organization-wide',
  'board', 'executive', 'stakeholder', 'vision', 'budget management',
  'high-level', 'regulatory compliance'
];

const DESC_LEAD_KEYWORDS = [
  'supervise', 'coordinate', 'lead', 'manage', 'mentor',
  'delegate', 'team management', 'project management', 'plan and organise',
  'plan and organize', 'allocate resources', 'performance review',
  'instruct staff', 'train staff'
];

const DESC_MID_KEYWORDS = [
  'independent', 'autonomy', 'autonomous', 'responsible for',
  'expertise', 'professional', 'apply knowledge', 'specialist knowledge',
  'analyse', 'analyze', 'evaluate', 'design', 'develop'
];

const DESC_JUNIOR_KEYWORDS = [
  'under supervision', 'assist', 'support', 'carry out',
  'routine', 'basic', 'follow instructions', 'guided by',
  'entry-level', 'perform simple', 'repetitive'
];

function analyzeDescription(description) {
  if (!description) return { signal: null, scores: {} };

  const text = description.toLowerCase();

  const countMatches = (keywords) =>
    keywords.reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);

  const scores = {
    senior: countMatches(DESC_SENIOR_KEYWORDS),
    lead: countMatches(DESC_LEAD_KEYWORDS),
    mid: countMatches(DESC_MID_KEYWORDS),
    junior: countMatches(DESC_JUNIOR_KEYWORDS)
  };

  // Pick the strongest signal (normalized by keyword list size)
  const normalized = {
    senior: scores.senior / DESC_SENIOR_KEYWORDS.length,
    lead: scores.lead / DESC_LEAD_KEYWORDS.length,
    mid: scores.mid / DESC_MID_KEYWORDS.length,
    junior: scores.junior / DESC_JUNIOR_KEYWORDS.length
  };

  const best = Object.entries(normalized).sort((a, b) => b[1] - a[1])[0];

  if (best[1] === 0) return { signal: null, scores };

  const signalMap = { senior: 5, lead: 4, mid: 3, junior: 1 };
  return { signal: signalMap[best[0]], strength: best[1], scores };
}

// ── 4. Skill complexity signal ─────────────────────────────────────────────
//
// Leadership/management/strategic skills push seniority up.
// Very low skill counts suggest entry-level.

const LEADERSHIP_SKILL_KEYWORDS = [
  'manage', 'supervise', 'lead', 'coordinate', 'mentor',
  'delegate', 'strategic', 'budget', 'policy', 'governance',
  'negotiate', 'stakeholder', 'performance management',
  'organisational', 'organizational', 'direct a team',
  'manage staff', 'manage personnel'
];

function analyzeSkillComplexity(requiredSkills, skillModel) {
  const skills = [];

  // Prefer skillModel core + optional if available
  if (skillModel && Array.isArray(skillModel.core_skills)) {
    skills.push(...skillModel.core_skills);
    if (Array.isArray(skillModel.optional_skills)) {
      skills.push(...skillModel.optional_skills);
    }
  } else if (Array.isArray(requiredSkills)) {
    skills.push(...requiredSkills);
  }

  if (skills.length === 0) return { signal: null, leadershipCount: 0, totalSkills: 0 };

  const leadershipCount = skills.filter((s) => {
    const lower = (typeof s === 'string' ? s : '').toLowerCase();
    return LEADERSHIP_SKILL_KEYWORDS.some((kw) => lower.includes(kw));
  }).length;

  const leadershipRatio = leadershipCount / skills.length;
  const totalSkills = skills.length;

  // Heuristic signal from skill patterns
  let signal = null;
  if (leadershipRatio >= 0.25 && leadershipCount >= 3) {
    signal = 5; // Strong leadership skill presence
  } else if (leadershipRatio >= 0.10 && leadershipCount >= 2) {
    signal = 4; // Some leadership skills
  } else if (totalSkills <= 3) {
    signal = 1; // Very few skills → likely entry/junior
  }

  return { signal, leadershipCount, totalSkills, leadershipRatio };
}

// ── Signal aggregation ─────────────────────────────────────────────────────

/**
 * Infer seniority for a single career path / occupation.
 *
 * @param {object} params
 * @param {string} params.title           – occupation title
 * @param {string} params.description     – occupation description
 * @param {string[]} params.requiredSkills – flat skill title array
 * @param {string} params.iscoGroup       – ISCO-08 group code
 * @param {object} [params.skillModel]    – structured skill model (if available)
 * @returns {object} { seniority_level, seniority_label, seniority_reasoning, extraction_confidence }
 */
function inferSeniority({ title, description, requiredSkills, iscoGroup, skillModel }) {
  const signals = [];
  const reasons = [];

  // --- Signal 1: ISCO base (weight 3) ---
  const iscoBase = getIscoBaseSeniority(iscoGroup);
  if (iscoBase !== null) {
    signals.push({ level: iscoBase, weight: 3, source: 'isco' });
    reasons.push(`ISCO group ${iscoGroup} (major ${iscoGroup.charAt(0)}) suggests ${SENIORITY_LABELS[iscoBase]} level.`);
  }

  // --- Signal 2: Title keywords (strongest signal) ---
  // Level 6 title indicators (director, head of, chief, VP) with high pattern
  // confidence get extra weight so they aren't diluted below 6 by averaging.
  const titleSignal = analyzeTitleKeywords(title);
  if (titleSignal) {
    const titleWeight = (titleSignal.level === 6 && titleSignal.weight >= 9) ? 8 : 5;
    signals.push({ level: titleSignal.level, weight: titleWeight, source: 'title' });
    reasons.push(`Title "${title}" contains seniority keyword signaling ${SENIORITY_LABELS[titleSignal.level]}.`);
  }

  // --- Signal 3: Description keywords (weight 2) ---
  const descSignal = analyzeDescription(description);
  if (descSignal.signal !== null) {
    signals.push({ level: descSignal.signal, weight: 2, source: 'description' });
  }

  // --- Signal 4: Skill complexity (weight 2) ---
  const skillSignal = analyzeSkillComplexity(requiredSkills, skillModel);
  if (skillSignal.signal !== null) {
    signals.push({ level: skillSignal.signal, weight: 2, source: 'skills' });
  }

  // --- Aggregate: weighted average, rounded ---
  let finalLevel;
  let confidence;

  if (signals.length === 0) {
    // No signals at all — default to mid-level with low confidence
    finalLevel = 3;
    confidence = 0.15;
    reasons.push('No clear signals available; defaulting to Mid-level.');
  } else {
    const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
    const weightedSum = signals.reduce((sum, s) => sum + s.level * s.weight, 0);
    const rawAvg = weightedSum / totalWeight;

    // Round to nearest integer; on ambiguity favor the lower level
    finalLevel = Math.round(rawAvg);
    // If we're exactly at .5, round down per the constraint "choose the LOWER reasonable seniority"
    if (rawAvg % 1 === 0.5) {
      finalLevel = Math.floor(rawAvg);
    }
    finalLevel = Math.max(0, Math.min(6, finalLevel));

    // --- Confidence ---
    confidence = computeConfidence(signals, finalLevel);
  }

  // Build reasoning string (1–2 sentences)
  const reasoning = buildReasoning(finalLevel, reasons, titleSignal, iscoBase, skillSignal);

  return {
    seniority_level: finalLevel,
    seniority_label: SENIORITY_LABELS[finalLevel],
    seniority_reasoning: reasoning,
    extraction_confidence: confidence,
    built_at: new Date(),
    built_with: 'heuristic'
  };
}

// ── Confidence computation ─────────────────────────────────────────────────

function computeConfidence(signals, finalLevel) {
  if (signals.length === 0) return 0.15;

  let conf = 0;

  // More signals → higher base confidence
  conf += Math.min(0.30, signals.length * 0.10);

  // Signal agreement: how many signals point to the same or ±1 level
  const agreeing = signals.filter((s) => Math.abs(s.level - finalLevel) <= 1);
  const agreementRatio = agreeing.length / signals.length;
  conf += agreementRatio * 0.40;

  // Title signal present (strongest signal) adds confidence
  if (signals.some((s) => s.source === 'title')) conf += 0.15;

  // ISCO signal present adds confidence
  if (signals.some((s) => s.source === 'isco')) conf += 0.10;

  // Penalize if signals strongly disagree (spread > 2 levels)
  const levels = signals.map((s) => s.level);
  const spread = Math.max(...levels) - Math.min(...levels);
  if (spread > 2) conf -= 0.10;
  if (spread > 4) conf -= 0.10;

  return Math.min(1.0, Math.max(0.1, Math.round(conf * 100) / 100));
}

// ── Reasoning builder ──────────────────────────────────────────────────────

function buildReasoning(finalLevel, reasons, titleSignal, iscoBase, skillSignal) {
  const parts = [];

  // Lead with the primary signal
  if (titleSignal) {
    parts.push(`Title signals ${SENIORITY_LABELS[titleSignal.level]} level.`);
  } else if (iscoBase !== null) {
    parts.push(`ISCO classification indicates ${SENIORITY_LABELS[iscoBase]} level.`);
  }

  // Add skill insight if meaningful
  if (skillSignal && skillSignal.leadershipCount > 0) {
    parts.push(`Role requires ${skillSignal.leadershipCount} leadership/management skill(s) out of ${skillSignal.totalSkills} total.`);
  } else if (skillSignal && skillSignal.totalSkills <= 3) {
    parts.push(`Low skill count (${skillSignal.totalSkills}) suggests limited scope.`);
  }

  // If the final level differs from the primary signal, explain
  if (titleSignal && titleSignal.level !== finalLevel) {
    parts.push(`Adjusted to ${SENIORITY_LABELS[finalLevel]} after considering all signals.`);
  }

  // Fallback
  if (parts.length === 0) {
    parts.push(`Classified as ${SENIORITY_LABELS[finalLevel]} based on available signals.`);
  }

  return parts.slice(0, 2).join(' ');
}

// ── Batch API ──────────────────────────────────────────────────────────────

/**
 * Infer seniority for multiple career path documents.
 *
 * @param {object[]} careerPaths – array of CareerPath lean objects
 * @returns {Map<string, object>} escoId → seniority result
 */
function inferSeniorityBatch(careerPaths) {
  const results = new Map();
  for (const cp of careerPaths) {
    const result = inferSeniority({
      title: cp.title,
      description: cp.description,
      requiredSkills: cp.requiredSkills,
      iscoGroup: cp.iscoGroup,
      skillModel: cp.skillModel
    });
    results.set(cp.escoId, result);
  }
  return results;
}

module.exports = {
  inferSeniority,
  inferSeniorityBatch,
  SENIORITY_LABELS,
  // Exported for testing
  getIscoBaseSeniority,
  analyzeTitleKeywords,
  analyzeDescription,
  analyzeSkillComplexity,
  computeConfidence
};
