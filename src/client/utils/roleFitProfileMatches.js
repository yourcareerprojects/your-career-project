import localizedContentService from './localizedContentService';
import { resolveRoleFitLang } from './roleFitExplanationCopy';

const MIN_BULLETS = 3;
const MAX_BULLETS = 5;
export const MAX_WORDS_PER_BULLET = 10;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function pickEntryLabel(item, lang = 'en') {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object') {
    const raw = item.label ?? item.title ?? item.name ?? item.preferredLabel;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const code = String(lang || 'en').toLowerCase().split('-')[0];
      if (raw[code] != null && typeof raw[code] === 'string') return String(raw[code]).trim();
      if (raw.en != null && typeof raw.en === 'string') return String(raw.en).trim();
    }
    if (typeof item.key === 'string' && item.key.trim()) return item.key.trim();
  }
  return '';
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueStrings(values) {
  return Array.from(new Set(safeArray(values).map((v) => cleanText(v)).filter(Boolean)));
}

function normalizeToken(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value) {
  const norm = normalizeToken(value);
  if (!norm) return new Set();
  return new Set(norm.split(' ').filter((t) => t.length > 2));
}

function jaccardSimilarity(a, b) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function matchScore(userLabel, roleLabel) {
  const user = normalizeToken(userLabel);
  const role = normalizeToken(roleLabel);
  if (!user || !role) return 0;
  if (user === role) return 1;
  if (user.includes(role) || role.includes(user)) return 0.92;
  const jac = jaccardSimilarity(userLabel, roleLabel);
  if (jac >= 0.45) return 0.75 + jac * 0.2;
  if (jac >= 0.2) return 0.45 + jac * 0.4;
  return jac * 0.5;
}

function extractDimensionRawItems(dimension, lang = 'en') {
  if (!dimension) return [];
  if (Array.isArray(dimension)) {
    return uniqueStrings(dimension.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        return pickEntryLabel(item, lang) || cleanText(item.label || item.name || item.domain);
      }
      return '';
    }));
  }
  if (typeof dimension === 'object') {
    const raw = safeArray(dimension.raw_items).map((v) => cleanText(v));
    if (raw.length > 0) return uniqueStrings(raw);
    const summary = localizedContentService.get(dimension.summary_text, lang);
    if (summary) return uniqueStrings(summary.split(/[,;•\n]+/));
  }
  if (typeof dimension === 'string') return uniqueStrings([dimension]);
  return [];
}

function getProfileRoot(userProfile) {
  if (!userProfile || typeof userProfile !== 'object') return {};
  return userProfile.profile && typeof userProfile.profile === 'object'
    ? userProfile.profile
    : userProfile;
}

export function extractUserMatchInventory(userProfile, lang = 'en') {
  const activeLang = resolveRoleFitLang(lang);
  const profile = getProfileRoot(userProfile);
  const structured = profile.structuredUserInfo && typeof profile.structuredUserInfo === 'object'
    ? profile.structuredUserInfo
    : {};
  const simulation = profile.careerSimulationInputs && typeof profile.careerSimulationInputs === 'object'
    ? profile.careerSimulationInputs
    : {};
  const simulationStructured = simulation.structuredUserInfo && typeof simulation.structuredUserInfo === 'object'
    ? simulation.structuredUserInfo
    : {};

  const skills = uniqueStrings([
    ...extractDimensionRawItems(structured.skills, activeLang),
    ...extractDimensionRawItems(structured.skillsInDevelopment, activeLang),
    ...extractDimensionRawItems(simulationStructured.skills, activeLang),
    ...extractDimensionRawItems(simulationStructured.skillsInDevelopment, activeLang),
    ...safeArray(simulation.structuredUserInfo?.skills),
    ...safeArray(structured.skills),
  ]);

  const responsibilities = uniqueStrings([
    ...extractDimensionRawItems(structured.keyResponsibilities, activeLang),
    ...extractDimensionRawItems(simulationStructured.keyResponsibilities, activeLang),
  ]);

  const domains = uniqueStrings([
    ...extractDimensionRawItems(structured.domains, activeLang),
    ...extractDimensionRawItems(structured.skillDomains, activeLang),
    ...extractDimensionRawItems(simulationStructured.domains, activeLang),
    ...extractDimensionRawItems(simulationStructured.skillDomains, activeLang),
    ...safeArray(profile.careerPreferences?.domains),
  ]);

  const identityAnswers = profile.userIdentityAnswers && typeof profile.userIdentityAnswers === 'object'
    ? profile.userIdentityAnswers
    : {};
  const identitySnippets = uniqueStrings([
    identityAnswers.naturallyGoodAt,
    identityAnswers.workEnjoyMost,
    identityAnswers.topicsIndustriesInterest,
    localizedContentService.get(profile?.who_are_you?.summary_text, activeLang),
    localizedContentService.get(profile?.careerGoal, activeLang),
    profile.mostSeniorWorkExperience,
    profile.currentStatus,
  ]);

  return { skills, responsibilities, domains, identitySnippets };
}

export function extractRoleMatchInventory(role, lang = 'en') {
  const activeLang = resolveRoleFitLang(lang);
  if (!role || typeof role !== 'object') {
    return { skills: [], responsibilities: [], domains: [] };
  }

  const skills = uniqueStrings([
    ...safeArray(role.matchedSkills).map((s) => (typeof s === 'string' ? s : pickEntryLabel(s, activeLang))),
    ...safeArray(role.matchedInputs).map((s) => (typeof s === 'string' ? s : pickEntryLabel(s, activeLang))),
    ...safeArray(role.matchedProfileInputs).map((s) => (typeof s === 'string' ? s : pickEntryLabel(s, activeLang))),
    ...safeArray(role.requiredSkills).map((s) => pickEntryLabel(s, activeLang)),
    ...safeArray(role.skillModel?.core_skills).map((s) => pickEntryLabel(s, activeLang)),
    ...safeArray(role.skillModel?.optional_skills).map((s) => pickEntryLabel(s, activeLang)),
  ]);

  const responsibilities = uniqueStrings(
    safeArray(role?.keyResponsibilities?.responsibilities).map(cleanText)
  );

  const rawDomains = Array.isArray(role?.skillDomains?.skill_domains)
    ? role.skillDomains.skill_domains
    : Array.isArray(role?.skillDomains)
      ? role.skillDomains
      : [];
  const domains = uniqueStrings(
    rawDomains.map((d) => cleanText(typeof d === 'string' ? d : d?.domain || d?.label || ''))
  );

  return { skills, responsibilities, domains };
}

function pushMatch(matches, seen, entry) {
  const key = `${entry.type}|${normalizeToken(entry.userLabel)}|${normalizeToken(entry.roleLabel)}`;
  if (seen.has(key)) return;
  seen.add(key);
  matches.push(entry);
}

function pairInventory(userItems, roleItems, type) {
  const matches = [];
  const seen = new Set();
  for (const roleLabel of roleItems) {
    let best = null;
    for (const userLabel of userItems) {
      const score = matchScore(userLabel, roleLabel);
      if (!best || score > best.score) {
        best = { type, userLabel, roleLabel, score };
      }
    }
    if (best && best.score >= 0.35) {
      pushMatch(matches, seen, best);
    }
  }
  return matches;
}

/**
 * Ranked overlaps between user profile items and role requirements.
 * @returns {{ type: string, userLabel: string, roleLabel: string, score: number }[]}
 */
export function buildProfileRoleMatchCandidates(userProfile, role, lang = 'en') {
  const user = extractUserMatchInventory(userProfile, lang);
  const roleItems = extractRoleMatchInventory(role, lang);
  const matches = [
    ...pairInventory(user.skills, roleItems.skills, 'skill'),
    ...pairInventory(user.responsibilities, roleItems.responsibilities, 'responsibility'),
    ...pairInventory(user.domains, roleItems.domains, 'domain'),
    ...pairInventory(user.skills, roleItems.responsibilities, 'skill-responsibility'),
    ...pairInventory(user.responsibilities, roleItems.skills, 'responsibility-skill'),
  ];

  return matches
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type))
    .slice(0, 12);
}

function shortenPhrase(text, maxWords = 10) {
  const words = cleanText(text).split(' ').filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function shortLabel(text, maxWords = 4) {
  return shortenPhrase(text, maxWords).replace(/…$/g, '').trim();
}

const TRAIT_SIMPLE_EN = {
  'handles complexity': 'handle hard problems',
  'thinks in systems': 'see how things connect',
  'takes ownership': 'take charge',
  'sets priorities': 'focus on what matters',
  'aligns people': 'work well with others',
  'creates clarity': 'make things clear',
  'adapts quickly': 'adapt fast',
  'uses judgment': 'make good calls',
  'focuses on detail': 'spot small mistakes',
  'maintains momentum': 'keep things moving',
  'follows through reliably': 'finish what you start',
  'communicates clearly': 'explain things clearly',
};

const TRAIT_SIMPLE_DE = {
  'geht mit komplexität um': 'mit schwierigen Aufgaben umgehen',
  'denkt in systemen': 'Zusammenhänge erkennen',
  'übernimmt verantwortung': 'Verantwortung übernehmen',
  'setzt prioritäten': 'das Wichtigste erkennen',
  'bringt menschen zusammen': 'gut im Team arbeiten',
  'schafft klarheit': 'Dinge klar machen',
  'passt sich an': 'dich schnell anpassen',
  'trifft fundierte entscheidungen': 'gute Entscheidungen treffen',
  'arbeitet detailgenau': 'auf Details achten',
  'hält fortschritt aufrecht': 'Dinge voranbringen',
  'arbeitet verlässlich': 'zuverlässig liefern',
  'kommuniziert klar': 'klar kommunizieren',
};

function simpleTraitPhrase(anchor, lang = 'en') {
  const key = cleanText(anchor).toLowerCase();
  const L = resolveRoleFitLang(lang);
  if (L === 'de') {
    return TRAIT_SIMPLE_DE[key] || shortLabel(anchor, 3);
  }
  return TRAIT_SIMPLE_EN[key] || shortLabel(anchor.replace(/^(takes?|handles?|uses?|focuses? on)\s+/i, ''), 3);
}

const TRAILING_FILLER_RE =
  /\s+(in this role|for this role|in dieser rolle|für diese rolle|work in this role)$/i;

/**
 * Shorten and plain-language pass for fit bullets (LLM + fallback).
 */
export function simplifyFitBullet(text, lang = 'en') {
  let result = cleanText(text);
  if (!result) return '';

  result = result.split(/[—–;]/)[0].trim();
  const commaParts = result.split(',').map((p) => p.trim()).filter(Boolean);
  if (commaParts.length > 1 && commaParts[0].split(/\s+/).length >= 4) {
    result = commaParts[0];
  }

  result = result.replace(TRAILING_FILLER_RE, '');

  const words = result.split(/\s+/).filter(Boolean);
  if (words.length > MAX_WORDS_PER_BULLET) {
    const trimmed = words.slice(0, MAX_WORDS_PER_BULLET);
    while (trimmed.length > 4 && /^(and|or|to|for|with|mit|für|und|oder|bei)$/i.test(trimmed[trimmed.length - 1])) {
      trimmed.pop();
    }
    result = trimmed.join(' ');
  }

  if (!/[.!?]$/.test(result)) {
    result = `${result}.`;
  }

  return cleanText(result);
}

/**
 * Deterministic bullets when the LLM path is unavailable.
 * Short, plain language — readable by teenagers.
 * @param {{ type: string, userLabel: string, roleLabel: string, score: number }[]} matches
 * @param {{ anchor?: string, patternSentence?: string }[]} selectedTraits
 * @param {{ summary?: string, connection?: string }} roleBehavior
 */
export function buildDeterministicFitBullets(matches, selectedTraits, roleBehavior, lang = 'en') {
  const L = resolveRoleFitLang(lang);
  const bullets = [];
  const used = new Set();

  const addBullet = (text) => {
    const cleaned = simplifyFitBullet(text, L);
    if (!cleaned || used.has(cleaned.toLowerCase())) return;
    used.add(cleaned.toLowerCase());
    bullets.push(cleaned);
  };

  for (const match of safeArray(matches)) {
    if (bullets.length >= MAX_BULLETS) break;
    const user = shortLabel(match.userLabel, 3);
    if (!user) continue;

    if (match.type === 'skill' || match.type === 'responsibility-skill') {
      addBullet(
        L === 'de'
          ? `Dein ${user} passt zu diesem Job.`
          : `Your ${user} skills fit this job.`
      );
    } else if (match.type === 'responsibility' || match.type === 'skill-responsibility') {
      addBullet(
        L === 'de'
          ? `Deine Erfahrung mit ${user} passt hier.`
          : `Your ${user} experience fits this job.`
      );
    } else if (match.type === 'domain') {
      addBullet(
        L === 'de'
          ? `Dein Bereich ${user} passt zu diesem Job.`
          : `Your ${user} background fits this job.`
      );
    }
  }

  for (const trait of safeArray(selectedTraits)) {
    if (bullets.length >= MAX_BULLETS) break;
    const phrase = simpleTraitPhrase(trait.anchor, L);
    if (!phrase) continue;
    addBullet(
      L === 'de'
        ? `Du kannst ${phrase}.`
        : `You can ${phrase}.`
    );
  }

  if (bullets.length < MIN_BULLETS) {
    addBullet(
      L === 'de'
        ? 'Deine Stärken passen zu diesem Job.'
        : 'Your strengths fit this job.'
    );
  }

  if (bullets.length < MIN_BULLETS) {
    const summary = shortLabel(roleBehavior?.summary, 3);
    if (summary) {
      addBullet(
        L === 'de'
          ? `Du passt gut zu ${summary}.`
          : `You fit well with ${summary}.`
      );
    }
  }

  return bullets.slice(0, MAX_BULLETS).map((b) => simplifyFitBullet(b, L));
}

export const ROLE_FIT_BULLET_LIMITS = { MIN_BULLETS, MAX_BULLETS };

export const BULLETS_FORMAT_PREFIX = 'bullets:v2:';

export function serializeRoleFitBullets(bullets) {
  const list = safeArray(bullets).map((b) => cleanText(b)).filter(Boolean);
  return `${BULLETS_FORMAT_PREFIX}${JSON.stringify(list)}`;
}

export function parseRoleFitBullets(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (raw.startsWith(BULLETS_FORMAT_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(BULLETS_FORMAT_PREFIX.length));
      return Array.isArray(parsed) ? parsed.map((b) => cleanText(b)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}
