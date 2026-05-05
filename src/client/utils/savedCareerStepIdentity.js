const getRoleTitleForLocale = (title, language = 'en') => {
  if (title == null || title === '') return '';
  if (typeof title === 'string' || typeof title === 'number') return String(title);
  if (typeof title === 'object' && !Array.isArray(title)) {
    const nonEmpty = (v) => {
      if (v == null) return '';
      const s = typeof v === 'string' ? v : String(v);
      return s.trim() === '' ? '' : s.trim();
    };
    const code = (language && String(language).toLowerCase().split('-')[0]) || 'en';
    if (Object.prototype.hasOwnProperty.call(title, code)) {
      const t = nonEmpty(title[code]);
      if (t) return t;
    }
    for (const k of ['en', 'de', 'fr', 'it', 'es']) {
      if (k === code) continue;
      if (Object.prototype.hasOwnProperty.call(title, k)) {
        const t = nonEmpty(title[k]);
        if (t) return t;
      }
    }
    for (const v of Object.values(title)) {
      const t = nonEmpty(v);
      if (t) return t;
    }
    return '';
  }
  return String(title);
};

const getRoleTitleEnglishForMatch = (value) => getRoleTitleForLocale(value, 'en');
const normalizeTextForI18nMatch = (str) =>
  getRoleTitleEnglishForMatch(str).toLowerCase().trim().replace(/\s+/g, ' ');

const normalizeSavedStepCategory = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (
    raw === 'outsidesimulationbox' ||
    raw === 'outside-the-box' ||
    raw === 'outside_the_box' ||
    raw === 'outsidetheboxroles'
  ) {
    return 'outsidethebox';
  }
  if (raw === 'nextcareerroles' || raw === 'next-career-roles' || raw === 'next_career_roles') {
    return 'nextsteps';
  }
  return raw.replace(/[^a-z0-9]/g, '');
};

const normalizeId = (value) => String(value || '').trim().toLowerCase();

const identityTokensForStep = (step = {}, routeStepId = '') => {
  const tokens = new Set(
    [
      step.stepId,
      step.id,
      step.resultId,
      step.simulationResultId,
      step.instanceId,
      step.savedKey,
      routeStepId,
    ]
      .map(normalizeId)
      .filter(Boolean)
  );
  if (routeStepId) {
    try {
      const decoded = decodeURIComponent(routeStepId);
      if (decoded) tokens.add(normalizeId(decoded));
    } catch {
      // ignore invalid URI component
    }
  }
  return tokens;
};

const buildSavedCareerStepKey = (step = {}) => {
  const clusterRaw = step.careerPathId || step.clusterId || step.careerClusterId || step.clusterKey;
  const clusterId = normalizeId(clusterRaw);
  if (clusterId) return `cluster:${clusterId}`;
  const titleKey = normalizeTextForI18nMatch(step.title || getRoleTitleEnglishForMatch(step.title));
  if (!titleKey) return '';
  const category = normalizeSavedStepCategory(step.category || step.listCategory);
  return `title:${titleKey}|cat:${category || 'unknown'}`;
};

const findMatchingSavedCareerStep = (role, savedSteps, options = {}) => {
  if (!role || !Array.isArray(savedSteps) || savedSteps.length === 0) return null;
  const { routeStepId = '' } = options;
  const roleTokens = identityTokensForStep(role, routeStepId);

  if (roleTokens.size) {
    const byToken = savedSteps.find((saved) => {
      const savedTokens = identityTokensForStep(saved);
      for (const token of savedTokens) {
        if (roleTokens.has(token)) return true;
      }
      return false;
    });
    if (byToken) return byToken;
  }

  const roleKey = buildSavedCareerStepKey(role);
  if (roleKey) {
    const byKey = savedSteps.find((saved) => {
      const savedKey = String(saved?.savedKey || '').trim();
      if (savedKey && savedKey === roleKey) return true;
      return buildSavedCareerStepKey(saved) === roleKey;
    });
    if (byKey) return byKey;
  }

  const roleCareerPathId = normalizeId(role.careerPathId);
  if (roleCareerPathId) {
    const byCareerPath = savedSteps.find((saved) => normalizeId(saved?.careerPathId) === roleCareerPathId);
    if (byCareerPath) return byCareerPath;
  }

  const roleEscoId = normalizeId(role.escoId);
  if (roleEscoId) {
    const byEsco = savedSteps.find((saved) => normalizeId(saved?.escoId) === roleEscoId);
    if (byEsco) return byEsco;
  }

  const roleTitle = normalizeTextForI18nMatch(role.title);
  const roleDescription = normalizeTextForI18nMatch(role.description);
  const roleCategory = normalizeSavedStepCategory(role.category || role.listCategory);
  if (roleTitle) {
    const byTitleCategory = savedSteps.find((saved) => {
      const savedTitle = normalizeTextForI18nMatch(saved?.title);
      if (savedTitle !== roleTitle) return false;
      const savedCategory = normalizeSavedStepCategory(saved?.category || saved?.listCategory);
      return !roleCategory || !savedCategory || savedCategory === roleCategory;
    });
    if (byTitleCategory) return byTitleCategory;
  }
  if (roleTitle && roleDescription) {
    const byTitleDescription = savedSteps.find((saved) => {
      const savedTitle = normalizeTextForI18nMatch(saved?.title);
      const savedDescription = normalizeTextForI18nMatch(saved?.description);
      return savedTitle === roleTitle && savedDescription === roleDescription;
    });
    if (byTitleDescription) return byTitleDescription;
  }

  return null;
};

module.exports = {
  normalizeSavedStepCategory,
  buildSavedCareerStepKey,
  findMatchingSavedCareerStep,
};

