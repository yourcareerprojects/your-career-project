const { getExtractionErrorMessage } = require('../utils/cvExtractionErrors');
const { EXTRACTION_ERROR_KEYS } = require('../../constants/cvExtractionErrors');

function mockT(key) {
  const map = {
    'documentUpload.extractionErrors.OCR_FAILED': 'We could not read the document.',
    'documentUpload.extractionErrors.fallback': 'Something went wrong while processing your document.',
  };
  return map[key] || key;
}

describe('getExtractionErrorMessage', () => {
  test('maps known errorKey to localized message', () => {
    expect(getExtractionErrorMessage(EXTRACTION_ERROR_KEYS.OCR_FAILED, mockT)).toBe(
      'We could not read the document.'
    );
  });

  test('unknown errorKey uses safe fallback', () => {
    expect(getExtractionErrorMessage('TOTALLY_UNKNOWN', mockT)).toBe(
      'Something went wrong while processing your document.'
    );
  });

  test('missing errorKey uses safe fallback', () => {
    expect(getExtractionErrorMessage(null, mockT)).toBe(
      'Something went wrong while processing your document.'
    );
  });

  test('never returns raw backend strings', () => {
    const msg = getExtractionErrorMessage('OpenAI timeout at /secret', mockT);
    expect(msg).not.toContain('OpenAI');
    expect(msg).not.toContain('/secret');
  });
});
