/**
 * Rasterizes PDF pages and runs Tesseract OCR when the PDF has no extractable text layer
 * (scanned documents, "print to PDF" from images, or text drawn as outlines only).
 */

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { withTesseractWorker } = require('./tesseractWorkerPool');
const logger = require('../../utils/logger');
const {
  getCvPipeline,
  logCvEvent,
  markOcrUsed,
  memorySnapshot,
} = require('../../utils/metricsLogger');
const { loadPdfJsDocument, destroyPdfJsDocument } = require('./pdfTextExtraction');

const MAX_CV_OCR_PAGES = 5;
const RENDER_SCALE = 2;
const OCR_JPEG_QUALITY = 85;
/** Max canvas width/height for direct image OCR (keeps full upload; normalizes processing cost). */
const IMAGE_OCR_MAX_DIMENSION = 2400;

function canvasToGrayscaleJpeg(canvas) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toBuffer('image/jpeg', OCR_JPEG_QUALITY);
}

/**
 * Normalize large photo uploads to grayscale JPEG for faster Tesseract runs.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function prepareImageBufferForOcr(buffer) {
  const image = await loadImage(buffer);
  const maxDim = Math.max(image.width, image.height);
  const scale = maxDim > IMAGE_OCR_MAX_DIMENSION ? IMAGE_OCR_MAX_DIMENSION / maxDim : 1;
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(w, h);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, w, h);
  return canvasToGrayscaleJpeg(canvas);
}

/**
 * @param {Buffer} buffer Raw PDF bytes
 * @param {{ pdfDocument?: import('pdfjs-dist').PDFDocumentProxy }} [options]
 * @returns {Promise<string>} Recognized plain text (may be empty if OCR fails)
 */
async function extractPdfTextViaOcr(buffer, options = {}) {
  const pipeline = getCvPipeline();
  const ocrStarted = process.hrtime.bigint();
  const memBefore = pipeline ? memorySnapshot() : null;

  markOcrUsed();

  let pdfDocument = options.pdfDocument ?? null;
  let ownedDocument = !pdfDocument;

  try {
    return await withTesseractWorker(async (worker) => {
      try {
        if (!pdfDocument) {
          pdfDocument = await loadPdfJsDocument(buffer);
          ownedDocument = true;
        }

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
          const imageBuffer = canvasToGrayscaleJpeg(canvas);
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
            imageFormat: 'jpeg_grayscale',
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
        if (ownedDocument) {
          await destroyPdfJsDocument(pdfDocument);
          pdfDocument = null;
        }
      }
    });
  } catch (err) {
    const totalOcrMs = Number(process.hrtime.bigint() - ocrStarted) / 1e6;
    logger.error('PDF OCR fallback failed', {
      message: err?.message || String(err),
      name: err?.name || null,
      stack: err?.stack || null,
    });
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
      const ocrBuffer = await prepareImageBufferForOcr(buffer);
      const {
        data: { text },
      } = await worker.recognize(ocrBuffer);
      const totalOcrMs = Number(process.hrtime.bigint() - ocrStarted) / 1e6;
      const memAfter = pipeline ? memorySnapshot() : null;
      if (pipeline) {
        logCvEvent('cv_pipeline_ocr_image_summary', {
          ocrKind: 'image',
          pagesProcessed: 1,
          totalOcrDurationMs: Math.round(totalOcrMs * 1000) / 1000,
          memoryBefore: memBefore,
          memoryAfter: memAfter,
          imageFormat: 'jpeg_grayscale',
        });
      }
      return String(text || '').trim();
    });
  } catch (err) {
    const totalOcrMs = Number(process.hrtime.bigint() - ocrStarted) / 1e6;
    logger.error('Image OCR failed', {
      message: err?.message || String(err),
      name: err?.name || null,
      stack: err?.stack || null,
    });
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
  __testables: {
    canvasToGrayscaleJpeg,
    prepareImageBufferForOcr,
    IMAGE_OCR_MAX_DIMENSION,
  },
};
