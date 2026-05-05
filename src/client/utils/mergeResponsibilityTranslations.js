/**
 * Prefer German per bullet when present; otherwise use English at the same index.
 * EN/DE lists may differ in length (partial translations in CareerPath data).
 * @param {unknown[]} enList
 * @param {unknown[]} deList
 * @returns {string[]}
 */
function mergeResponsibilityTranslations(enList, deList) {
  const en = Array.isArray(enList) ? enList : [];
  const de = Array.isArray(deList) ? deList : [];
  if (de.length === 0) {
    return en.map((r) => String(r ?? '').trim()).filter((s) => s.length > 0);
  }
  const n = Math.max(en.length, de.length);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const d = String(de[i] ?? '').trim();
    const e = String(en[i] ?? '').trim();
    if (d) out.push(d);
    else if (e) out.push(e);
  }
  return out;
}

module.exports = { mergeResponsibilityTranslations };
