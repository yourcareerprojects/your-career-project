const {
  normalizePdfPlainText,
  isPdfTextLayerSufficient,
} = require('../services/documents/pdfTextExtraction');

describe('pdfTextExtraction', () => {
  describe('normalizePdfPlainText', () => {
    test('collapses whitespace and nbsp', () => {
      expect(normalizePdfPlainText('Jane\u00a0Doe\n\n  Engineer')).toBe('Jane Doe Engineer');
    });
  });

  describe('isPdfTextLayerSufficient', () => {
    test('rejects empty text', () => {
      expect(isPdfTextLayerSufficient('')).toBe(false);
      expect(isPdfTextLayerSufficient('   ')).toBe(false);
    });

    test('rejects short metadata-only snippets', () => {
      expect(isPdfTextLayerSufficient('Adobe PDF Library')).toBe(false);
      expect(isPdfTextLayerSufficient('Page 1')).toBe(false);
    });

    test('accepts realistic CV-like text', () => {
      const cvText = [
        'Jane Doe',
        'Senior Product Manager with eight years of experience in B2B SaaS, healthcare, and platform teams.',
        'Skills include stakeholder management, roadmap planning, user research, SQL, and cross-functional leadership.',
        'Experience leading product discovery and delivery for enterprise customers across Europe.',
      ].join(' ');
      expect(isPdfTextLayerSufficient(cvText)).toBe(true);
    });

    test('rejects mostly numeric or punctuation garbage', () => {
      const garbage = '1234567890123456789012345678901234567890123456789012345678901234567890!!!!!!';
      expect(isPdfTextLayerSufficient(garbage)).toBe(false);
    });
  });
});
