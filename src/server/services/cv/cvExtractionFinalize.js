/**
 * Post-extraction payload: semantic blob attachment, localization, timeout/partial semantics.
 */

const logger = require('../../utils/logger');
const {
  localizeCvExtractedProfile,
  fallbackCvProfileWithoutLocalization,
} = require('../documents/cvExtractLocalization');
const { normalizeExternalApiError } = require('../../utils/httpTimeouts');
const {
  runStageIfCvPipeline,
  getCvPipeline,
} = require('../../utils/metricsLogger');
const { profileHasAnyExtractable } = require('./cvSemanticMap');

/**
 * Completes extraction payload: attaches semantic blob metadata, bilingual bundles (`cvExtractLocalization`),
 * and flattens profile strings for the active UI locale (`uiLang`).
 */
async function finalizeCvExtractionPayload(payload, options = {}) {
  const skipLocalization = Boolean(options.skipLocalization);
  return runStageIfCvPipeline('extraction_finalize', { memory: true }, async () => {
    const semantic = options.semantic ?? null;
    const semanticAiTimedOut = Boolean(options.semanticAiTimedOut);
    const cvLang = options.cvLang;
    const uiLang = options.uiLang;

    const docLang = cvLang === 'de' ? 'de' : 'en';
    const uiLanguage = String(uiLang || 'en').toLowerCase().split('-')[0] || 'en';
    const base = {
      ...payload,
      semanticInterpretation: semantic ?? null,
      semanticInterpretationLanguage: docLang,
    };

    const applyAiTimeoutSemantics = (result) => {
      if (!semanticAiTimedOut) return result;
      if (!profileHasAnyExtractable(result.profile)) return result;
      return {
        ...result,
        status: 'partial',
        message: 'AI extraction timed out. Basic fields from your CV are still shown.',
        messageKey: 'documentUpload.extraction.aiTimeout',
      };
    };

    if (!profileHasAnyExtractable(base.profile)) {
      return applyAiTimeoutSemantics({
        ...base,
        cvExtractLocalization: null,
        localizationStatus: 'skipped',
        semanticEnrichmentStatus: options.semanticEnrichmentStatus ?? null,
      });
    }

    if (skipLocalization) {
      return applyAiTimeoutSemantics({
        ...base,
        cvExtractLocalization: null,
        localizationStatus: 'idle',
        semanticEnrichmentStatus: options.semanticEnrichmentStatus ?? 'complete',
      });
    }

    try {
      const localized = await runStageIfCvPipeline(
        'localize_cv_extracted_profile',
        { memory: true },
        async () => localizeCvExtractedProfile(base.profile, docLang, uiLanguage)
      );
      return applyAiTimeoutSemantics({
        ...base,
        profile: localized.profile,
        cvExtractLocalization: localized.cvI18n,
        localizationStatus: localized.localizationStatus || 'complete',
      });
    } catch (err) {
      logger.error('CV extraction localization failed; using raw extracted profile', {
        ...(getCvPipeline() ? { requestId: getCvPipeline().requestId } : {}),
        ...normalizeExternalApiError(err),
        ...(err instanceof Error ? { stack: err.stack } : {}),
      });
      const flat = fallbackCvProfileWithoutLocalization(base.profile, uiLanguage);
      return applyAiTimeoutSemantics({
        ...base,
        profile: flat,
        cvExtractLocalization: null,
        localizationStatus: 'skipped',
      });
    }
  });
}

module.exports = {
  finalizeCvExtractionPayload,
};
