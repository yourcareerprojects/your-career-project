const {
  computeCvExtractionReadiness,
  legacyPollStageFromReadiness,
  deriveNarrativeTaskStatus,
} = require('../services/documents/cvExtractionReadiness');

/** Minimal cache that passes getDocumentNarrativeCacheReadiness (empty lists = nothing to generate). */
function narrativeReadyDocExtras() {
  return {
    narrativeEnrichment: {
      qualityVersion: 1,
      structuredUserInfo: {
        skillDomains: {},
        skills: {},
        skillsInDevelopment: {},
        keyResponsibilities: {},
        domains: {},
      },
      who_are_you: { raw_answers: [] },
    },
  };
}

describe('computeCvExtractionReadiness', () => {
  test('worker processing maps to processing pipeline and extraction phase', () => {
    const readiness = computeCvExtractionReadiness(
      { type: 'cv', extractionStatus: 'queued' },
      { status: 'processing', stage: 'extraction' }
    );
    expect(readiness.pipeline).toBe('processing');
    expect(readiness.phase).toBe('extraction');
    expect(readiness.reviewReady).toBe(false);
    expect(readiness.displayStage).toBe('extraction');
    expect(readiness.isBackgroundEnriching).toBe(false);
    expect(readiness.backgroundEnrichment.narrative).toBe('idle');
  });

  test('completed doc with pending structured is review-ready baseline and enriching', () => {
    const readiness = computeCvExtractionReadiness({
      type: 'resume',
      extractionStatus: 'completed',
      extractionOutcomeStatus: 'partial',
      extractedProfileData: { userIdentity: { workEnjoyMost: 'x' } },
      semanticEnrichmentStatus: 'pending',
      localizationStatus: 'pending',
    });
    expect(readiness.pipeline).toBe('completed');
    expect(readiness.phase).toBe('enriching');
    expect(readiness.reviewReady).toBe(true);
    expect(readiness.reviewQuality).toBe('baseline');
    expect(readiness.isBackgroundEnriching).toBe(true);
    expect(readiness.displayStage).toBe('enrichment');
    expect(readiness.blockingTask).toBe('structured');
    expect(readiness.backgroundEnrichment.structured).toBe('pending');
    expect(readiness.backgroundEnrichment.localization).toBe('pending');
    expect(readiness.backgroundEnrichment.narrative).toBe('idle');
    expect(readiness.narrativesReady).toBe(false);
  });

  test('completed doc with structured complete and narrative cache is full quality and ready phase', () => {
    const readiness = computeCvExtractionReadiness({
      type: 'cv',
      extractionStatus: 'completed',
      extractedProfileData: { structuredUserInfo: { skillDomains: ['Leadership'] } },
      semanticEnrichmentStatus: 'complete',
      localizationStatus: 'complete',
      ...narrativeReadyDocExtras(),
    });
    expect(readiness.reviewQuality).toBe('full');
    expect(readiness.phase).toBe('ready');
    expect(readiness.isBackgroundEnriching).toBe(false);
    expect(readiness.displayStage).toBe('done');
    expect(readiness.narrativesReady).toBe(true);
    expect(readiness.backgroundEnrichment.narrative).toBe('complete');
  });

  test('idle localization alone does not block background enrichment', () => {
    const readiness = computeCvExtractionReadiness({
      type: 'cv',
      extractionStatus: 'completed',
      extractedProfileData: { userIdentity: { workEnjoyMost: 'x' } },
      semanticEnrichmentStatus: 'complete',
      localizationStatus: 'idle',
      ...narrativeReadyDocExtras(),
    });
    expect(readiness.phase).toBe('ready');
    expect(readiness.isBackgroundEnriching).toBe(false);
    expect(readiness.blockingTask).toBe(null);
    expect(readiness.backgroundEnrichment.localization).toBe('idle');
  });

  test('structured complete without narrative cache keeps narrative pending but does not block UI', () => {
    const readiness = computeCvExtractionReadiness({
      type: 'cv',
      extractionStatus: 'completed',
      extractedProfileData: { structuredUserInfo: { skillDomains: ['Leadership'] } },
      semanticEnrichmentStatus: 'complete',
      localizationStatus: 'complete',
    });
    expect(readiness.reviewQuality).toBe('full');
    expect(readiness.phase).toBe('ready');
    expect(readiness.isBackgroundEnriching).toBe(false);
    expect(readiness.blockingTask).toBe(null);
    expect(readiness.backgroundEnrichment.narrative).toBe('pending');
    expect(readiness.narrativesReady).toBe(false);
  });

  test('failed extraction is not review-ready', () => {
    const readiness = computeCvExtractionReadiness({
      type: 'cv',
      extractionStatus: 'failed',
      extractionOutcomeStatus: 'failed',
    });
    expect(readiness.pipeline).toBe('failed');
    expect(readiness.phase).toBe('failed');
    expect(readiness.reviewReady).toBe(false);
    expect(readiness.reviewQuality).toBe('none');
    expect(readiness.backgroundEnrichment.narrative).toBe('idle');
  });

  test('legacyPollStageFromReadiness maps done to done and enriching to blocking task', () => {
    const ready = computeCvExtractionReadiness({
      type: 'cv',
      extractionStatus: 'completed',
      extractedProfileData: {},
      semanticEnrichmentStatus: 'complete',
      localizationStatus: 'skipped',
      ...narrativeReadyDocExtras(),
    });
    expect(legacyPollStageFromReadiness(ready)).toBe('done');

    const enriching = computeCvExtractionReadiness({
      type: 'cv',
      extractionStatus: 'completed',
      extractedProfileData: { userIdentity: { workEnjoyMost: 'x' } },
      semanticEnrichmentStatus: 'pending',
      localizationStatus: 'pending',
    });
    expect(legacyPollStageFromReadiness(enriching)).toBe('structured');
  });

  test('legacyPollStageFromReadiness falls back to enrichment when no blocking task', () => {
    const readiness = {
      displayStage: 'enrichment',
      blockingTask: null,
    };
    expect(legacyPollStageFromReadiness(readiness)).toBe('enrichment');
  });
});

describe('deriveNarrativeTaskStatus', () => {
  test('narrative is idle while structured enrichment is pending', () => {
    expect(
      deriveNarrativeTaskStatus(
        { extractedProfileData: { x: 1 } },
        'completed',
        'pending'
      )
    ).toBe('idle');
  });

  test('narrative is pending when structured done but cache missing', () => {
    expect(
      deriveNarrativeTaskStatus(
        { extractedProfileData: { x: 1 }, semanticEnrichmentStatus: 'complete' },
        'completed',
        'complete'
      )
    ).toBe('pending');
  });

  test('persisted narrativeEnrichmentStatus pending wins over missing cache', () => {
    const readiness = computeCvExtractionReadiness({
      type: 'cv',
      extractionStatus: 'completed',
      extractedProfileData: { userIdentity: { workEnjoyMost: 'x' } },
      semanticEnrichmentStatus: 'complete',
      localizationStatus: 'complete',
      narrativeEnrichmentStatus: 'pending',
    });
    expect(readiness.backgroundEnrichment.narrative).toBe('pending');
    expect(readiness.blockingTask).toBe(null);
    expect(readiness.phase).toBe('ready');
  });

  test('persisted narrativeEnrichmentStatus complete marks narratives ready', () => {
    const readiness = computeCvExtractionReadiness({
      type: 'cv',
      extractionStatus: 'completed',
      extractedProfileData: {},
      semanticEnrichmentStatus: 'complete',
      localizationStatus: 'complete',
      narrativeEnrichmentStatus: 'complete',
      ...narrativeReadyDocExtras(),
    });
    expect(readiness.narrativesReady).toBe(true);
    expect(readiness.phase).toBe('ready');
  });

  test('legacy reference doc with narrative enrichment bypasses CV narrative quality gate', () => {
    expect(
      deriveNarrativeTaskStatus(
        {
          type: 'reference',
          extractedProfileData: { foo: 1 },
          narrativeEnrichment: {
            structuredUserInfo: {
              skillDomains: {},
              skills: {},
              skillsInDevelopment: {},
              keyResponsibilities: {},
              domains: {},
            },
            who_are_you: { raw_answers: [] },
          },
        },
        'completed',
        'idle'
      )
    ).toBe('complete');
  });
});
