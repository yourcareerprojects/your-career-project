/**
 * Lightweight CV/resume language detection for English vs German.
 * Uses script cues + token frequencies on an early slice of text (no external deps).
 *
 * @param {string} text
 * @param {{ maxSample?: number }} [opts]
 * @returns {'en'|'de'}
 */
function detectCvDocumentLanguage(text, opts = {}) {
  const maxSample = opts.maxSample ?? 12000;
  const sample = String(text || '').slice(0, maxSample).toLowerCase();
  if (!sample.trim()) return 'en';

  let scoreDe = 0;
  let scoreEn = 0;

  const germanChars = /[äöüß]/g;
  const gc = sample.match(germanChars);
  if (gc) scoreDe += Math.min(8, gc.length);

  const deWords =
    /\b(und|oder|der|die|das|den|dem|des|ein|eine|einer|mit|bei|von|zu|zum|zur|für|über|jahre|berufserfahrung|ausbildung|studium|sprachen|kenntnisse|lebenslauf|berufliche|erfahrung|qualifikationen|schulbildung|weiterbildung)\b/g;
  const deHits = sample.match(deWords);
  if (deHits) scoreDe += Math.min(12, deHits.length);

  const enWords =
    /\b(and|with|the|for|experience|education|skills|summary|professional|employment|responsibilities|university|degree|fluent|resume|curriculum|vitae|overview|highlights|qualifications|achievements|accomplishments|objectives|profile|career|employment history|work history|internship|certifications|languages|references)\b/g;
  const enHits = sample.match(enWords);
  if (enHits) scoreEn += Math.min(12, enHits.length);

  const biasedDeHeadings =
    /\b(lebenslauf|berufserfahrung|ausbildung|studium|sprachkenntnisse|referenzen)\b/;
  if (biasedDeHeadings.test(sample)) scoreDe += 4;

  const biasedEnHeadings =
    /\b(resume|curriculum vitae|work experience|education|languages|references)\b/;
  if (biasedEnHeadings.test(sample)) scoreEn += 4;

  if (scoreDe >= scoreEn + 2) return 'de';
  return 'en';
}

module.exports = {
  detectCvDocumentLanguage,
};
