const {
  determineExtractionErrorKey,
  resolvePublicErrorKey,
  serializeInternalError,
} = require('../services/documents/cvExtractionErrorClassifier');
const { EXTRACTION_ERROR_KEYS } = require('../../constants/cvExtractionErrors');
const { buildCvExtractionStatusResponse } = require('../services/documents/cvExtractionStatus');

describe('cvExtractionErrorClassifier', () => {
  test('determineExtractionErrorKey classifies timeouts in extraction stage', () => {
    const err = new Error('Request timed out');
    err.code = 'ETIMEDOUT';
    expect(determineExtractionErrorKey(err, { stage: 'extraction' })).toBe(
      EXTRACTION_ERROR_KEYS.AI_TIMEOUT
    );
  });

  test('determineExtractionErrorKey classifies rate limits', () => {
    const err = new Error('Rate limit exceeded');
    err.response = { status: 429 };
    expect(determineExtractionErrorKey(err, { stage: 'extraction' })).toBe(
      EXTRACTION_ERROR_KEYS.RATE_LIMITED
    );
  });

  test('resolvePublicErrorKey maps legacy error string without exposing it', () => {
    const key = resolvePublicErrorKey({
      status: 'failed',
      stage: 'extraction',
      error: 'OpenAI timeout after 90s at /var/app/src/secret/path.js:42:13',
    });
    expect(key).toBe(EXTRACTION_ERROR_KEYS.AI_TIMEOUT);
  });

  test('serializeInternalError retains stack for logs only', () => {
    const err = new Error('provider failure');
    err.stack = 'Error: provider failure\n    at /secret/path.js:10:5';
    const internal = serializeInternalError(err);
    expect(internal.message).toContain('provider');
    expect(internal.stack).toContain('/secret/path.js');
  });
});

describe('buildCvExtractionStatusResponse error sanitization', () => {
  test('failed extraction returns errorKey only, never raw error or stack', () => {
    const payload = buildCvExtractionStatusResponse({
      documentId: '507f1f77bcf86cd799439011',
      doc: { type: 'cv', extractionStatus: 'failed' },
      job: {
        status: 'failed',
        stage: 'extraction',
        errorKey: EXTRACTION_ERROR_KEYS.EXTRACTION_FAILED,
        internalError: {
          message: 'OpenAI 502 Bad Gateway',
          stack: 'Error: OpenAI\n    at /app/src/server.js:1:1',
        },
        error: 'legacy raw should not leak',
      },
    });
    expect(payload.status).toBe('failed');
    expect(payload.errorKey).toBe(EXTRACTION_ERROR_KEYS.EXTRACTION_FAILED);
    expect(payload.error).toBeUndefined();
    expect(JSON.stringify(payload)).not.toMatch(/stack/i);
    expect(JSON.stringify(payload)).not.toMatch(/OpenAI 502/);
    expect(JSON.stringify(payload)).not.toMatch(/\/app\/src/);
  });

  test('legacy job without errorKey still returns safe key', () => {
    const payload = buildCvExtractionStatusResponse({
      documentId: '507f1f77bcf86cd799439012',
      doc: { type: 'cv', extractionStatus: 'failed' },
      job: {
        status: 'failed',
        stage: 'upload',
        error: 'ENOENT: no such file /uploads/documents/secret.pdf',
      },
    });
    expect(payload.errorKey).toBe(EXTRACTION_ERROR_KEYS.FILE_PARSE_FAILED);
    expect(payload.error).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('secret.pdf');
  });
});
