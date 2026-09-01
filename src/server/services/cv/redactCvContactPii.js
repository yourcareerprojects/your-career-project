/**
 * Redact contact PII from CV text before sending it to OpenAI.
 * Local heuristics (name / email / phone) still run on the original text.
 */

const PLACEHOLDER = {
  EMAIL: '[EMAIL]',
  PHONE: '[PHONE]',
  ADDRESS: '[ADDRESS]',
  URL: '[URL]',
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const URL_RE =
  /(?:https?:\/\/|www\.)[^\s<>"'）)]+|<(?:https?:\/\/|www\.)[^>]+>|(?:linkedin|xing)\.com\/[^\s<>"']+/gi;

const LABELED_ADDRESS_RE =
  /(^|\n)([ \t]*)((?:Address|Adresse|Anschrift|Wohnort|Wohnsitz|Wohnadresse|Home\s*address|Postal\s*address)\s*[:.\-]?\s*).+$/gim;

const EN_STREET_RE =
  /\b\d{1,5}\s+(?:[A-ZÄÖÜ][\w.'-]+\s+){0,4}(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Way|Court|Ct\.?|Place|Pl\.?|Square|Sq\.?)\b(?:\s*,?\s*(?:Apt|Apartment|Suite|Ste\.?|Unit|#)\.?\s*[\w-]+)?/gi;

const DE_STREET_RE =
  /\b[A-ZÄÖÜ][\wäöüß.'-]*(?:straße|strasse|str\.|weg|platz|allee|ring|gasse|damm|ufer|chaussee|steig)\s+\d{1,4}[a-zA-Z]?(?:\s*-\s*\d{1,4}[a-zA-Z]?)?\b/gi;

const DE_ZIP_CITY_RE =
  /(?:^|[,\n;])\s*(?:D-?\s*)?\d{5}\s+[A-ZÄÖÜ][a-zäöüß-]{2,}(?:\s+[A-ZÄÖÜ][a-zäöüß-]{2,})?/gm;

const US_CITY_STATE_ZIP_RE =
  /\b[A-Z][a-z]+(?:[\s-][A-Z][a-z]+)*,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g;

const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g;

const LABELED_PHONE_RE =
  /((?:Tel(?:efon)?|Phone|Ph|Mobile|Mobil|Handy|Fax|Cell)\.?\s*[:.]?\s*)(\+?[\d\s()./\-]{7,24})/gi;

const PHONE_CANDIDATE_RES = [
  /\+\d{1,3}[\s./\-]*\(?\d{1,4}\)?[\s./\-]*\d[\d\s./\-]{5,18}\d/g,
  /\(\d{2,4}\)[\s./\-]*\d{3,5}[\s./\-]*\d{2,6}/g,
  /(?<!\d)0\d{1,4}[\s./\-]\d[\d\s./\-]{5,14}\d(?!\d)/g,
  /(?<!\d)\d{3}[\s.\-]\d{3}[\s.\-]\d{4}(?!\d)/g,
  /(?<!\d)0\d{9,12}(?!\d)/g,
];

const CAREER_YEAR_RANGE_RE =
  /\b(?:19|20)\d{2}(?:\s*[-–—/]\s*(?:19|20)?\d{2})?\b/g;

const CAREER_MONTH_YEAR_RE =
  /\b(?:Jan(?:uary|uar)?|Feb(?:ruary|ruar)?|Mar(?:ch)?|Mär(?:z)?|Apr(?:il)?|May|Mai|Jun(?:e|i)?|Jul(?:y|i)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Okt(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Dez(?:ember)?)\.?\s+(?:19|20)\d{2}\b/gi;

const CAREER_NUMERIC_MONTH_YEAR_RE =
  /\b\d{1,2}[./](?:19|20)\d{2}(?:\s*[-–—]\s*\d{1,2}[./](?:19|20)\d{2})?\b/g;

function replaceAll(text, regex, replacement) {
  const copy = new RegExp(regex.source, regex.flags);
  return String(text || '').replace(copy, replacement);
}

function redactEmails(text) {
  return replaceAll(text, EMAIL_RE, PLACEHOLDER.EMAIL);
}

function redactUrls(text) {
  return replaceAll(text, URL_RE, PLACEHOLDER.URL);
}

function redactAddresses(text) {
  let out = replaceAll(
    text,
    LABELED_ADDRESS_RE,
    (_, newline, indent, label) => `${newline}${indent}${label}${PLACEHOLDER.ADDRESS}`
  );
  out = replaceAll(out, EN_STREET_RE, PLACEHOLDER.ADDRESS);
  out = replaceAll(out, DE_STREET_RE, PLACEHOLDER.ADDRESS);
  out = replaceAll(out, DE_ZIP_CITY_RE, (match) => {
    const lead = match.match(/^[,\n;]?\s*/)?.[0] || '';
    return `${lead}${PLACEHOLDER.ADDRESS}`;
  });
  out = replaceAll(out, US_CITY_STATE_ZIP_RE, PLACEHOLDER.ADDRESS);
  out = replaceAll(out, UK_POSTCODE_RE, PLACEHOLDER.ADDRESS);
  return out;
}

function protectWith(text, regex, stored) {
  return replaceAll(text, regex, (match) => {
    const token = `\u0000DATE${stored.length}\u0000`;
    stored.push(match);
    return token;
  });
}

function protectCareerDates(text) {
  const stored = [];
  let protectedText = protectWith(text, CAREER_YEAR_RANGE_RE, stored);
  protectedText = protectWith(protectedText, CAREER_MONTH_YEAR_RE, stored);
  protectedText = protectWith(protectedText, CAREER_NUMERIC_MONTH_YEAR_RE, stored);
  return { protectedText, stored };
}

function restoreCareerDates(text, stored) {
  return replaceAll(text, /\u0000DATE(\d+)\u0000/g, (_, index) => stored[Number(index)] || '');
}

function phoneReplacement(match) {
  const digits = String(match).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return match;
  if (/^(?:19|20)\d{2}$/.test(digits)) return match;
  return PLACEHOLDER.PHONE;
}

function redactPhones(text) {
  let out = replaceAll(text, LABELED_PHONE_RE, (_, label, number) => {
    const digits = String(number).replace(/\D/g, '');
    if (digits.length < 7) return `${label}${number}`;
    return `${label}${PLACEHOLDER.PHONE}`;
  });
  for (const pattern of PHONE_CANDIDATE_RES) {
    out = replaceAll(out, pattern, phoneReplacement);
  }
  return out;
}

function collapsePlaceholderRuns(text) {
  return ['EMAIL', 'PHONE', 'ADDRESS', 'URL'].reduce((acc, key) => {
    const token = PLACEHOLDER[key].replace(/[[\]]/g, '\\$&');
    return acc.replace(new RegExp(`(${token})(?:\\s*,?\\s*${token})+`, 'g'), '$1');
  }, text);
}

/**
 * @param {string} cvText original extracted CV text
 * @returns {string} text with contact PII replaced by placeholders
 */
function redactCvContactPii(cvText) {
  const source = String(cvText || '');
  if (!source.trim()) return source;

  let out = redactEmails(source);
  out = redactUrls(out);
  out = redactAddresses(out);

  const { protectedText, stored } = protectCareerDates(out);
  out = redactPhones(protectedText);
  out = restoreCareerDates(out, stored);

  return collapsePlaceholderRuns(out);
}

module.exports = {
  redactCvContactPii,
  PLACEHOLDER,
};
