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
    expect(result).toEqual({ status: 'processing', stage: 'extraction' });
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
        uploadDate: new Date(),
      },
      job: null,
    });
    expect(payload.status).toBe('completed');
    expect(payload.progress).toBe(100);
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
