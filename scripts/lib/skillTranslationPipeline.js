const fs = require('fs');
const path = require('path');

const TMP_DIR = path.join(process.cwd(), 'tmp');
const BAD_SKILLS_PATH = path.join(TMP_DIR, 'bad_skills.json');
const SUGGESTIONS_PATH = path.join(TMP_DIR, 'skill_suggestions.json');
const BAD_SKILL_DOMAINS_PATH = path.join(TMP_DIR, 'bad_skill_domains.json');
const SKILL_DOMAIN_SUGGESTIONS_PATH = path.join(TMP_DIR, 'skill_domain_suggestions.json');
const BAD_ROLE_TITLES_PATH = path.join(TMP_DIR, 'bad_role_titles.json');
const ROLE_TITLE_SUGGESTIONS_PATH = path.join(TMP_DIR, 'role_title_suggestions.json');
const BAD_ROLE_RESPONSIBILITIES_PATH = path.join(TMP_DIR, 'bad_role_responsibilities.json');
const ROLE_RESPONSIBILITY_SUGGESTIONS_PATH = path.join(TMP_DIR, 'role_responsibility_suggestions.json');
const BAD_ROLE_DESCRIPTIONS_PATH = path.join(TMP_DIR, 'bad_role_descriptions.json');
const ROLE_DESCRIPTION_SUGGESTIONS_PATH = path.join(TMP_DIR, 'role_description_suggestions.json');

function ensureTmpDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function normalizeLabel(label) {
  return String(label || '').replace(/\s+/g, ' ').trim();
}

/** Trims and normalizes line breaks; does not collapse paragraph breaks (for role descriptions). */
function normalizeDescriptionBody(text) {
  if (text == null) return '';
  return String(text).replace(/\r\n/g, '\n').trim();
}

function collapseDescriptionForCompare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\r\n/g, '\n')
    .replace(/[\s\n]+/g, ' ')
    .trim();
}

function wordCount(text) {
  const norm = normalizeLabel(text);
  if (!norm) return 0;
  return norm.split(' ').filter(Boolean).length;
}

function isBadTranslation(enLabel, deLabel) {
  const en = normalizeLabel(enLabel);
  const de = normalizeLabel(deLabel);
  if (!de) return true;
  if (wordCount(de) > 5) return true;

  const deLower = de.toLowerCase();
  if (deLower.startsWith('[de]') || deLower.startsWith('[de placeholder]')) return true;
  if (deLower.includes('placeholder')) return true;
  if (deLower.includes('fallback')) return true;

  if (en && deLower === en.toLowerCase()) return true;
  return false;
}

/** For long role descriptions: missing/placeholder DE or identical to EN, but not a word-count cap. */
function isBadDescriptionTranslation(enText, deText) {
  const en = normalizeDescriptionBody(enText);
  const de = normalizeDescriptionBody(deText);
  if (!en) return false;
  if (!de) return true;
  const deLower = de.toLowerCase();
  if (deLower.startsWith('[de]') || deLower.startsWith('[de placeholder]')) return true;
  if (deLower.includes('placeholder') || deLower.includes('fallback')) return true;
  if (collapseDescriptionForCompare(en) === collapseDescriptionForCompare(de)) return true;
  return false;
}

function batchArray(items, size) {
  const out = [];
  const n = Math.max(1, Number(size) || 1);
  for (let i = 0; i < items.length; i += n) {
    out.push(items.slice(i, i + n));
  }
  return out;
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const payload = arg.slice(2);
    if (!payload.includes('=')) {
      out[payload] = true;
      continue;
    }
    const [k, v] = payload.split('=');
    out[k] = v;
  }
  return out;
}

module.exports = {
  TMP_DIR,
  BAD_SKILLS_PATH,
  SUGGESTIONS_PATH,
  BAD_SKILL_DOMAINS_PATH,
  SKILL_DOMAIN_SUGGESTIONS_PATH,
  BAD_ROLE_TITLES_PATH,
  ROLE_TITLE_SUGGESTIONS_PATH,
  BAD_ROLE_RESPONSIBILITIES_PATH,
  ROLE_RESPONSIBILITY_SUGGESTIONS_PATH,
  BAD_ROLE_DESCRIPTIONS_PATH,
  ROLE_DESCRIPTION_SUGGESTIONS_PATH,
  ensureTmpDir,
  normalizeLabel,
  normalizeDescriptionBody,
  isBadTranslation,
  isBadDescriptionTranslation,
  batchArray,
  parseArgs,
};
