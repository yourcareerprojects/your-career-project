/** Parser / cache schema version (invalidate semantics on bump). */
const CV_EXTRACTED_TEXT_PARSER_VERSION = '1';

/** Default TTL for extracted plain text reuse (hours). */
const CV_EXTRACTED_TEXT_CACHE_TTL_HOURS_DEFAULT = 72;

/** Hard cap on cached plain text (bytes). */
const CV_EXTRACTED_TEXT_MAX_BYTES = 256 * 1024;

const CV_EXTRACTED_TEXT_SOURCES = [
  'pdf_text_layer',
  'pdf_js',
  'pdf_ocr',
  'image_ocr',
  'docx',
  'txt',
  'unknown',
];

function readCvExtractedTextCacheTtlHours() {
  const raw = process.env.CV_EXTRACTED_TEXT_CACHE_TTL_HOURS;
  if (raw == null || raw === '') return CV_EXTRACTED_TEXT_CACHE_TTL_HOURS_DEFAULT;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return CV_EXTRACTED_TEXT_CACHE_TTL_HOURS_DEFAULT;
  return Math.min(n, 24 * 30);
}

function readCvReuseExtractedTextEnabled() {
  const raw = String(process.env.CV_REUSE_EXTRACTED_TEXT ?? 'true').toLowerCase().trim();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

module.exports = {
  CV_EXTRACTED_TEXT_PARSER_VERSION,
  CV_EXTRACTED_TEXT_CACHE_TTL_HOURS_DEFAULT,
  CV_EXTRACTED_TEXT_MAX_BYTES,
  CV_EXTRACTED_TEXT_SOURCES,
  readCvExtractedTextCacheTtlHours,
  readCvReuseExtractedTextEnabled,
};
