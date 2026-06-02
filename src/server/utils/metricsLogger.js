/**
 * Lightweight CV upload pipeline observability: AsyncLocalStorage correlation,
 * stage timings (process.hrtime.bigint), memory snapshots, structured JSON logs.
 * Never logs CV text, profile payloads, or PII.
 */

const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');
const logger = require('./logger');
const { normalizeExternalApiError, isTimeoutLikeError } = require('./httpTimeouts');

const cvPipelineAls = new AsyncLocalStorage();

/** Slow-operation thresholds (ms) */
const THRESHOLD_OCR_MS = 15000;
const THRESHOLD_OPENAI_MS = 30000;
const THRESHOLD_UPLOAD_TOTAL_MS = 45000;

function hrtimeDiffMs(startHr) {
  const ns = process.hrtime.bigint() - startHr;
  return Number(ns) / 1e6;
}

function memorySnapshot() {
  const m = process.memoryUsage();
  return {
    rss: m.rss,
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    external: m.external,
  };
}

function getCvPipeline() {
  return cvPipelineAls.getStore();
}

/**
 * Run CV extraction pipeline with correlation context (must wrap entire async chain).
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} meta
 * @param {() => Promise<void>} fn
 */
async function runCvUploadPipeline(req, meta, fn) {
  const requestId =
    req.requestId ||
    (req.headers['x-request-id'] && String(req.headers['x-request-id']).slice(0, 64)) ||
    crypto.randomUUID();
  req.cvRequestId = requestId;

  const store = {
    requestId,
    route: 'POST /api/documents/upload',
    startedHr: process.hrtime.bigint(),
    translationCalls: 0,
    translationTotalMs: 0,
    openaiCalls: 0,
    openaiTotalMs: 0,
    ocrUsed: false,
    ...meta,
  };
  return cvPipelineAls.run(store, fn);
}

function logCvEvent(message, fields = {}) {
  const pipe = getCvPipeline();
  const base = pipe ? { requestId: pipe.requestId, route: pipe.route } : {};
  logger.info(message, { ...base, ...fields });
}

function logCvStage(stage, fields = {}) {
  logCvEvent('cv_pipeline_stage', { stage, ...fields });
}

/**
 * Classify errors for dashboards (no raw messages / PII).
 * @param {unknown} err
 * @param {ReturnType<typeof normalizeExternalApiError>} norm
 */
function classifyStageError(err, norm) {
  if (norm.isTimeout || norm.isAbort) return 'timeout_or_abort';
  if (typeof norm.httpStatus === 'number' && norm.httpStatus >= 500) return 'upstream_5xx';
  if (typeof norm.httpStatus === 'number' && norm.httpStatus >= 400) return 'upstream_4xx';
  if (norm.isNetwork) return 'network';
  if (err && typeof err === 'object' && err.name === 'SyntaxError') return 'validation_parse';
  return 'unknown';
}

function warnSlowOperation(operation, durationMs, thresholdMs) {
  const pipe = getCvPipeline();
  logger.warn('cv_pipeline_slow_operation', {
    ...(pipe ? { requestId: pipe.requestId, route: pipe.route } : {}),
    operation,
    durationMs: Math.round(durationMs),
    thresholdMs,
  });
}

/**
 * @param {string} stage
 * @param {{ memory?: boolean }} opts
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withCvStage(stage, opts = {}, fn) {
  const wantMem = Boolean(opts.memory);
  const hrStart = process.hrtime.bigint();
  let memBefore = wantMem ? memorySnapshot() : null;
  try {
    const result = await fn();
    const durationMs = hrtimeDiffMs(hrStart);
    const memAfter = wantMem ? memorySnapshot() : null;
    logCvStage(stage, {
      ok: true,
      durationMs: Math.round(durationMs * 1000) / 1000,
      ...(wantMem ? { memoryBefore: memBefore, memoryAfter: memAfter } : {}),
    });
    if (stage.includes('ocr') || stage === 'pdf_ocr_total' || stage === 'image_ocr_total') {
      if (durationMs > THRESHOLD_OCR_MS) warnSlowOperation(stage, durationMs, THRESHOLD_OCR_MS);
    }
    if (stage.startsWith('openai_') || stage === 'openai_interpret_cv') {
      if (durationMs > THRESHOLD_OPENAI_MS) warnSlowOperation(stage, durationMs, THRESHOLD_OPENAI_MS);
    }
    return result;
  } catch (err) {
    const durationMs = hrtimeDiffMs(hrStart);
    const norm = normalizeExternalApiError(err);
    logCvStage(stage, {
      ok: false,
      durationMs: Math.round(durationMs * 1000) / 1000,
      errorType: classifyStageError(err, norm),
      errorName: err && typeof err === 'object' ? err.name : undefined,
      isTimeout: norm.isTimeout,
      httpStatus: norm.httpStatus,
    });
    const pipe = getCvPipeline();
    logger.error('cv_pipeline_stage_failed', {
      ...(pipe ? { requestId: pipe.requestId, route: pipe.route } : {}),
      stage,
      errorType: classifyStageError(err, norm),
      errorName: err && typeof err === 'object' ? err.name : undefined,
      isTimeout: norm.isTimeout,
      httpStatus: norm.httpStatus,
      ...(err instanceof Error ? { stack: err.stack } : {}),
    });
    throw err;
  }
}

/**
 * Time synchronous CPU work (e.g. heuristics).
 * @param {string} stage
 * @param {() => T} fn
 * @returns {T}
 * @template T
 */
async function runStageIfCvPipeline(stage, opts, fn) {
  if (!getCvPipeline()) return fn();
  return withCvStage(stage, opts, fn);
}

function runSyncStageIfCvPipeline(stage, fn) {
  if (!getCvPipeline()) return fn();
  return runCvSyncStage(stage, fn);
}

function runCvSyncStage(stage, fn) {
  const hrStart = process.hrtime.bigint();
  try {
    const result = fn();
    const durationMs = hrtimeDiffMs(hrStart);
    logCvStage(stage, { ok: true, durationMs: Math.round(durationMs * 1000) / 1000 });
    return result;
  } catch (err) {
    const durationMs = hrtimeDiffMs(hrStart);
    const norm = normalizeExternalApiError(err);
    logCvStage(stage, {
      ok: false,
      durationMs: Math.round(durationMs * 1000) / 1000,
      errorType: classifyStageError(err, norm),
      errorName: err && typeof err === 'object' ? err.name : undefined,
    });
    throw err;
  }
}

function markOcrUsed() {
  const p = getCvPipeline();
  if (p) p.ocrUsed = true;
}

/**
 * Record a single OpenAI-compatible HTTP call (CV pipeline only). Does not log prompts.
 * @param {object} p
 */
function recordOpenAiProviderMetrics(p) {
  const ctx = getCvPipeline();
  if (!ctx) return;
  ctx.openaiCalls = (ctx.openaiCalls || 0) + 1;
  ctx.openaiTotalMs = (ctx.openaiTotalMs || 0) + (p.durationMs || 0);
  logger.info('cv_pipeline_openai_http', {
    requestId: ctx.requestId,
    provider: p.provider || 'openai_compatible',
    model: p.model,
    durationMs: Math.round(p.durationMs * 1000) / 1000,
    httpStatus: p.httpStatus ?? null,
    timedOut: Boolean(p.timedOut),
    retry: Boolean(p.retry),
    signalTimeoutMs: p.signalTimeoutMs ?? null,
  });
  if (p.durationMs > THRESHOLD_OPENAI_MS) {
    warnSlowOperation('openai_http', p.durationMs, THRESHOLD_OPENAI_MS);
  }
}

/**
 * Accumulate translation call stats (summary logged from localizeCvExtractedProfile).
 * @param {number} durationMs
 */
function recordTranslationDuration(durationMs) {
  const ctx = getCvPipeline();
  if (!ctx) return;
  ctx.translationCalls = (ctx.translationCalls || 0) + 1;
  ctx.translationTotalMs = (ctx.translationTotalMs || 0) + durationMs;
}

function logTranslationSummary() {
  const ctx = getCvPipeline();
  if (!ctx || !ctx.translationCalls) return;
  logCvStage('translate_between_locales_summary', {
    ok: true,
    callCount: ctx.translationCalls,
    totalDurationMs: Math.round(ctx.translationTotalMs * 1000) / 1000,
  });
}

function serializeErrorSafe(err) {
  if (!(err instanceof Error)) return { messagePreview: String(err).slice(0, 200) };
  const norm = normalizeExternalApiError(err);
  return {
    name: err.name,
    errorType: classifyStageError(err, norm),
    isTimeout: norm.isTimeout,
    httpStatus: norm.httpStatus,
  };
}

/**
 * Run CV pipeline stages with worker correlation (AsyncLocalStorage store).
 * @param {{ jobId?: string, documentId?: string, userId?: string, requestId?: string }} meta
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function runCvWorkerPipelineContext(meta = {}, fn) {
  const crypto = require('crypto');
  const requestId =
    meta.requestId ||
    (meta.jobId ? `cv-worker-${String(meta.jobId).slice(0, 48)}` : null) ||
    crypto.randomUUID();
  const store = {
    requestId,
    route: 'worker/cv-extraction',
    startedHr: process.hrtime.bigint(),
    translationCalls: 0,
    translationTotalMs: 0,
    openaiCalls: 0,
    openaiTotalMs: 0,
    ocrUsed: false,
    jobId: meta.jobId || null,
    documentId: meta.documentId || null,
    userId: meta.userId || null,
  };
  return cvPipelineAls.run(store, fn);
}

module.exports = {
  THRESHOLD_OCR_MS,
  THRESHOLD_OPENAI_MS,
  THRESHOLD_UPLOAD_TOTAL_MS,
  getCvPipeline,
  runCvUploadPipeline,
  memorySnapshot,
  hrtimeDiffMs,
  logCvEvent,
  logCvStage,
  withCvStage,
  runStageIfCvPipeline,
  runSyncStageIfCvPipeline,
  runCvSyncStage,
  markOcrUsed,
  recordOpenAiProviderMetrics,
  recordTranslationDuration,
  logTranslationSummary,
  classifyStageError,
  serializeErrorSafe,
  warnSlowOperation,
  normalizeExternalApiError,
  isTimeoutLikeError,
  runCvWorkerPipelineContext,
};
