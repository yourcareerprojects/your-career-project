const {
  shouldEnsurePostExtractionTask,
  planIncludesTask,
} = require('../services/documents/cvPostExtractionExecutor');

describe('cvPostExtractionExecutor ensure gates', () => {
  test('localization is not part of post-extraction plan', () => {
    const input = {
      semanticEnrichmentStatus: 'complete',
      localizationStatus: 'pending',
      messageKey: null,
    };
    expect(planIncludesTask(input, 'localization')).toBe(false);
  });

  test('structured ensure allowed for heuristic retry via doc predicate', () => {
    const doc = {
      semanticEnrichmentStatus: 'skipped',
      localizationStatus: 'pending',
      extractionMessageKey: 'documentUpload.extraction.aiTimeout',
      path: '/cv.pdf',
    };
    expect(shouldEnsurePostExtractionTask(doc, 'structuredSemantic')).toBe(true);
    expect(shouldEnsurePostExtractionTask(doc, 'localization')).toBe(false);
  });
});
