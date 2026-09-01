/**
 * Orchestrates occupation domain classification (prompt → LLM → validate → save).
 * @module services/occupationDomainClassification/domainClassificationService
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const {
  buildClassificationFilter,
  countOccupationsToClassify,
  fetchOccupationBatch,
  saveOccupationDomainClassification,
} = require('./domainClassificationDb');
const { classifyWithOpenAI, DEFAULT_MODEL } = require('./domainClassificationLlmClient');
const {
  buildClassificationChatMessages,
  buildDomainCorrectionMessage,
} = require('./domainClassificationPrompt');
const {
  validateClassificationResponse,
  MANUAL_REVIEW_CONFIDENCE_THRESHOLD,
} = require('./domainClassificationValidation');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process items with bounded concurrency (order preserved).
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function pMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function extractRejectedDomain(errorMessage) {
  const msg = String(errorMessage || '');
  const match = msg.match(/Domain not in allowed list:\s*(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Classify a single occupation document.
 * On an out-of-list domain, asks the model once more to pick from the allowed list.
 *
 * @param {object} occupation
 * @param {{
 *   model?: string,
 *   dryRun?: boolean,
 *   maxRetries?: number,
 * }} [options]
 */
async function classifyOccupation(occupation, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const messages = buildClassificationChatMessages(occupation);
  let { text, model: usedModel } = await classifyWithOpenAI({
    messages,
    model,
    maxRetries: options.maxRetries,
  });

  let validated;
  try {
    validated = validateClassificationResponse(text, {
      model: usedModel,
      escoId: occupation.escoId,
    });
  } catch (err) {
    const rejected = extractRejectedDomain(err.message);
    if (!rejected) throw err;

    logger.warn('occupation domain classification retrying after invalid domain', {
      escoId: occupation.escoId,
      rejectedDomain: rejected,
    });

    const retryMessages = [
      ...messages,
      { role: 'assistant', content: text },
      buildDomainCorrectionMessage(rejected),
    ];
    const retry = await classifyWithOpenAI({
      messages: retryMessages,
      model,
      maxRetries: options.maxRetries,
    });
    text = retry.text;
    usedModel = retry.model;
    validated = validateClassificationResponse(text, {
      model: usedModel,
      escoId: occupation.escoId,
    });
  }

  if (!options.dryRun) {
    try {
      await saveOccupationDomainClassification(occupation._id, {
        domain: validated.domain,
        confidence: validated.confidence,
        model: validated.model,
        reason: validated.reason,
        needsManualReview: validated.needsManualReview,
      });
    } catch (err) {
      logger.error('occupation domain classification database error', {
        escoId: occupation.escoId,
        careerPathId: String(occupation._id),
        message: err?.message,
        stack: err?.stack,
      });
      throw err;
    }
  }

  return validated;
}

/**
 * Run batch classification over UNASSIGNED (or all with force) occupations.
 *
 * @param {{
 *   force?: boolean,
 *   dryRun?: boolean,
 *   batchSize?: number,
 *   concurrency?: number,
 *   throttleMs?: number,
 *   limit?: number,
 *   escoPrefix?: string|null,
 *   escoIds?: string[]|null,
 *   model?: string,
 *   failuresPath?: string,
 *   onProgress?: (done: number, total: number) => void,
 * }} [options]
 */
async function runDomainClassification(options = {}) {
  const {
    force = false,
    dryRun = false,
    batchSize = 25,
    concurrency = 3,
    throttleMs = 150,
    limit = Infinity,
    escoPrefix = null,
    escoIds = null,
    model = DEFAULT_MODEL,
    failuresPath = path.resolve(process.cwd(), 'classification_failures.json'),
    onProgress = null,
  } = options;

  const filter = buildClassificationFilter({ force, escoPrefix, escoIds });
  const totalMatching = await countOccupationsToClassify(filter);
  const total = Number.isFinite(limit) ? Math.min(totalMatching, limit) : totalMatching;

  const summary = {
    totalMatching,
    totalToProcess: total,
    processed: 0,
    succeeded: 0,
    failed: 0,
    needsManualReview: 0,
    confidenceSum: 0,
    failures: [],
  };

  if (total === 0) {
    return summary;
  }

  let lastId = null;
  let remaining = total;

  while (remaining > 0) {
    const fetchSize = Math.min(batchSize, remaining);
    const batch = await fetchOccupationBatch(filter, { afterId: lastId, limit: fetchSize });
    if (batch.length === 0) break;

    lastId = batch[batch.length - 1]._id;

    await pMap(batch, concurrency, async (occupation) => {
      try {
        if (throttleMs > 0) await sleep(throttleMs);
        const result = await classifyOccupation(occupation, { model, dryRun });
        summary.succeeded += 1;
        summary.confidenceSum += result.confidence;
        if (result.needsManualReview) summary.needsManualReview += 1;
      } catch (err) {
        summary.failed += 1;
        summary.failures.push({
          escoId: occupation.escoId || null,
          careerPathId: occupation._id ? String(occupation._id) : null,
          title: occupation.title?.en || occupation.title || null,
          error: err?.message || String(err),
          at: new Date().toISOString(),
        });
        logger.error('occupation domain classification failed for occupation', {
          escoId: occupation.escoId,
          message: err?.message,
        });
      } finally {
        summary.processed += 1;
        if (typeof onProgress === 'function') {
          onProgress(summary.processed, total);
        }
      }
    });

    remaining = total - summary.processed;
  }

  try {
    fs.writeFileSync(
      failuresPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          model,
          force,
          dryRun,
          totalFailed: summary.failures.length,
          failures: summary.failures,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (err) {
    logger.error('occupation domain classification failed to write failures file', {
      failuresPath,
      message: err?.message,
    });
  }

  summary.averageConfidence =
    summary.succeeded > 0 ? summary.confidenceSum / summary.succeeded : null;
  summary.failuresPath = failuresPath;
  summary.manualReviewThreshold = MANUAL_REVIEW_CONFIDENCE_THRESHOLD;

  return summary;
}

module.exports = {
  classifyOccupation,
  runDomainClassification,
  pMap,
  MANUAL_REVIEW_CONFIDENCE_THRESHOLD,
};
