function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCategory(value) {
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
}

function embeddedOrLegacyEn(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && !Array.isArray(field)) {
    if (field.en != null && String(field.en).trim() !== '') return String(field.en);
    if (field.de != null && String(field.de).trim() !== '') return String(field.de);
  }
  return '';
}

function normalizeTitle(field) {
  return embeddedOrLegacyEn(field).toLowerCase().trim().replace(/\s+/g, ' ');
}

function buildSavedCareerStepKey(step = {}) {
  const clusterRaw = step.careerPathId || step.clusterId || step.careerClusterId || step.clusterKey;
  const clusterId = normalizeId(clusterRaw);
  if (clusterId) return `cluster:${clusterId}`;
  const title = normalizeTitle(step.title);
  if (!title) return '';
  const category = normalizeCategory(step.category || step.listCategory);
  return `title:${title}|cat:${category || 'unknown'}`;
}

module.exports = {
  buildSavedCareerStepKey,
  normalizeCategory,
};

