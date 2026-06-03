const {
  resolveExtractionMachineStatus,
  buildCvExtractionStatusResponse,
} = require('../services/documents/cvExtractionStatus');
const { EXTRACTION_SLOW_WARNING_MS } = require('../../constants/cvExtractionTiming');

describe('cvExtractionStatus', () => {
  test('resolveExtractionMachineStatus maps job processing to processing', () => {
    const result = resolveExtractionMachineStatus({
      doc: { type: 'cv', extractionStatus: 'queued' },
      job: { status: 'processing', stage: 'extraction' },
    });
    expect(result.status).toBe('processing');
    expect(result.stage).toBe('extraction');
    expect(result.readiness.reviewReady).toBe(false);
  });

  test('buildCvExtractionStatusResponse uses only terminal machine statuses', () => {
    const now = new Date('2026-05-17T12:00:00.000Z');
    const payload = buildCvExtractionStatusResponse({
      documentId: '507f1f77bcf86cd799439011',
      doc: {
        type: 'cv',
        extractionStatus: 'queued',
        uploadDate: new Date(now.getTime() - 6 * 60 * 1000),
      },
      job: {
        jobId: 'abc',
        status: 'processing',
        stage: 'ocr',
        createdAt: new Date(now.getTime() - 11 * 60 * 1000),
        updatedAt: now,
      },
      now,
    });
    expect(['queued', 'processing', 'completed', 'failed']).toContain(payload.status);
    expect(payload.status).toBe('processing');
    expect(payload.progress).toBeGreaterThan(0);
    expect(payload.message).toBeTruthy();
    expect(payload.estimatedState).toBe('delayed');
    expect(payload.elapsedMs).toBeGreaterThanOrEqual(EXTRACTION_SLOW_WARNING_MS);
    expect(payload.isSlow).toBe(true);
    expect(payload.isStuck).toBe(true);
    expect(payload.estimatedDelayReason).toBe('system_load');
    expect(payload.retryRecommended).toBe(true);
  });

  test('legacy reference doc with completed outcome returns completed', () => {
    const payload = buildCvExtractionStatusResponse({
      documentId: '507f1f77bcf86cd799439012',
      doc: {
        type: 'reference',
        extractionOutcomeStatus: 'success',
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
        uploadDate: new Date(),
      },
      job: null,
    });
    expect(payload.status).toBe('completed');
    expect(payload.phase).toBe('ready');
    expect(payload.progress).toBe(100);
    expect(payload.reviewReady).toBe(true);
    expect(payload.reviewQuality).toBe('baseline');
    expect(payload.narrativesReady).toBe(true);
  });

  test('completed CV with pending enrichment reports enrichment progress and reviewReady', () => {
    const payload = buildCvExtractionStatusResponse({
      documentId: '507f1f77bcf86cd799439014',
      doc: {
        type: 'cv',
        extractionStatus: 'completed',
        extractedProfileData: { userIdentity: { workEnjoyMost: 'x' } },
        semanticEnrichmentStatus: 'pending',
        localizationStatus: 'pending',
      },
      job: { jobId: 'j1', status: 'completed', stage: 'extraction' },
    });
    expect(payload.status).toBe('completed');
    expect(payload.reviewReady).toBe(true);
    expect(payload.reviewQuality).toBe('baseline');
    expect(payload.isBackgroundEnriching).toBe(true);
    expect(payload.phase).toBe('enriching');
    expect(payload.blockingTask).toBe('structured');
    expect(payload.narrativesReady).toBe(false);
    expect(payload.backgroundEnrichment.narrative).toBe('idle');
    expect(payload.displayStage).toBe('enrichment');
    expect(payload.stage).toBe('structured');
    expect(payload.progress).toBe(78);
    expect(payload.message).toContain('Interpreting');
  });

  test('failed job surfaces failed status and errorKey only', () => {
    const payload = buildCvExtractionStatusResponse({
      documentId: '507f1f77bcf86cd799439013',
      doc: { type: 'cv', extractionStatus: 'failed' },
      job: { status: 'failed', error: 'OCR failed', stage: 'ocr' },
    });
    expect(payload.status).toBe('failed');
    expect(payload.errorKey).toBeTruthy();
    expect(payload.error).toBeUndefined();
    expect(payload.estimatedState).toBeNull();
  });
});
