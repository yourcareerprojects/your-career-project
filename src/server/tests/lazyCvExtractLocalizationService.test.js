const {
  cvExtractNeedsLocalization,
  documentSourceLanguage,
} = require('../services/documents/lazyCvExtractLocalizationService');

describe('lazyCvExtractLocalizationService', () => {
  test('cvExtractNeedsLocalization when UI language differs from CV source', () => {
    expect(
      cvExtractNeedsLocalization(
        {
          extractionStatus: 'completed',
          extractedProfileData: { userIdentity: {} },
          semanticInterpretationLanguage: 'de',
          localizationStatus: 'idle',
        },
        'en'
      )
    ).toBe(true);
  });

  test('cvExtractNeedsLocalization false when UI matches source', () => {
    expect(
      cvExtractNeedsLocalization(
        {
          extractionStatus: 'completed',
          extractedProfileData: { userIdentity: {} },
          semanticInterpretationLanguage: 'en',
          localizationStatus: 'idle',
        },
        'en'
      )
    ).toBe(false);
  });

  test('cvExtractNeedsLocalization false when already complete', () => {
    expect(
      cvExtractNeedsLocalization(
        {
          extractionStatus: 'completed',
          extractedProfileData: { userIdentity: {} },
          semanticInterpretationLanguage: 'de',
          localizationStatus: 'complete',
        },
        'en'
      )
    ).toBe(false);
  });

  test('documentSourceLanguage prefers semanticInterpretationLanguage', () => {
    expect(
      documentSourceLanguage({
        semanticInterpretationLanguage: 'de',
        cvExtractLocalization: { documentLanguage: 'en' },
      })
    ).toBe('de');
  });
});
