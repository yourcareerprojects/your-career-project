const localizedContentService = require('../localization/localizedContentService');
const { translateBetweenLocales } = require('../ai/translateText');

const USER_IDENTITY_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

async function localizeSingleLine(text, documentLanguage) {
  const raw = String(text || '').trim();
  if (!raw) return { en: '', de: '' };
  const doc = documentLanguage === 'de' ? 'de' : 'en';
  if (doc === 'en') {
    const en = raw;
    const de = String((await translateBetweenLocales(en, 'en', 'de')) || '').trim() || en;
    return { en, de };
  }
  const de = raw;
  const en = String((await translateBetweenLocales(de, 'de', 'en')) || '').trim() || de;
  return { en, de };
}

function pickUi(pair, uiLang) {
  return localizedContentService.normalizeForResponse(pair, uiLang) || pair.en || pair.de || '';
}

/**
 * Builds `{ en, de }` pairs from CV-extracted strings (original lives in documentLanguage slot),
 * then returns a flattened profile for the requested UI language.
 *
 * @param {object} profile merged extraction profile slice
 * @param {'en'|'de'} documentLanguage detected CV language
 * @param {'en'|'de'} uiLanguage active UI locale for flattened strings
 */
async function localizeCvExtractedProfile(profile, documentLanguage, uiLanguage) {
  const uiLang = String(uiLanguage || 'en').toLowerCase().split('-')[0] || 'en';
  const docLang = documentLanguage === 'de' ? 'de' : 'en';

  const cvI18n = {
    documentLanguage: docLang,
    userIdentity: {},
    structuredUserInfo: {
      skillDomains: [],
      domains: [],
      keyResponsibilities: [],
      skillsInDevelopment: [],
      skills: [],
    },
  };

  const identity = profile?.userIdentity && typeof profile.userIdentity === 'object' ? profile.userIdentity : {};

  await Promise.all(
    USER_IDENTITY_KEYS.map(async (key) => {
      cvI18n.userIdentity[key] = await localizeSingleLine(identity[key], docLang);
    })
  );

  const sui = profile?.structuredUserInfo && typeof profile.structuredUserInfo === 'object' ? profile.structuredUserInfo : {};

  cvI18n.structuredUserInfo.skillDomains = await Promise.all(
    (Array.isArray(sui.skillDomains) ? sui.skillDomains : []).map((row) => localizeSingleLine(row, docLang))
  );
  cvI18n.structuredUserInfo.domains = await Promise.all(
    (Array.isArray(sui.domains) ? sui.domains : []).map((row) => localizeSingleLine(row, docLang))
  );
  cvI18n.structuredUserInfo.keyResponsibilities = await Promise.all(
    (Array.isArray(sui.keyResponsibilities) ? sui.keyResponsibilities : []).map((row) =>
      localizeSingleLine(row, docLang)
    )
  );
  cvI18n.structuredUserInfo.skillsInDevelopment = await Promise.all(
    (Array.isArray(sui.skillsInDevelopment) ? sui.skillsInDevelopment : []).map((row) =>
      localizeSingleLine(row, docLang)
    )
  );

  cvI18n.structuredUserInfo.skills = await Promise.all(
    (Array.isArray(sui.skills) ? sui.skills : []).map(async (skill) => {
      const name = typeof skill === 'string' ? skill : skill?.name || '';
      return {
        name: await localizeSingleLine(name, docLang),
      };
    })
  );

  const flatProfile = {
    ...profile,
    userIdentity: {
      ...identity,
    },
    structuredUserInfo: {
      ...sui,
      skillDomains: cvI18n.structuredUserInfo.skillDomains.map((p) => pickUi(p, uiLang)),
      domains: cvI18n.structuredUserInfo.domains.map((p) => pickUi(p, uiLang)),
      keyResponsibilities: cvI18n.structuredUserInfo.keyResponsibilities.map((p) => pickUi(p, uiLang)),
      skillsInDevelopment: cvI18n.structuredUserInfo.skillsInDevelopment.map((p) => pickUi(p, uiLang)),
      skills: cvI18n.structuredUserInfo.skills.map((row) => ({
        name: pickUi(row.name, uiLang),
      })),
    },
  };

  for (const key of USER_IDENTITY_KEYS) {
    flatProfile.userIdentity[key] = pickUi(cvI18n.userIdentity[key], uiLang);
  }

  return {
    profile: flatProfile,
    cvI18n,
  };
}

function normalizePair(p) {
  if (!p || typeof p !== 'object') return { en: '', de: '' };
  return {
    en: p.en != null ? String(p.en) : '',
    de: p.de != null ? String(p.de) : '',
  };
}

/**
 * Deep-merge optional CV i18n patches from client (extraction review + profile save).
 * @param {object|null|undefined} existing
 * @param {object|null|undefined} patch
 */
function mergeCvExtractLocalizationPatch(existing, patch) {
  if (!patch || typeof patch !== 'object') return existing;

  const base =
    existing && typeof existing === 'object'
      ? JSON.parse(JSON.stringify(existing))
      : {};

  if (patch.documentLanguage === 'de' || patch.documentLanguage === 'en') {
    base.documentLanguage = patch.documentLanguage;
  }

  if (patch.userIdentity && typeof patch.userIdentity === 'object') {
    base.userIdentity = base.userIdentity || {};
    for (const k of USER_IDENTITY_KEYS) {
      if (patch.userIdentity[k] === undefined || patch.userIdentity[k] === null) continue;
      base.userIdentity[k] = normalizePair({
        ...normalizePair(base.userIdentity[k]),
        ...normalizePair(patch.userIdentity[k]),
      });
    }
  }

  if (patch.structuredUserInfo && typeof patch.structuredUserInfo === 'object') {
    base.structuredUserInfo = base.structuredUserInfo || {};
    const dims = ['skillDomains', 'domains', 'keyResponsibilities', 'skillsInDevelopment', 'skills'];
    for (const d of dims) {
      if (Array.isArray(patch.structuredUserInfo[d])) {
        base.structuredUserInfo[d] = patch.structuredUserInfo[d];
      }
    }
  }

  return base;
}

function pickLocalizedFromPair(pair, lang) {
  const code = String(lang || 'en').toLowerCase().split('-')[0] || 'en';
  const p = normalizePair(pair);
  return (
    localizedContentService.normalizeForResponse(p, code) ||
    String(p.en || '').trim() ||
    String(p.de || '').trim() ||
    ''
  );
}

/**
 * Replaces `raw_items` chip strings using parallel `{ en, de }` rows in
 * `cvRoot.structuredUserInfo` when the stored flat list matches the UI locale
 * the profile was last saved in (e.g. German) and the user switches to English.
 */
function overlayStructuredUserInfoListsWithCvLocalization(structuredUserInfo, cvRoot, lang) {
  if (!structuredUserInfo || typeof structuredUserInfo !== 'object') return structuredUserInfo;
  const cvLoc = cvRoot?.structuredUserInfo;
  if (!cvLoc || typeof cvLoc !== 'object') return structuredUserInfo;

  const stringDims = ['skillDomains', 'domains', 'keyResponsibilities', 'skillsInDevelopment'];
  let out = { ...structuredUserInfo };

  for (const dim of stringDims) {
    const bucket = out[dim];
    if (!bucket || typeof bucket !== 'object') continue;
    const pairs = cvLoc[dim];
    if (!Array.isArray(pairs) || pairs.length === 0) continue;
    const raw = Array.isArray(bucket.raw_items) ? bucket.raw_items : [];
    const nextRaw = raw.map((item, idx) => {
      const row = pairs[idx];
      if (!row || typeof row !== 'object') return item;
      const picked = pickLocalizedFromPair(row, lang);
      if (typeof item === 'string') return picked || item;
      return item;
    });
    out[dim] = { ...bucket, raw_items: nextRaw };
  }

  const skillsBucket = out.skills;
  const skillPairs = cvLoc.skills;
  if (skillsBucket && typeof skillsBucket === 'object' && Array.isArray(skillPairs) && skillPairs.length > 0) {
    const raw = Array.isArray(skillsBucket.raw_items) ? skillsBucket.raw_items : [];
    const nextRaw = raw.map((item, idx) => {
      const row = skillPairs[idx];
      const namePair = row?.name;
      const fallbackLabel =
        typeof item === 'string'
          ? String(item).trim()
          : typeof item === 'object' && item != null
            ? String(item.name ?? '').trim()
            : '';
      if (!namePair || typeof namePair !== 'object') return fallbackLabel;
      const picked = String(pickLocalizedFromPair(namePair, lang) || '').trim();
      return picked || fallbackLabel;
    });
    out.skills = { ...skillsBucket, raw_items: nextRaw };
  }

  return out;
}

/** Prefers stored `{ en, de }` pairs for the active UI language when present. */
function overlayIdentityAnswersWithCvLocalization(mergedFlat, cvLocUserIdentity, lang) {
  if (!cvLocUserIdentity || typeof cvLocUserIdentity !== 'object') return mergedFlat;
  const flat = mergedFlat && typeof mergedFlat === 'object' ? { ...mergedFlat } : {};
  const code = String(lang || 'en').toLowerCase().split('-')[0] || 'en';
  for (const k of USER_IDENTITY_KEYS) {
    const pair = normalizePair(cvLocUserIdentity[k]);
    if (!String(pair.en || '').trim() && !String(pair.de || '').trim()) continue;
    const picked =
      localizedContentService.normalizeForResponse(pair, code) ||
      String(pair.en || '').trim() ||
      String(pair.de || '').trim() ||
      '';
    if (String(picked).trim()) flat[k] = String(picked).trim();
  }
  return flat;
}

/**
 * After manual edits to flat identity answers, mirror the edited text into cvExtractLocalization
 * so the user's locale stays the source of truth for that slice.
 *
 * @param {object|null|undefined} cvRoot Stored `profile.cvExtractLocalization`
 */
function syncCvExtractUserIdentityFromFlat(cvRoot, flatAnswers, uiLang) {
  if (!cvRoot || typeof cvRoot !== 'object') return false;
  if (!cvRoot.userIdentity || typeof cvRoot.userIdentity !== 'object') return false;

  const code = String(uiLang || 'en').toLowerCase().split('-')[0] || 'en';
  const slot = code === 'de' ? 'de' : 'en';
  let changed = false;
  for (const k of USER_IDENTITY_KEYS) {
    const v = String(flatAnswers[k] ?? '').trim();
    if (!v) continue;
    cvRoot.userIdentity[k] = normalizePair({
      ...normalizePair(cvRoot.userIdentity[k]),
      [slot]: v,
    });
    changed = true;
  }
  return changed;
}

module.exports = {
  USER_IDENTITY_KEYS,
  localizeCvExtractedProfile,
  mergeCvExtractLocalizationPatch,
  overlayIdentityAnswersWithCvLocalization,
  overlayStructuredUserInfoListsWithCvLocalization,
  syncCvExtractUserIdentityFromFlat,
};
