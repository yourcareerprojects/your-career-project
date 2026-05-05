const { buildMessages } = require('../../prompts/generateCareerSlogan');
const { openaiProvider } = require('./roleIdentityComposer');
const { generateAI } = require('../ai/generateAI');

const DEFAULT_CAREER_SLOGAN_EN = 'Meaningful impact through action';
const DEFAULT_CAREER_SLOGAN_DE = 'Sinnvolle Wirkung durch konkretes Tun';
const MAX_INPUT_CHARS = 1200;

const STOP_WORDS_EN = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'to', 'of', 'in', 'on', 'at', 'for', 'from',
  'with', 'without', 'as', 'by', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this',
  'that', 'these', 'those', 'i', 'me', 'my', 'mine', 'we', 'our', 'ours', 'you', 'your', 'yours', 'they', 'their',
  'them', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'want', 'like', 'work', 'working', 'career',
]);

/** German function words & fillers — keeps condensed hints substantive */
const STOP_WORDS_DE = new Set([
  'aber', 'alle', 'allem', 'allen', 'aller', 'alles', 'als', 'also', 'am', 'an', 'auch', 'auf', 'aus',
  'bei', 'bin', 'bis', 'bist', 'da', 'damit', 'dann', 'das', 'dass', 'dein', 'deine', 'deinem', 'deinen',
  'deiner', 'deines', 'dem', 'den', 'der', 'des', 'dessen', 'die', 'dies', 'diese', 'diesem', 'diesen',
  'dieser', 'dieses', 'dir', 'doch', 'du', 'durch', 'ein', 'eine', 'einem', 'einen', 'einer', 'eines',
  'er', 'es', 'etwas', 'euch', 'euer', 'euere', 'eure', 'für', 'ganz', 'gegen', 'gewesen', 'hab', 'habe',
  'haben', 'hat', 'hatte', 'hatten', 'hattest', 'hattet', 'hier', 'hin', 'ich', 'ihm', 'ihn', 'ihnen',
  'ihr', 'ihre', 'ihrem', 'ihren', 'ihrer', 'ihres', 'im', 'in', 'indem', 'ins', 'ist', 'ja', 'jede',
  'jedem', 'jeden', 'jeder', 'jedes', 'kann', 'kannst', 'können', 'könnt', 'machen', 'mal', 'man', 'mein',
  'meine', 'meinem', 'meinen', 'meiner', 'meines', 'mich', 'mir', 'mit', 'muss', 'musst', 'mussten', 'nach',
  'nicht', 'nichts', 'noch', 'nun', 'nur', 'ob', 'oder', 'schon', 'sehr', 'sein', 'seine', 'seinem',
  'seinen', 'seiner', 'seines', 'selbst', 'sich', 'sie', 'sind', 'so', 'solche', 'solchem', 'solchen',
  'solcher', 'solches', 'soll', 'sollen', 'sollte', 'sondern', 'über', 'um', 'und', 'uns', 'unser',
  'unsere', 'unserem', 'unseren', 'unserer', 'unter', 'vom', 'von', 'vor', 'war', 'waren', 'warst',
  'wart', 'was', 'weg', 'weil', 'welche', 'welchem', 'welchen', 'welcher', 'welches', 'wenn', 'wer',
  'werde', 'werden', 'wie', 'wieder', 'will', 'wir', 'wird', 'wirst', 'wo', 'zu', 'zum', 'zur',
  'zwar', 'zwischen',
  // bilingual junk often mixed into German CV text
  'work', 'working', 'career', 'job', 'business',
]);

function normalizeInput(userInput = '') {
  return String(userInput || '').replace(/\s+/g, ' ').trim();
}

function inferContentLang(text, uiLang = 'en') {
  const ui = String(uiLang || 'en').toLowerCase().split('-')[0];
  if (ui === 'de') return 'de';
  const c = normalizeInput(text);
  if (/[äöüßÄÖÜ]/.test(c)) return 'de';
  const deParticleHits = (c.match(/\b(und|oder|der|die|das|nicht|auch|mit|für|über|zu)\b/gi) || []).length;
  if (deParticleHits >= 3) return 'de';
  return 'en';
}

/**
 * Theme hints for the model — preserves umlauts; language-aware stop words.
 * @param {string} input
 * @param {string} [lang] UI language from request (de boosts German token handling)
 */
function buildCondensedThemeHints(input, lang = 'en') {
  const clean = normalizeInput(input).toLowerCase();
  if (!clean) return '';

  const contentLang = inferContentLang(input, lang);
  const stop =
    contentLang === 'de'
      ? new Set([...STOP_WORDS_DE, ...STOP_WORDS_EN])
      : STOP_WORDS_EN;

  const minLen = contentLang === 'de' ? 3 : 4;

  const tokens = clean
    .normalize('NFKC')
    .replace(/[^\p{L}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length >= minLen && !stop.has(t));

  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], contentLang === 'de' ? 'de' : 'en'))
    .slice(0, 8)
    .map(([token]) => token);
  return ranked.join(', ');
}

function parseCareerSloganJson(raw) {
  let cleaned = String(raw || '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const parsed = JSON.parse(cleaned);
  const slogan = String(parsed?.career_slogan || '').trim();
  if (!slogan) throw new Error('Missing career_slogan');
  return slogan;
}

function sanitizeSlogan(raw) {
  const lettersOnly = String(raw || '')
    .replace(/[^\p{L}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!lettersOnly) return '';
  const words = lettersOnly.split(' ').filter(Boolean);
  if (words.length < 3) return '';
  return words.slice(0, 6).join(' ');
}

function deterministicFallback(userInput, lang = 'en') {
  const clean = normalizeInput(userInput).toLowerCase();
  const code = String(lang || 'en').toLowerCase().split('-')[0] || 'en';

  if (!clean) return code === 'de' ? DEFAULT_CAREER_SLOGAN_DE : DEFAULT_CAREER_SLOGAN_EN;

  if (code === 'de') {
    if (/(team|menschen|zusammen|führ|mentor|kolleg)/.test(clean)) return 'Stabile Teams mit gemeinsamer Ausrichtung';
    if (/(bauen|gestalt|schaffen|entwickeln|design)/.test(clean)) return 'Konkrete Wege mit eigener Handschrift';
    if (/(lernen|neugier|vertiefen|verbesser)/.test(clean)) return 'Weiterkommen durch echtes Üben';
    if (/(helfen|unterstütz|fürsorg|beiste)/.test(clean)) return 'Praktische Hilfe mit spürbarer Wirkung';
    if (/(lösung|problem|herausforder|komplex)/.test(clean)) return 'Klarheit durch sauberes Auflösen';
    return DEFAULT_CAREER_SLOGAN_DE;
  }

  if (/(team|people|collabor|mentor|lead)/.test(clean)) return 'Strong teams through shared purpose';
  if (/(create|build|design|craft|make)/.test(clean)) return 'Building better ways forward';
  if (/(learn|curious|improv|master)/.test(clean)) return 'Always learning through practice';
  if (/(help|serve|care|support)/.test(clean)) return 'Helping others through action';
  if (/(solve|problem|challenge|complex)/.test(clean)) return 'Clarity through practical problem solving';
  return DEFAULT_CAREER_SLOGAN_EN;
}

/**
 * Generate a short, slogan-like career statement from free-form input.
 * @param {string} userInput
 * @returns {Promise<string>}
 */
async function generateCareerSlogan(userInput, options = {}) {
  const normalized = normalizeInput(userInput);
  const lang = String(options.lang || 'en').toLowerCase().split('-')[0] || 'en';

  if (!normalized) return lang === 'de' ? DEFAULT_CAREER_SLOGAN_DE : DEFAULT_CAREER_SLOGAN_EN;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return deterministicFallback(normalized, lang);
  }

  const trimmedInput = normalized.slice(0, MAX_INPUT_CHARS);
  const condensed = buildCondensedThemeHints(trimmedInput, lang);

  try {
    const aiResult = await generateAI({
      task: 'career_slogan',
      input: { trimmedInput, condensed },
      lang,
      runner: async ({ input, lang: targetLang, tone }) => {
        const temp = targetLang === 'de' ? 0.28 : 0.12;
        const raw = await openaiProvider(
          buildMessages(input.trimmedInput, input.condensed, targetLang, tone),
          {
            temperature: temp,
          }
        );
        const parsed = parseCareerSloganJson(raw);
        const sanitized = sanitizeSlogan(parsed);
        return sanitized || deterministicFallback(normalized, targetLang);
      },
    });
    if (options.returnBundle) return aiResult;
    return aiResult.localized[lang] || aiResult.canonical;
  } catch (err) {
    console.warn('[careerSloganGenerator] Falling back to deterministic slogan:', err.message);
    return deterministicFallback(normalized, lang);
  }
}

module.exports = {
  DEFAULT_CAREER_SLOGAN_EN,
  DEFAULT_CAREER_SLOGAN_DE,
  DEFAULT_CAREER_SLOGAN: DEFAULT_CAREER_SLOGAN_EN,
  generateCareerSlogan,
  deterministicFallback,
  sanitizeSlogan,
  buildCondensedThemeHints,
};
