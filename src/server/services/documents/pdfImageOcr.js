/**
 * Rasterizes PDF pages and runs Tesseract OCR when the PDF has no extractable text layer
 * (scanned documents, "print to PDF" from images, or text drawn as outlines only).
 */

const { createCanvas } = require('@napi-rs/canvas');
const { withTesseractWorker } = require('./tesseractWorkerPool');
const logger = require('../../utils/logger');
const {
  getCvPipeline,
  logCvEvent,
  markOcrUsed,
  memorySnapshot,
} = require('../../utils/metricsLogger');

const MAX_CV_OCR_PAGES = 5;
const RENDER_SCALE = 2;

async function loadPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

/**
 * @param {Buffer} buffer Raw PDF bytes
 * @returns {Promise<string>} Recognized plain text (may be empty if OCR fails)
 */
async function extractPdfTextViaOcr(buffer) {
  const pipeline = getCvPipeline();
  const ocrStarted = process.hrtime.bigint();
  const memBefore = pipeline ? memorySnapshot() : null;

  markOcrUsed();

  try {
    return await withTesseractWorker(async (worker) => {
      let pdfDocument;
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
        const totalPdfPages = pdfDocument.numPages;
        const numPages = Math.min(totalPdfPages, MAX_CV_OCR_PAGES);
        const limitReached = totalPdfPages > MAX_CV_OCR_PAGES;

        const parts = [];
        const pageTimingsMs = [];
        const pageDetails = [];

        for (let pageNum = 1; pageNum <= numPages; pageNum += 1) {
          const pageHr = process.hrtime.bigint();
          const page = await pdfDocument.getPage(pageNum);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const w = Math.max(1, Math.ceil(viewport.width));
          const h = Math.max(1, Math.ceil(viewport.height));
          const canvas = createCanvas(w, h);
          const context = canvas.getContext('2d');
          const renderHr = process.hrtime.bigint();
          await page.render({ canvasContext: context, viewport }).promise;
          const renderMs = Number(process.hrtime.bigint() - renderHr) / 1e6;
          const imageBuffer = canvas.toBuffer('image/png');
          const ocrHr = process.hrtime.bigint();
          const {
            data: { text },
          } = await worker.recognize(imageBuffer);
          const ocrMs = Number(process.hrtime.bigint() - ocrHr) / 1e6;
          const pageTotalMs = Number(process.hrtime.bigint() - pageHr) / 1e6;
          pageTimingsMs.push(Math.round(pageTotalMs * 1000) / 1000);
          pageDetails.push({
            page: pageNum,
            renderMs: Math.round(renderMs * 1000) / 1000,
            ocrRecognizeMs: Math.round(ocrMs * 1000) / 1000,
            totalMs: Math.round(pageTotalMs * 1000) / 1000,
          });
          if (text && String(text).trim()) {
            parts.push(String(text).trim());
          }
        }

        const totalOcrMs = Number(process.hrtime.bigint() - ocrStarted) / 1e6;
        const memAfter = pipeline ? memorySnapshot() : null;

        if (pipeline) {
          logCvEvent('cv_pipeline_ocr_pdf_summary', {
            ocrKind: 'pdf_raster',
            totalPdfPages,
            pagesProcessed: numPages,
            pageLimit: MAX_CV_OCR_PAGES,
            limitReached,
            renderScale: RENDER_SCALE,
            pageDurationMs: pageTimingsMs,
            pageDetails,
            totalOcrDurationMs: Math.round(totalOcrMs * 1000) / 1000,
            memoryBefore: memBefore,
            memoryAfter: memAfter,
          });
        }

        return parts.join('\n\n');
      } finally {
        if (pdfDocument) {
          try {
            await pdfDocument.destroy();
          } catch (e) {
            /* ignore */
          }
        }
      }
    });
  } catch (err) {
    const totalOcrMs = Number(process.hrtime.bigint() - ocrStarted) / 1e6;
    logger.info('PDF OCR fallback failed', { message: err.message });
    if (getCvPipeline()) {
      logCvEvent('cv_pipeline_ocr_pdf_failed', {
        ocrKind: 'pdf_raster',
        totalOcrDurationMs: Math.round(totalOcrMs * 1000) / 1000,
        errorName: err && err.name,
      });
    }
    return '';
  }
}

/**
 * @param {Buffer} buffer Raw image bytes (JPEG/PNG)
 * @returns {Promise<string>} Recognized plain text (may be empty if OCR fails)
 */
async function extractImageTextViaOcr(buffer) {
  const pipeline = getCvPipeline();
  const ocrStarted = process.hrtime.bigint();
  const memBefore = pipeline ? memorySnapshot() : null;
  markOcrUsed();

  try {
    return await withTesseractWorker(async (worker) => {
      const {
        data: { text },
      } = await worker.recognize(buffer);
      const totalOcrMs = Number(process.hrtime.bigint() - ocrStarted) / 1e6;
      const memAfter = pipeline ? memorySnapshot() : null;
      if (pipeline) {
        logCvEvent('cv_pipeline_ocr_image_summary', {
          ocrKind: 'image',
          pagesProcessed: 1,
          totalOcrDurationMs: Math.round(totalOcrMs * 1000) / 1000,
          memoryBefore: memBefore,
          memoryAfter: memAfter,
        });
      }
      return String(text || '').trim();
    });
  } catch (err) {
    const totalOcrMs = Number(process.hrtime.bigint() - ocrStarted) / 1e6;
    logger.info('Image OCR failed', { message: err.message });
    if (getCvPipeline()) {
      logCvEvent('cv_pipeline_ocr_image_failed', {
        ocrKind: 'image',
        totalOcrDurationMs: Math.round(totalOcrMs * 1000) / 1000,
        errorName: err && err.name,
      });
    }
    return '';
  }
}

module.exports = {
  extractPdfTextViaOcr,
  extractImageTextViaOcr,
  CV_OCR_MAX_PAGES: MAX_CV_OCR_PAGES,
  CV_OCR_RENDER_SCALE: RENDER_SCALE,
};
