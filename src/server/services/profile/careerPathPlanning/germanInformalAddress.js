/**
 * Enforce informal German address (Du-Form) in career-path coaching copy.
 * Prompt rules are primary; this is a safety net for common Sie-Form slips.
 */

/** Verb + Sie → Du-Form (applied before bare pronoun swaps). Capitalized forms first. */
const VERB_SIE_REPLACEMENTS = [
  [/\bKönnen Sie\b/g, 'Kannst du'],
  [/\bkönnen Sie\b/g, 'kannst du'],
  [/\bSie können\b/g, 'Du kannst'],
  [/\bsie können\b/g, 'du kannst'],
  [/\bKonnten Sie\b/g, 'Konntest du'],
  [/\bkonnten Sie\b/g, 'konntest du'],
  [/\bHaben Sie\b/g, 'Hast du'],
  [/\bhaben Sie\b/g, 'hast du'],
  [/\bSie haben\b/g, 'Du hast'],
  [/\bsie haben\b/g, 'du hast'],
  [/\bHatten Sie\b/g, 'Hattest du'],
  [/\bhatten Sie\b/g, 'hattest du'],
  [/\bSind Sie\b/g, 'Bist du'],
  [/\bsind Sie\b/g, 'bist du'],
  [/\bSie sind\b/g, 'Du bist'],
  [/\bsie sind\b/g, 'du bist'],
  [/\bWaren Sie\b/g, 'Warst du'],
  [/\bwaren Sie\b/g, 'warst du'],
  [/\bWerden Sie\b/g, 'Wirst du'],
  [/\bwerden Sie\b/g, 'wirst du'],
  [/\bSie werden\b/g, 'Du wirst'],
  [/\bWürden Sie\b/g, 'Würdest du'],
  [/\bwürden Sie\b/g, 'würdest du'],
  [/\bMöchten Sie\b/g, 'Möchtest du'],
  [/\bmöchten Sie\b/g, 'möchtest du'],
  [/\bSie möchten\b/g, 'Du möchtest'],
  [/\bMüssen Sie\b/g, 'Musst du'],
  [/\bmüssen Sie\b/g, 'musst du'],
  [/\bSie müssen\b/g, 'Du musst'],
  [/\bSollten Sie\b/g, 'Solltest du'],
  [/\bsollten Sie\b/g, 'solltest du'],
  [/\bSie sollten\b/g, 'Du solltest'],
  [/\bSollen Sie\b/g, 'Sollst du'],
  [/\bsollen Sie\b/g, 'sollst du'],
  [/\bDürfen Sie\b/g, 'Darfst du'],
  [/\bdürfen Sie\b/g, 'darfst du'],
  [/\bWollen Sie\b/g, 'Willst du'],
  [/\bwollen Sie\b/g, 'willst du'],
  [/\bBrauchen Sie\b/g, 'Brauchst du'],
  [/\bbrauchen Sie\b/g, 'brauchst du'],
  [/\bKönnten Sie\b/g, 'Könntest du'],
  [/\bkönnten Sie\b/g, 'könntest du'],
  [/\bMachen Sie\b/g, 'Machst du'],
  [/\bmachen Sie\b/g, 'machst du'],
  [/\bNehmen Sie\b/g, 'Nimm'],
  [/\bnehmen Sie\b/g, 'nimm'],
  [/\bGehen Sie\b/g, 'Geh'],
  [/\bgehen Sie\b/g, 'geh'],
  [/\bSchauen Sie\b/g, 'Schau'],
  [/\bschauen Sie\b/g, 'schau'],
  [/\bProbieren Sie\b/g, 'Probiere'],
  [/\bprobieren Sie\b/g, 'probiere'],
  [/\bStarten Sie\b/g, 'Starte'],
  [/\bstarten Sie\b/g, 'starte'],
  [/\bBeginnen Sie\b/g, 'Beginne'],
  [/\bbeginnen Sie\b/g, 'beginne'],
  [/\bÜberlegen Sie\b/g, 'Überlege'],
  [/\büberlegen Sie\b/g, 'überlege'],
  [/\bPrüfen Sie\b/g, 'Prüfe'],
  [/\bprüfen Sie\b/g, 'prüfe'],
  [/\bNutzen Sie\b/g, 'Nutze'],
  [/\bnutzen Sie\b/g, 'nutze'],
  [/\bSie nutzen\b/g, 'Du nutzt'],
  [/\bBauen Sie\b/g, 'Baue'],
  [/\bbauen Sie\b/g, 'baue'],
  [/\bEntwickeln Sie\b/g, 'Entwickle'],
  [/\bentwickeln Sie\b/g, 'entwickle'],
  [/\bFokussieren Sie\b/g, 'Fokussiere'],
  [/\bfokussieren Sie\b/g, 'fokussiere'],
  [/\bPlanen Sie\b/g, 'Plane'],
  [/\bplanen Sie\b/g, 'plane'],
  [/\bLernen Sie\b/g, 'Lerne'],
  [/\blernen Sie\b/g, 'lerne'],
  [/\bSammeln Sie\b/g, 'Sammle'],
  [/\bsammeln Sie\b/g, 'sammle'],
  [/\bFinden Sie\b/g, 'Finde'],
  [/\bfinden Sie\b/g, 'finde'],
  [/\bSuchen Sie\b/g, 'Suche'],
  [/\bsuchen Sie\b/g, 'suche'],
  [/\bWählen Sie\b/g, 'Wähle'],
  [/\bwählen Sie\b/g, 'wähle'],
  [/\bSetzen Sie\b/g, 'Setze'],
  [/\bsetzen Sie\b/g, 'setze'],
  [/\bHolen Sie\b/g, 'Hole'],
  [/\bholen Sie\b/g, 'hole'],
  [/\bPassen Sie\b/g, 'Passt du'],
  [/\bpassen Sie\b/g, 'passt du'],
  [/\bSie passen\b/g, 'Du passt'],
  [/\bsie passen\b/g, 'du passt'],
  [/\bKonzentrieren Sie sich\b/g, 'Konzentriere dich'],
  [/\bkonzentrieren Sie sich\b/g, 'konzentriere dich'],
  [/\bMelden Sie sich\b/g, 'Melde dich'],
  [/\bmelden Sie sich\b/g, 'melde dich'],
  [/\bInformieren Sie sich\b/g, 'Informiere dich'],
  [/\binformieren Sie sich\b/g, 'informiere dich'],
  [/\bBereiten Sie sich\b/g, 'Bereite dich'],
  [/\bbereiten Sie sich\b/g, 'bereite dich'],
  [/\bOrientieren Sie sich\b/g, 'Orientiere dich'],
  [/\borientieren Sie sich\b/g, 'orientiere dich'],
  [/\bBewerben Sie sich\b/g, 'Bewirb dich'],
  [/\bbewerben Sie sich\b/g, 'bewirb dich'],
  [/\bBewegen Sie sich\b/g, 'Beweg dich'],
];

/**
 * @param {string} text
 * @returns {string}
 */
function enforceGermanDuAddress(text) {
  if (typeof text !== 'string' || !text) return text;

  let out = text;

  for (const [pattern, replacement] of VERB_SIE_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }

  // Possessives / object pronouns before bare "Sie"
  out = out
    .replace(/\bIhnen\b/g, 'dir')
    .replace(/\bihnen\b/g, 'dir')
    .replace(/\bIhrem\b/g, 'deinem')
    .replace(/\bIhren\b/g, 'deinen')
    .replace(/\bIhrer\b/g, 'deiner')
    .replace(/\bIhres\b/g, 'deines')
    .replace(/\bIhre\b/g, 'deine')
    .replace(/\bIhr\b/g, 'dein')
    .replace(/\bSie\b/g, 'du');

  // Sentence-initial capitalization after swaps
  out = out.replace(/(^|[.!?…]\s+)(du|dein|deine|deinen|deinem|deiner|deines|dir)\b/g, (_, lead, word) => (
    `${lead}${word.charAt(0).toUpperCase()}${word.slice(1)}`
  ));

  return out;
}

/**
 * Recursively rewrite all string leaves in a coach plan / path plan object.
 * @param {unknown} value
 * @returns {unknown}
 */
function enforceGermanDuAddressDeep(value) {
  if (typeof value === 'string') {
    return enforceGermanDuAddress(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => enforceGermanDuAddressDeep(item));
  }
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = enforceGermanDuAddressDeep(child);
    }
    return next;
  }
  return value;
}

module.exports = {
  enforceGermanDuAddress,
  enforceGermanDuAddressDeep,
  VERB_SIE_REPLACEMENTS,
};
