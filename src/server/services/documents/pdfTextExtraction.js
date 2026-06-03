/**
 * Fast PDF text extraction: pdf-parse / pdfjs text layers and sufficiency heuristics.
 */

/** Align with `MAX_CV_OCR_PAGES` in pdfImageOcr.js (same page window for text + OCR). */
const MAX_PDF_TEXT_PAGES = 5;

const MIN_SUFFICIENT_CHARS = 80;
const MIN_SUFFICIENT_WORDS = 8;
const MIN_SUFFICIENT_ALNUM = 40;
const MIN_LETTER_RATIO = 0.35;

async function loadPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

function toUint8Array(buffer) {
  if (buffer instanceof Uint8Array && !Buffer.isBuffer(buffer)) return buffer;
  if (Buffer.isBuffer(buffer)) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  return new Uint8Array(buffer);
}

function normalizePdfPlainText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when extracted PDF text is likely usable CV content (not empty metadata/garbage).
 * @param {string} text
 */
function isPdfTextLayerSufficient(text) {
  const normalized = normalizePdfPlainText(text);
  if (normalized.length < MIN_SUFFICIENT_CHARS) return false;

  const words = normalized.split(/\s+/).filter((word) => /[A-Za-zÀ-ÿ]/.test(word));
  if (words.length < MIN_SUFFICIENT_WORDS) return false;

  const letters = (normalized.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  const digits = (normalized.match(/\d/g) || []).length;
  const alnum = letters + digits;
  if (alnum < MIN_SUFFICIENT_ALNUM) return false;
  if (letters / Math.max(alnum, 1) < MIN_LETTER_RATIO) return false;

  return true;
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
async function loadPdfJsDocument(buffer) {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: toUint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  });
  return loadingTask.promise;
}

/**
 * @param {import('pdfjs-dist').PDFDocumentProxy|null|undefined} pdfDocument
 */
async function destroyPdfJsDocument(pdfDocument) {
  if (!pdfDocument) return;
  try {
    await pdfDocument.destroy();
  } catch (e) {
    /* ignore */
  }
}

/**
 * Extract plain text via pdfjs getTextContent (fast fallback before OCR).
 *
 * @param {Buffer|Uint8Array} buffer
 * @param {{ pdfDocument?: import('pdfjs-dist').PDFDocumentProxy, maxPages?: number }} [options]
 * @returns {Promise<string>}
 */
async function extractPdfTextViaPdfJs(buffer, options = {}) {
  const maxPages = options.maxPages ?? MAX_PDF_TEXT_PAGES;
  let pdfDocument = options.pdfDocument ?? null;
  let owned = false;

  try {
    if (!pdfDocument) {
      pdfDocument = await loadPdfJsDocument(buffer);
      owned = true;
    }

    const numPages = Math.min(pdfDocument.numPages, maxPages);
    const parts = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum += 1) {
      const page = await pdfDocument.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => (item && typeof item.str === 'string' ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (pageText) parts.push(pageText);
    }

    return parts.join('\n\n');
  } finally {
    if (owned) {
      await destroyPdfJsDocument(pdfDocument);
    }
  }
}

module.exports = {
  normalizePdfPlainText,
  isPdfTextLayerSufficient,
  loadPdfJsDocument,
  destroyPdfJsDocument,
  extractPdfTextViaPdfJs,
  __testables: {
    MIN_SUFFICIENT_CHARS,
    MIN_SUFFICIENT_WORDS,
  },
};
