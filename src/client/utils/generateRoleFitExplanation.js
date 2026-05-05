import localizedContentService from './localizedContentService';
import {
  resolveRoleFitLang,
  hydrateTrait,
  localizeBehaviorShell,
  getFragments,
} from './roleFitExplanationCopy';
import { ROLE_FIT_TRAIT_DEFINITIONS, ROLE_FIT_FALLBACK_TRAIT_DEFINITIONS } from './roleFitExplanationTraits';

const BANNED_PHRASES = [
  'aligns strongly',
  'drive impact',
  'leveraging',
  'cross-functional',
  'dynamic environment',
  'fast-paced',
  'passionate about',
];
const MAX_TRAITS = 2;
const MAX_SENTENCES = 4;
const MIN_SENTENCES = 3;
const ROLE_COPY_PHRASE_MIN_WORDS = 4;
const MIN_TRAIT_POOL = 4;
const MAX_TRAIT_POOL = 8;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toSentence(value) {
  const text = cleanText(value).replace(/[.?!]+$/g, '');
  if (!text) return '';
  return `${text}.`;
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueStrings(values) {
  return Array.from(new Set(safeArray(values).map((v) => cleanText(v)).filter(Boolean)));
}

function collectUserSignals(userProfile, lang = 'en') {
  const activeLang = resolveRoleFitLang(lang);
  if (!userProfile || typeof userProfile !== 'object') return [];
  const profile = userProfile.profile && typeof userProfile.profile === 'object'
    ? userProfile.profile
    : userProfile;

  const structured = profile.structuredUserInfo && typeof profile.structuredUserInfo === 'object'
    ? profile.structuredUserInfo
    : {};
  const simulationInputs = profile.careerSimulationInputs && typeof profile.careerSimulationInputs === 'object'
    ? profile.careerSimulationInputs
    : {};
  const simulationStructured =
    simulationInputs.structuredUserInfo && typeof simulationInputs.structuredUserInfo === 'object'
      ? simulationInputs.structuredUserInfo
      : {};

  const identityAnswers =
    profile.userIdentityAnswers && typeof profile.userIdentityAnswers === 'object'
      ? profile.userIdentityAnswers
      : {};

  const texts = [
    structured.workStyle,
    structured.work_style,
    structured.problemSolving,
    structured.problem_solving,
    structured.motivations,
    structured.preferences,
    structured.strengths,
    structured.bio,
    simulationStructured.workStyle,
    simulationStructured.problemSolving,
    simulationStructured.motivations,
    simulationStructured.strengths,
    simulationInputs.bio,
    profile.bio,
    localizedContentService.get(profile?.careerGoal, activeLang),
    profile.currentStatus,
    profile.mostSeniorWorkExperience,
    localizedContentService.get(profile?.who_are_you?.summary_text, activeLang),
    ...(Array.isArray(profile?.who_are_you?.raw_answers) ? profile.who_are_you.raw_answers : []),
    ...Object.values(identityAnswers),
  ];

  const structuredArrays = [
    ...safeArray(structured?.skills),
    ...safeArray(structured?.keyResponsibilities),
    ...safeArray(structured?.skillDomains),
    ...safeArray(simulationStructured?.skills),
    ...safeArray(simulationStructured?.keyResponsibilities),
    ...safeArray(simulationStructured?.skillDomains),
  ];

  return uniqueStrings([...texts, ...structuredArrays]);
}

function toLowerBlob(values) {
  return safeArray(values).join(' ').toLowerCase();
}

function collectRoleSignals(role) {
  if (!role || typeof role !== 'object') return [];
  const responsibilities = safeArray(role?.keyResponsibilities?.responsibilities);
  const domains = safeArray(role?.skillDomains?.skill_domains).map((d) => d?.domain).filter(Boolean);
  const skills = safeArray(role?.skillModel?.core_skills);
  return uniqueStrings([role.title, role.description, ...responsibilities, ...domains, ...skills]);
}

function buildUserFingerprint(userProfile) {
  const profile = userProfile?.profile && typeof userProfile.profile === 'object'
    ? userProfile.profile
    : userProfile || {};
  const parts = [
    cleanText(profile?.bio),
    cleanText(localizedContentService.get(profile?.careerGoal, 'en')),
    cleanText(profile?.mostSeniorWorkExperience),
    cleanText(localizedContentService.get(profile?.who_are_you?.summary_text, 'en')),
    cleanText(profile?.currentStatus),
  ];
  return parts.filter(Boolean).join('|').slice(0, 300) || 'anonymous-user';
}

function buildScopeKey(userFingerprint, simulationScopeId) {
  if (!userFingerprint) return null;
  const sim = cleanText(simulationScopeId);
  if (!sim) return null;
  return `${userFingerprint}::sim::${sim}`;
}

/**
 * Canonical key for a set of trait ids (order-independent). One id → that id; two+ → sorted join.
 */
export function buildCombinationKeyFromTraitIds(traitIds) {
  const ids = uniqueStrings(safeArray(traitIds));
  if (ids.length === 0) return '';
  if (ids.length === 1) return ids[0];
  return ids.slice().sort((a, b) => a.localeCompare(b)).join('::');
}

function getUsedCombinationCounts(traitUsageByScope, scopeKey) {
  if (!scopeKey || !traitUsageByScope.has(scopeKey)) return new Map();
  const state = traitUsageByScope.get(scopeKey);
  return state?.combinationCounts || new Map();
}

/**
 * Counts for pair/singleton cap, excluding this role's last recorded combination so it can
 * re-select the same combo on re-render.
 */
function getCombinationCountsForSelection(traitUsageByScope, scopeKey, roleKey) {
  const counts = new Map(getUsedCombinationCounts(traitUsageByScope, scopeKey));
  if (!scopeKey || !roleKey || !traitUsageByScope.has(scopeKey)) return counts;
  const state = traitUsageByScope.get(scopeKey);
  const prevKey = state.roleCombinationSelection?.get(roleKey);
  if (!prevKey) return counts;
  counts.set(prevKey, Math.max(0, (counts.get(prevKey) || 1) - 1));
  return counts;
}

/**
 * Tracks trait *combinations* per user + simulation run so we can enforce:
 * each unordered trait set (singleton or pair) at most once per simulation (hard cap).
 */
function trackUsedTraitCombinationAcrossRoles(traitUsageByScope, scopeKey, roleKey, selectedTraitIds) {
  if (!scopeKey || !roleKey) return;
  if (!traitUsageByScope.has(scopeKey)) {
    traitUsageByScope.set(scopeKey, {
      roleCombinationSelection: new Map(),
      combinationCounts: new Map(),
    });
  }
  const state = traitUsageByScope.get(scopeKey);
  if (!state.roleCombinationSelection) {
    state.roleCombinationSelection = new Map();
    state.combinationCounts = new Map();
  }
  const prevKey = state.roleCombinationSelection.get(roleKey) || '';
  if (prevKey) {
    state.combinationCounts.set(
      prevKey,
      Math.max(0, (state.combinationCounts.get(prevKey) || 1) - 1)
    );
  }
  const nextKey = buildCombinationKeyFromTraitIds(selectedTraitIds);
  state.roleCombinationSelection.set(roleKey, nextKey);
  if (nextKey) {
    state.combinationCounts.set(nextKey, (state.combinationCounts.get(nextKey) || 0) + 1);
  }
}

/** In-memory trait usage (e.g. legacy client); server uses MongoTraitUsageStore. */
export function createTraitUsageMemoryStore() {
  const traitUsageByScope = new Map();
  return {
    getCombinationCountsForSelection(scopeKey, roleKey) {
      return getCombinationCountsForSelection(traitUsageByScope, scopeKey, roleKey);
    },
    trackUsedTraitCombinationAcrossRoles(scopeKey, roleKey, selectedTraitIds) {
      trackUsedTraitCombinationAcrossRoles(traitUsageByScope, scopeKey, roleKey, selectedTraitIds);
    },
  };
}

function resolveSimulationScopeId(role, options = {}) {
  const fromOpts = cleanText(options?.simulationScopeId);
  if (fromOpts) return fromOpts;
  return cleanText(role?.simulationId) || cleanText(role?.simulationResultId) || '';
}

/**
 * Prefer one match per dimension first (orthogonal spread), then remaining matches.
 */
function orderTraitsOrthogonally(traits) {
  const list = safeArray(traits);
  const byDim = new Map();
  const rest = [];
  for (const t of list) {
    const d = t.dimension || 'other';
    if (!byDim.has(d)) byDim.set(d, t);
    else rest.push(t);
  }
  return [...byDim.values(), ...rest];
}

/**
 * Trait candidates grouped by orthogonal dimensions (flat array order = match priority).
 * dimension: cognitive | execution | communication | adaptation | interaction | decision | strategic | ambiguity
 */
function extractTraitPool(userProfile, lang = 'en') {
  const signals = collectUserSignals(userProfile, lang);
  const blob = toLowerBlob(signals);

  const matchedRaw = ROLE_FIT_TRAIT_DEFINITIONS.filter((c) => c.pattern.test(blob));
  const matched = orderTraitsOrthogonally(matchedRaw.map((d) => hydrateTrait(d, lang)));
  if (matched.length >= MIN_TRAIT_POOL) return matched.slice(0, MAX_TRAIT_POOL);
  if (matched.length > 0) return matched;

  return buildFallbackTraitPool(lang);
}

/**
 * When profile text does not match specific trait patterns, use this pool.
 * Intentionally concrete (not generic “grounded / clarity” labels).
 */
function buildFallbackTraitPool(lang = 'en') {
  return ROLE_FIT_FALLBACK_TRAIT_DEFINITIONS.map((d) => hydrateTrait(d, lang));
}

function deriveRoleCoreBehaviorShell(role) {
  const roleSignals = collectRoleSignals(role);
  const roleBlob = toLowerBlob(roleSignals);
  const roleTitle = cleanText(role?.title).toLowerCase();

  if (/(tester|testing|qa|quality assurance|test engineer|game tester)/.test(roleTitle)) {
    return {
      id: 'quality-verification',
      primaryDimension: 'cognitive',
      supportingDimension: 'execution',
      fitTags: ['analysis', 'research', 'execution', 'operations', 'problem-solving'],
    };
  }
  if (/(cloud architect|architect|solution architect|software architect|enterprise architect|cloud|devops|platform|infrastructure|site reliability|sre|engineer|developer)/.test(roleTitle)) {
    return {
      id: 'systems-design',
      primaryDimension: 'cognitive',
      supportingDimension: 'decision',
      fitTags: ['analysis', 'strategy', 'planning', 'execution', 'problem-solving'],
    };
  }
  if (/(visitor services|service manager|operations manager|museum|cultural|front of house|guest experience|hospitality manager)/.test(roleTitle)) {
    return {
      id: 'service-operations',
      primaryDimension: 'execution',
      supportingDimension: 'interaction',
      fitTags: ['operations', 'execution', 'delivery', 'leadership', 'coordination'],
    };
  }
  if (/(analyst|analysis|research|insight|intelligence)/.test(roleTitle)) {
    return {
      id: 'sensemaking',
      primaryDimension: 'cognitive',
      supportingDimension: 'decision',
      fitTags: ['strategy', 'analysis', 'problem-solving', 'planning'],
    };
  }
  if (/(operation|operations|coordinator|project|program|delivery|planner)/.test(roleTitle)) {
    return {
      id: 'structure-execution',
      primaryDimension: 'execution',
      supportingDimension: 'cognitive',
      fitTags: ['operations', 'execution', 'delivery', 'planning', 'leadership'],
    };
  }
  if (/(market|marketing|brand|campaign|content|social media|communications?)/.test(roleTitle)) {
    return {
      id: 'message-communication',
      primaryDimension: 'communication',
      supportingDimension: 'interaction',
      fitTags: ['sales', 'partnership', 'customer', 'product', 'coordination', 'communication'],
    };
  }
  if (/(activis|advocacy|community|public affairs|policy|engagement)/.test(roleTitle)) {
    return {
      id: 'community-mobilization',
      primaryDimension: 'interaction',
      supportingDimension: 'strategic',
      fitTags: ['communication', 'leadership', 'coordination', 'planning'],
    };
  }

  if (
    (/(sales|account|business development|commercial)/.test(roleBlob)) ||
    (/(client|customer)/.test(roleBlob) && /(pipeline|revenue|quota|deal|prospect|account)/.test(roleBlob))
  ) {
    return {
      id: 'people-communication',
      primaryDimension: 'communication',
      supportingDimension: 'interaction',
      fitTags: ['sales', 'partnership', 'customer', 'product', 'coordination', 'communication'],
    };
  }
  if (/(operation|workflow|process|delivery|project|execution|coordination)/.test(roleBlob)) {
    return {
      id: 'structure-execution',
      primaryDimension: 'execution',
      supportingDimension: 'cognitive',
      fitTags: ['operations', 'execution', 'delivery', 'planning', 'leadership'],
    };
  }
  if (/(strategy|analysis|analyst|research|data|insight|planning)/.test(roleBlob)) {
    return {
      id: 'sensemaking',
      primaryDimension: 'cognitive',
      supportingDimension: 'decision',
      fitTags: ['strategy', 'analysis', 'problem-solving', 'planning'],
    };
  }
  if (/(design|product|experience|ux|creative|content|brand)/.test(roleBlob)) {
    return {
      id: 'clarity-creation',
      primaryDimension: 'communication',
      supportingDimension: 'execution',
      fitTags: ['product', 'communication', 'execution', 'customer'],
    };
  }

  return {
    id: 'general-progress',
    primaryDimension: 'execution',
    supportingDimension: 'adaptation',
    fitTags: ['execution', 'problem-solving', 'planning'],
  };
}

function deriveRoleCoreBehavior(role, lang = 'en') {
  return localizeBehaviorShell(deriveRoleCoreBehaviorShell(role), lang);
}

function scoreTraitRoleRelevance(trait, coreBehavior) {
  if (!trait || !coreBehavior) return 0;
  return trait.roleFit.filter((tag) => coreBehavior.fitTags.includes(tag)).length;
}

const DIMENSION_ORDER = [
  'cognitive',
  'execution',
  'communication',
  'adaptation',
  'interaction',
  'decision',
  'strategic',
  'ambiguity',
];

/**
 * Picks one trait from the role's primary dimension and one from the supporting dimension
 * (max two traits per role). With per-simulation hard cap: each unordered trait combination
 * (singleton or pair) may appear at most once across roles in the same simulation.
 */
function selectTraitsByDimensions(traitPool, roleBehavior, combinationCounts, hardCapPerSimulation) {
  const pool = safeArray(traitPool);
  if (pool.length === 0) return [];

  let primaryDim = roleBehavior.primaryDimension || 'execution';
  let supportingDim = roleBehavior.supportingDimension || 'cognitive';
  if (primaryDim === supportingDim) {
    supportingDim = DIMENSION_ORDER.find((d) => d !== primaryDim) || 'cognitive';
  }

  const rankInDimension = (dimension) => pool
    .filter((trait) => trait.dimension === dimension)
    .map((trait) => ({
      trait,
      relevance: scoreTraitRoleRelevance(trait, roleBehavior),
    }))
    .sort((a, b) => b.relevance - a.relevance || a.trait.id.localeCompare(b.trait.id));

  const rankAll = () => pool
    .map((trait) => ({
      trait,
      relevance: scoreTraitRoleRelevance(trait, roleBehavior),
    }))
    .sort((a, b) => b.relevance - a.relevance || a.trait.id.localeCompare(b.trait.id));

  const primaryRows = [...rankInDimension(primaryDim), ...rankAll().filter((row) => row.trait.dimension !== primaryDim)];
  const primarySeen = new Set();
  const primaryList = [];
  for (const row of primaryRows) {
    if (primarySeen.has(row.trait.id)) continue;
    primarySeen.add(row.trait.id);
    primaryList.push(row.trait);
  }

  const comboBlocked = (key) => Boolean(
    hardCapPerSimulation && key && (combinationCounts.get(key) || 0) >= 1
  );

  const betterPair = (next, prev) => {
    if (!prev) return true;
    if (next.score !== prev.score) return next.score > prev.score;
    return next.sortKey.localeCompare(prev.sortKey) < 0;
  };

  let bestPair = null;
  for (const primaryTrait of primaryList) {
    const supportingOrdered = [];
    const seenSupporting = new Set();
    const pushSupporting = (trait) => {
      if (!trait || trait.id === primaryTrait.id || seenSupporting.has(trait.id)) return;
      seenSupporting.add(trait.id);
      supportingOrdered.push(trait);
    };

    rankInDimension(supportingDim).forEach((row) => pushSupporting(row.trait));
    for (const dim of DIMENSION_ORDER) {
      if (dim === primaryDim) continue;
      rankInDimension(dim).forEach((row) => pushSupporting(row.trait));
    }
    rankAll().forEach((row) => pushSupporting(row.trait));

    for (const supportingTrait of supportingOrdered) {
      const key = buildCombinationKeyFromTraitIds([primaryTrait.id, supportingTrait.id]);
      if (comboBlocked(key)) continue;
      const score = scoreTraitRoleRelevance(primaryTrait, roleBehavior)
        + scoreTraitRoleRelevance(supportingTrait, roleBehavior);
      const cand = { primary: primaryTrait, supporting: supportingTrait, score, sortKey: key };
      if (betterPair(cand, bestPair)) bestPair = cand;
    }
  }

  if (bestPair) {
    return [bestPair.primary, bestPair.supporting];
  }

  let bestSingle = null;
  for (const primaryTrait of primaryList) {
    const key = buildCombinationKeyFromTraitIds([primaryTrait.id]);
    if (comboBlocked(key)) continue;
    const score = scoreTraitRoleRelevance(primaryTrait, roleBehavior);
    const cand = { primary: primaryTrait, score, sortKey: key };
    if (betterPair(cand, bestSingle)) bestSingle = cand;
  }

  if (bestSingle) {
    return [bestSingle.primary];
  }

  if (hardCapPerSimulation) return [];
  return pool.slice(0, MAX_TRAITS);
}

function getRoleKey(role) {
  const title = cleanText(role?.title).toLowerCase();
  const esco = cleanText(role?.escoId).toLowerCase();
  return esco || title || `role-${cleanText(role?.description).slice(0, 80).toLowerCase()}`;
}

function pickGrowthSentence(roleBehavior, selectedTraits, roleKey, lang = 'en') {
  const fr = getFragments(resolveRoleFitLang(lang));
  const variants = fr.growthTemplates.map((tpl) =>
    tpl.replace(/\{\{summary\}\}/g, roleBehavior.summary)
  );
  const seed = `${roleBehavior?.id || ''}|${roleKey || ''}|${safeArray(selectedTraits).map((t) => t.id).join('|')}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return variants[hash % variants.length];
}

function normalizeForCopyCheck(text) {
  return cleanText(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
}

function hasCopiedRolePhrase(outputText, role) {
  const out = normalizeForCopyCheck(outputText);
  if (!out) return false;
  const roleSources = [
    cleanText(role?.description),
    ...safeArray(role?.keyResponsibilities?.responsibilities).map(cleanText),
  ].filter(Boolean);
  for (const source of roleSources) {
    const words = normalizeForCopyCheck(source).split(/\s+/).filter(Boolean);
    if (words.length < ROLE_COPY_PHRASE_MIN_WORDS) continue;
    for (let i = 0; i <= words.length - ROLE_COPY_PHRASE_MIN_WORDS; i += 1) {
      const phrase = words.slice(i, i + ROLE_COPY_PHRASE_MIN_WORDS).join(' ');
      if (phrase && out.includes(phrase)) return true;
    }
  }
  return false;
}

function buildFallbackExplanationLines(selectedTraits, roleBehavior, roleKey, lang = 'en') {
  const fr = getFragments(resolveRoleFitLang(lang));
  const primary = selectedTraits[0];
  const supporting = selectedTraits[1];
  if (!primary) {
    const genericBodies = fr.genericOpenerTemplates.map((tpl) =>
      tpl.replace(/\{\{summary\}\}/g, roleBehavior.summary)
    );
    let h = 0;
    for (let i = 0; i < String(roleKey || '').length; i += 1) h = (h * 33 + roleKey.charCodeAt(i)) >>> 0;
    return [
      toSentence(`${fr.openerPrefix} ${genericBodies[h % genericBodies.length]}`),
      toSentence(fr.genericSecondaryNoTraits),
      toSentence(roleBehavior.connection),
      toSentence(pickGrowthSentence(roleBehavior, [], roleKey, lang)),
    ].filter(Boolean).slice(0, MAX_SENTENCES);
  }

  const openerHashes = [
    `${fr.openerPrefix} ${primary.anchor}`,
    `${fr.openerPrefix} ${primary.anchor}${fr.openerMidRealSituations}`,
    `${fr.openerPrefix} ${primary.anchor}${fr.openerMidNotTheory}`,
  ];
  let hash = 0;
  for (let i = 0; i < String(roleKey || '').length; i += 1) hash = (hash * 33 + roleKey.charCodeAt(i)) >>> 0;
  const sentence1 = toSentence(openerHashes[hash % openerHashes.length]);
  const sentence2 = toSentence(primary.patternSentence);
  const bridge = supporting
    ? `${cleanText(supporting.patternSentence).replace(/[.?!]+$/g, '')}${fr.bridgeCommaAnd}`
    : '';
  const sentence3 = toSentence(`${bridge}${roleBehavior.connection}`);
  const sentence4 = toSentence(pickGrowthSentence(roleBehavior, selectedTraits, roleKey, lang));
  return [sentence1, sentence2, sentence3, sentence4].filter(Boolean).slice(0, MAX_SENTENCES);
}

function qualityCheck(lines, role, selectedTraits, traitCapExhausted, lang = 'en') {
  if (!Array.isArray(lines)) return false;
  if (lines.length < MIN_SENTENCES || lines.length > MAX_SENTENCES) return false;
  const fr = getFragments(resolveRoleFitLang(lang));
  if (!String(lines[0] || '').startsWith(fr.openerPrefix)) return false;
  if (selectedTraits.length === 0 && !traitCapExhausted) return false;
  if (hasCopiedRolePhrase(lines.join(' '), role)) return false;
  return true;
}

function sanitizeOutput(text) {
  let result = cleanText(text);
  for (const phrase of BANNED_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'gi'), '');
  }
  return cleanText(result);
}

/**
 * Minimal deterministic explanation (legacy assembly), used when the LLM path fails or is unavailable.
 */
function buildExplanationStringFallback(selectedTraits, roleBehavior, roleKey, lang, role, traitCapExhausted) {
  const lines = buildFallbackExplanationLines(selectedTraits, roleBehavior, roleKey, lang);
  const branch = qualityCheck(lines, role, selectedTraits, traitCapExhausted, lang)
    ? 'highQuality'
    : 'fallback';

  const fallbackLines = traitCapExhausted
    ? lines
    : (() => {
        const fr = getFragments(resolveRoleFitLang(lang));
        const p = selectedTraits[0];
        const s = selectedTraits[1];
        const bridge = s
          ? `${cleanText(s.patternSentence).replace(/[.?!]+$/g, '')}${fr.bridgeCommaAnd}`
          : '';
        return [
          toSentence(
            `${fr.openerPrefix} ${p ? p.anchor : fr.genericUndefinedTraitAnchor}`
          ),
          toSentence(p ? p.patternSentence : fr.genericUndefinedTraitSentence),
          toSentence(`${bridge}${roleBehavior.connection}`),
          toSentence(pickGrowthSentence(roleBehavior, selectedTraits, roleKey, lang)),
        ];
      })();

  return {
    branch,
    text: sanitizeOutput((branch === 'highQuality' ? lines : fallbackLines).join(' ')),
  };
}

function resolveRoleContext(role, options = {}) {
  const rc = options.roleContext && typeof options.roleContext === 'object' ? options.roleContext : {};
  return {
    title: cleanText(rc.title) || cleanText(role?.title) || '',
    coreChallenge: cleanText(rc.coreChallenge),
    typicalFailure: cleanText(rc.typicalFailure),
    realWork: cleanText(rc.realWork),
  };
}

function buildRoleDigestForLLM(role) {
  if (!role || typeof role !== 'object') return '';
  const responsibilities = safeArray(role?.keyResponsibilities?.responsibilities)
    .slice(0, 5)
    .map((r) => cleanText(r))
    .filter(Boolean);
  const rawDomains = Array.isArray(role?.skillDomains?.skill_domains)
    ? role.skillDomains.skill_domains
    : Array.isArray(role?.skillDomains)
      ? role.skillDomains
      : [];
  const domains = rawDomains
    .slice(0, 6)
    .map((d) => cleanText(typeof d === 'string' ? d : d?.domain || d?.label || ''))
    .filter(Boolean);
  const skills = safeArray(role?.skillModel?.core_skills)
    .slice(0, 8)
    .map((s) => cleanText(typeof s === 'string' ? s : s?.label || s?.skill || s?.name || ''))
    .filter(Boolean);
  const desc = cleanText(role.description).slice(0, 400);
  const lines = [];
  if (responsibilities.length) lines.push(`Tasks: ${responsibilities.join(' · ')}`);
  if (domains.length) lines.push(`Domains: ${domains.join(', ')}`);
  if (skills.length) lines.push(`Core skills mentioned: ${skills.join(', ')}`);
  if (desc) lines.push(`Role summary (truncated): ${desc}`);
  return lines.join('\n').slice(0, 1400);
}

function buildRoleFitExplanationPayload(lang, roleContext, selectedTraits, roleBehavior, role) {
  return {
    language: resolveRoleFitLang(lang),
    role: {
      title: roleContext.title || '',
      coreChallenge: roleContext.coreChallenge || '',
      typicalFailure: roleContext.typicalFailure || '',
      realWork: roleContext.realWork || '',
      digest: buildRoleDigestForLLM(role),
    },
    traits: selectedTraits.map((t) => ({
      id: t.id,
      dimension: t.dimension || '',
      anchor: cleanText(t.anchor),
      patternSentence: cleanText(t.patternSentence),
    })),
    behavior: {
      id: roleBehavior.id,
      primaryDimension: roleBehavior.primaryDimension || '',
      supportingDimension: roleBehavior.supportingDimension || '',
      fitTags: Array.isArray(roleBehavior.fitTags) ? [...roleBehavior.fitTags] : [],
      summary: cleanText(roleBehavior.summary),
      connection: cleanText(roleBehavior.connection),
    },
  };
}

/**
 * Shared pipeline for role-fit explanations (client tooling / server via @babel/register).
 *
 * @param {object} userProfile
 * @param {object} role career step / occupation payload
 * @param {object} [options]
 * @param {object} [options.traitUsageStore] memory or Mongo-backed store
 * @param {Function} [options.llmCaller] async (payload) => string
 * @param {object} [options.generationDeps] server cache hooks — tryLoadCached, saveCached, persistTraitUsage
 */
export async function generateRoleFitExplanationCore(userProfile, role, options = {}) {
  const lang = options.lang ?? options.language ?? 'en';
  const traitUsageStore = options.traitUsageStore || createTraitUsageMemoryStore();
  const traitPool = extractTraitPool(userProfile, lang);
  const roleBehavior = deriveRoleCoreBehavior(role, lang);
  const userFingerprint = buildUserFingerprint(userProfile);
  const roleKey = getRoleKey(role);
  const simulationScopeId = resolveSimulationScopeId(role, options);
  const scopeKey = buildScopeKey(userFingerprint, simulationScopeId);
  const hardCapPerSimulation = Boolean(scopeKey);
  const combinationCounts = scopeKey
    ? traitUsageStore.getCombinationCountsForSelection(scopeKey, roleKey)
    : new Map();
  const selectedTraits = selectTraitsByDimensions(
    traitPool,
    roleBehavior,
    combinationCounts,
    hardCapPerSimulation
  );
  const traitCapExhausted = hardCapPerSimulation && selectedTraits.length === 0;
  const selectedCombinationKey = selectedTraits.length > 0
    ? buildCombinationKeyFromTraitIds(selectedTraits.map((t) => t.id))
    : '';

  const deterministic = buildExplanationStringFallback(
    selectedTraits,
    roleBehavior,
    roleKey,
    lang,
    role,
    traitCapExhausted
  );
  const { branch, text: deterministicText } = deterministic;

  const roleContext = resolveRoleContext(role, options);
  const payload = buildRoleFitExplanationPayload(lang, roleContext, selectedTraits, roleBehavior, role);

  if (scopeKey && selectedTraits.length > 0) {
    traitUsageStore.trackUsedTraitCombinationAcrossRoles(
      scopeKey,
      roleKey,
      selectedTraits.map((t) => t.id)
    );
  }

  const deps = options.generationDeps;
  const debug = Boolean(options.debug);

  const baseReturn = {
    branch,
    roleBehaviorId: roleBehavior.id,
    primaryDimension: roleBehavior.primaryDimension || null,
    supportingDimension: roleBehavior.supportingDimension || null,
    selectedTraitIds: selectedTraits.map((t) => t.id),
    traitPoolIds: safeArray(traitPool).map((t) => t.id),
    simulationScopeId: simulationScopeId || null,
    traitCapExhausted,
    selectedCombinationKey,
    roleContext,
    payload,
  };

  if (deps && typeof deps.tryLoadCached === 'function') {
    const cached = await deps.tryLoadCached({
      selectedTraitIds: baseReturn.selectedTraitIds,
      roleContext,
      language: resolveRoleFitLang(lang),
    });
    if (cached && typeof cached.text === 'string' && cached.text.trim()) {
      if (typeof deps.persistTraitUsage === 'function') {
        await deps.persistTraitUsage();
      }
      return {
        ...baseReturn,
        text: sanitizeOutput(cached.text),
        explanationSource: cached.source === 'llm' ? 'llm' : 'fallback',
        fromCache: true,
      };
    }
  }

  let finalText = deterministicText;
  let explanationSource = 'fallback';

  const llmCaller = options.llmCaller;
  if (typeof llmCaller === 'function') {
    try {
      if (debug) {
        // eslint-disable-next-line no-console
        console.debug('[generateRoleFitExplanationCore] LLM payload', payload);
      }
      finalText = sanitizeOutput(await llmCaller(payload));
      explanationSource = 'llm';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[generateRoleFitExplanationCore] LLM failed, using deterministic fallback:',
        err?.message || err
      );
      finalText = deterministicText;
      explanationSource = 'fallback';
    }
  } else if (debug) {
    // eslint-disable-next-line no-console
    console.debug('[generateRoleFitExplanationCore] skipped LLM (no llmCaller)');
  }

  if (typeof deps?.persistTraitUsage === 'function') {
    await deps.persistTraitUsage();
  }

  if (deps && typeof deps.saveCached === 'function') {
    await deps.saveCached({
      selectedTraitIds: baseReturn.selectedTraitIds,
      roleContext,
      language: resolveRoleFitLang(lang),
      text: finalText,
      source: explanationSource === 'llm' ? 'llm' : 'fallback',
    });
  }

  return {
    ...baseReturn,
    text: finalText,
    explanationSource,
    fromCache: false,
  };
}
