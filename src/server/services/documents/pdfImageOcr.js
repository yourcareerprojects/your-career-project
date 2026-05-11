/**
 * Rasterizes PDF pages and runs Tesseract OCR when the PDF has no extractable text layer
 * (scanned documents, "print to PDF" from images, or text drawn as outlines only).
 */

const { createCanvas } = require('@napi-rs/canvas');
const { createWorker } = require('tesseract.js');
const logger = require('../../utils/logger');

const MAX_CV_OCR_PAGES = 5;
const RENDER_SCALE = 2;
const OCR_LANGUAGES = 'deu+eng';

async function loadPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

/**
 * @param {Buffer} buffer Raw PDF bytes
 * @returns {Promise<string>} Recognized plain text (may be empty if OCR fails)
 */
async function extractPdfTextViaOcr(buffer) {
  let pdfDocument;
  let worker;
  try {
    const pdfjs = await loadPdfJs();
    const uint8Data = Buffer.isBuffer(buffer)
      ? Uint8Array.from(buffer)
      : buffer instanceof Uint8Array
        ? buffer
        : new Uint8Array(buffer);
    const loadingTask = pdfjs.getDocument({
      data: uint8Data,
      useSystemFonts: true,
      verbosity: 0,
    });
    pdfDocument = await loadingTask.promise;
    const numPages = Math.min(pdfDocument.numPages, MAX_CV_OCR_PAGES);

    worker = await createWorker(OCR_LANGUAGES, 1, { logger: () => {} });

    const parts = [];
    for (let pageNum = 1; pageNum <= numPages; pageNum += 1) {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const w = Math.max(1, Math.ceil(viewport.width));
      const h = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(w, h);
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;
      const imageBuffer = canvas.toBuffer('image/png');
      const {
        data: { text },
      } = await worker.recognize(imageBuffer);
      if (text && String(text).trim()) {
        parts.push(String(text).trim());
      }
    }
    return parts.join('\n\n');
  } catch (err) {
    logger.info('PDF OCR fallback failed', { message: err.message });
    return '';
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        /* ignore */
      }
    }
    if (pdfDocument) {
      try {
        await pdfDocument.destroy();
      } catch (e) {
        /* ignore */
      }
    }
  }
}

/**
 * @param {Buffer} buffer Raw image bytes (JPEG/PNG)
 * @returns {Promise<string>} Recognized plain text (may be empty if OCR fails)
 */
async function extractImageTextViaOcr(buffer) {
  let worker;
  try {
    worker = await createWorker(OCR_LANGUAGES, 1, { logger: () => {} });
    const {
      data: { text },
    } = await worker.recognize(buffer);
    return String(text || '').trim();
  } catch (err) {
    logger.info('Image OCR failed', { message: err.message });
    return '';
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        /* ignore */
      }
    }
  }
}

module.exports = { extractPdfTextViaOcr, extractImageTextViaOcr };
