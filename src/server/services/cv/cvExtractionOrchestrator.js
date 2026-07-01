/**
 * CV extraction orchestration: heuristics-first, then event-driven fan-out (identity / structured / narrative).
 */

const { parseDocumentToTextWithMeta } = require('../documents/documentProfileEnrichment');
const { detectCvDocumentLanguage } = require('../documents/detectCvDocumentLanguage');
const { finalizeCvExtractionPayload } = require('./cvExtractionFinalize');
const {
  runSyncStageIfCvPipeline,
} = require('../../utils/metricsLogger');
const { extractProfileDataFromDocumentTextHeuristic } = require('./cvHeuristicExtract');
const {
  buildCombinedSemanticExtraction,
} = require('./cvSemanticCompose');
const {
  buildEmptyAiExtractionResult,
  buildSemanticInterpretationBlob,
  profileHasAnyExtractable,
  stripGoodAtFromProfile,
} = require('./cvSemanticMap');
const {
  emitHeuristicsCompletedAndFanOut,
  awaitIdentityCompletion,
  getStructuredResultIfSettled,
  runInlineSemanticFanOut,
} = require('./cvExtractionFanOut');

/**
 * @typedef {'en'|'de'} CvUiLang
 */

function resolveCvDocumentLang(text, docLangOpt) {
  if (docLangOpt === 'en' || docLangOpt === 'de') return docLangOpt;
  if (!text || !String(text).trim()) return 'en';
  return detectCvDocumentLanguage(text);
}

async function finalizeHeuristicFallbackPayload(text, options, ctx) {
  const { uiLanguage, cvLang, fin, semanticBlob } = options;
  const heuristicResult = runSyncStageIfCvPipeline('profile_heuristic_extract', () =>
    extractProfileDataFromDocumentTextHeuristic(text)
  );
  if (profileHasAnyExtractable(heuristicResult.profile)) {
    const heuristicPayload = {
      ...heuristicResult,
      profile: stripGoodAtFromProfile(heuristicResult.profile),
      status: 'partial',
      messageKey: ctx.semanticAiTimedOutRef.value
        ? 'documentUpload.extraction.aiTimeout'
        : 'documentUpload.extraction.heuristicFallback',
      message: ctx.semanticAiTimedOutRef.value
        ? 'AI extraction timed out. Basic fields from your CV are still shown.'
        : 'AI extraction was unavailable. Basic fields from your CV are still shown.',
    };
    return finalizeCvExtractionPayload(heuristicPayload, fin({
      cvLang,
      uiLang: uiLanguage,
      semantic: semanticBlob ?? null,
      semanticAiTimedOut: ctx.semanticAiTimedOutRef.value,
      semanticEnrichmentStatus: 'skipped',
    }));
  }

  const failurePayload = buildEmptyAiExtractionResult();
  if (ctx.semanticAiTimedOutRef.value) {
    failurePayload.status = 'partial';
    failurePayload.message = 'AI extraction timed out. Please review and complete your profile manually.';
    failurePayload.messageKey = 'documentUpload.extraction.aiTimeout';
  }

  return finalizeCvExtractionPayload(failurePayload, fin({
    cvLang,
    uiLang: uiLanguage,
    semantic: semanticBlob ?? null,
    semanticAiTimedOut: ctx.semanticAiTimedOutRef.value,
    semanticEnrichmentStatus: 'skipped',
  }));
}

/**
 * Heuristics → fan-out (identity + structured in parallel, narrative post-persist).
 * Worker awaits identity only (with UX fallback timeout); structured never blocks completion.
 */
async function runFanOutExtraction(text, options) {
  const uiLanguage = options.uiLanguage;
  const fin = options.fin;
  const cvLang = options.cvLang;
  const ctx = options.ctx;
  const jobId = options.jobId;

  const heuristicResult = runSyncStageIfCvPipeline('profile_heuristic_extract', () =>
    extractProfileDataFromDocumentTextHeuristic(text)
  );

  let identitySemantic = null;
  let structuredSemantic = null;

  if (jobId) {
    await emitHeuristicsCompletedAndFanOut(text, {
      jobId,
      userId: options.userId,
      documentId: options.documentId,
      uiLanguage,
      cvLang,
      heuristicResult,
      ctx,
    });
    identitySemantic = await awaitIdentityCompletion(jobId);
    structuredSemantic = await getStructuredResultIfSettled(jobId);
  } else {
    const inline = await runInlineSemanticFanOut(text, {
      cvLang,
      heuristicResult,
      ctx,
      identityFallbackMs: options.identityFallbackMs,
    });
    identitySemantic = inline.identitySemantic;
    structuredSemantic = null;
  }

  const combined = buildCombinedSemanticExtraction(
    heuristicResult,
    identitySemantic,
    structuredSemantic,
    { documentLanguage: cvLang }
  );

  const semanticEnrichmentStatus =
    structuredSemantic && (combined?.semanticEnrichmentStatus === 'complete')
      ? 'complete'
      : 'pending';

  if (combined && profileHasAnyExtractable(combined.profile)) {
    const payloadProfile =
      semanticEnrichmentStatus === 'complete'
        ? combined.profile
        : stripGoodAtFromProfile(combined.profile);
    return finalizeCvExtractionPayload(
      { ...combined, profile: payloadProfile },
      fin({
        cvLang,
        uiLang: uiLanguage,
        semantic: combined.semanticInterpretation ?? null,
        semanticAiTimedOut: false,
        semanticEnrichmentStatus,
        identityEnrichmentStatus: identitySemantic ? 'complete' : 'pending',
      })
    );
  }

  const semanticBlob = buildSemanticInterpretationBlob(identitySemantic, structuredSemantic);
  return finalizeHeuristicFallbackPayload(text, {
    uiLanguage,
    cvLang,
    fin,
    semanticBlob,
  }, ctx);
}

/**
 * @param {string} text parsed CV plain text
 * @param {{ uiLanguage?: CvUiLang, language?: CvUiLang, documentLanguage?: CvUiLang, skipLocalization?: boolean, jobId?: string, userId?: string, documentId?: string, identityFallbackMs?: number }} [options]
 */
async function extractProfileDataFromDocumentText(text, options = {}) {
  const uiLanguage = options.uiLanguage ?? options.language ?? 'en';
  const skipLocalization = Boolean(options.skipLocalization);
  const fin = (extra) => ({ ...extra, skipLocalization });
  let docLangOpt = options.documentLanguage
    ? String(options.documentLanguage).toLowerCase().split('-')[0]
    : null;
  if (docLangOpt && docLangOpt !== 'en' && docLangOpt !== 'de') {
    docLangOpt = null;
  }

  const cvLang = resolveCvDocumentLang(text, docLangOpt);

  if (!text || !String(text).trim()) {
    return finalizeCvExtractionPayload(buildEmptyAiExtractionResult('documentUpload.extraction.noDocumentText'), fin({
      cvLang,
      uiLang: uiLanguage,
      semantic: null,
      semanticAiTimedOut: false,
      semanticEnrichmentStatus: 'skipped',
    }));
  }

  const ctx = { semanticAiTimedOutRef: { value: false } };
  return runFanOutExtraction(text, {
    uiLanguage,
    fin,
    cvLang,
    ctx,
    jobId: options.jobId,
    userId: options.userId,
    documentId: options.documentId,
    identityFallbackMs: options.identityFallbackMs,
  });
}

/**
 * Full CV pipeline for a file on disk: OCR → heuristics → fan-out semantic layers.
 * @param {string} filePath
 * @param {{ uiLanguage?: 'en'|'de', jobId?: string, userId?: string, documentId?: string, onStage?: (stage: 'ocr'|'extraction', meta?: object) => Promise<void>|void }} [options]
 */
async function processCvExtractionFromFilePath(filePath, options = {}) {
  const uiLanguage = options.uiLanguage ?? 'en';
  const onStage = options.onStage;

  if (onStage) await onStage('ocr');
  const parsed = await parseDocumentToTextWithMeta(filePath);
  const rawText = parsed.text;
  const ocrTextLength = rawText ? String(rawText).length : 0;

  if (onStage) await onStage('extraction', { ocrTextLength });
  const extraction = await extractProfileDataFromDocumentText(rawText, {
    uiLanguage,
    skipLocalization: true,
    jobId: options.jobId,
    userId: options.userId,
    documentId: options.documentId,
  });

  return {
    ...extraction,
    extractedDocumentText: rawText,
    extractedDocumentTextSource: parsed.source,
  };
}

module.exports = {
  extractProfileDataFromDocumentText,
  processCvExtractionFromFilePath,
};
