const {
  planPostExtractionWork,
  needsDeferredStructuredSemantic,
  structuredSettledForNarrative,
} = require('../services/documents/cvPostExtractionWorkPlanner');

describe('planPostExtractionWork', () => {
  test('pending structured schedules only structured semantic (narrative waits)', () => {
    const plan = planPostExtractionWork({
      semanticEnrichmentStatus: 'pending',
      localizationStatus: 'pending',
      messageKey: null,
      narrativeEnrichmentStatus: null,
    });
    expect(plan).toEqual([
      { task: 'structuredSemantic', reason: 'semantic_pending_or_heuristic_retry' },
    ]);
  });

  test('complete semantic schedules only narrative when not cached', () => {
    const plan = planPostExtractionWork({
      semanticEnrichmentStatus: 'complete',
      localizationStatus: 'pending',
      messageKey: null,
      narrativeEnrichmentStatus: null,
    });
    expect(plan.map((p) => p.task)).toEqual(['narrative']);
  });

  test('heuristic/timeout fallback schedules only structured until structured settles', () => {
    expect(
      needsDeferredStructuredSemantic({
        semanticEnrichmentStatus: 'skipped',
        messageKey: 'documentUpload.extraction.heuristicFallback',
      })
    ).toBe(true);
    expect(
      structuredSettledForNarrative({
        semanticEnrichmentStatus: 'skipped',
        messageKey: 'documentUpload.extraction.heuristicFallback',
      })
    ).toBe(false);

    const plan = planPostExtractionWork({
      semanticEnrichmentStatus: 'skipped',
      localizationStatus: 'pending',
      messageKey: 'documentUpload.extraction.aiTimeout',
      narrativeEnrichmentStatus: null,
    });
    expect(plan.map((p) => p.task)).toEqual(['structuredSemantic']);
  });

  test('after deferred structured completes, schedules narrative only', () => {
    const plan = planPostExtractionWork({
      semanticEnrichmentStatus: 'complete',
      localizationStatus: 'idle',
      messageKey: null,
      narrativeEnrichmentStatus: null,
    });
    expect(plan).toEqual([
      { task: 'narrative', reason: 'structured_settled' },
    ]);
  });

  test('complete semantic and narrative skipped schedules nothing', () => {
    const plan = planPostExtractionWork({
      semanticEnrichmentStatus: 'complete',
      localizationStatus: 'complete',
      messageKey: null,
      narrativeEnrichmentStatus: 'complete',
    });
    expect(plan).toEqual([]);
  });
});
