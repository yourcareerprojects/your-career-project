const {
  mergeCvExtractLocalizationPatch,
  overlayIdentityAnswersWithCvLocalization,
  overlayStructuredUserInfoListsWithCvLocalization,
  syncCvExtractUserIdentityFromFlat,
} = require('../services/documents/cvExtractLocalization');

describe('cvExtractLocalization', () => {
  test('mergeCvExtractLocalizationPatch merges documentLanguage, identity pairs, and structured arrays', () => {
    const existing = {
      documentLanguage: 'en',
      userIdentity: {
        workEnjoyMost: { en: 'A', de: 'B' },
      },
      structuredUserInfo: {
        skillDomains: [{ en: 'Lead', de: 'Führung' }],
      },
    };
    const merged = mergeCvExtractLocalizationPatch(existing, {
      documentLanguage: 'de',
      userIdentity: {
        topicsIndustriesInterest: { en: 'SaaS', de: 'Saas' },
      },
      structuredUserInfo: {
        domains: [{ en: 'Health', de: 'Gesundheit' }],
      },
    });
    expect(merged.documentLanguage).toBe('de');
    expect(merged.userIdentity.workEnjoyMost).toEqual({ en: 'A', de: 'B' });
    expect(merged.userIdentity.topicsIndustriesInterest).toEqual({ en: 'SaaS', de: 'Saas' });
    expect(merged.structuredUserInfo.skillDomains).toHaveLength(1);
    expect(merged.structuredUserInfo.domains).toHaveLength(1);
  });

  test('overlayIdentityAnswersWithCvLocalization picks active UI language', () => {
    const flat = mergeCvExtractLocalizationPatch(null, {
      userIdentity: {
        workEnjoyMost: { en: 'Build things', de: 'Dinge schaffen' },
      },
    });
    const merged = { workEnjoyMost: 'ignored', topicsIndustriesInterest: 'x' };
    const de = overlayIdentityAnswersWithCvLocalization(merged, flat.userIdentity, 'de');
    expect(de.workEnjoyMost).toBe('Dinge schaffen');
    expect(de.topicsIndustriesInterest).toBe('x');
    const en = overlayIdentityAnswersWithCvLocalization(merged, flat.userIdentity, 'en');
    expect(en.workEnjoyMost).toBe('Build things');
  });

  test('syncCvExtractUserIdentityFromFlat updates the active locale slot', () => {
    const root = mergeCvExtractLocalizationPatch(null, {
      userIdentity: {
        workEnjoyMost: { en: 'Old', de: 'Alt' },
      },
    });
    const answers = { workEnjoyMost: 'New EN' };
    syncCvExtractUserIdentityFromFlat(root, answers, 'en');
    expect(root.userIdentity.workEnjoyMost).toEqual({ en: 'New EN', de: 'Alt' });
  });

  test('overlayStructuredUserInfoListsWithCvLocalization restores EN chip labels from bilingual CV rows', () => {
    const cvRoot = {
      structuredUserInfo: {
        skillDomains: [
          { en: 'Leadership', de: 'Führung' },
          { en: 'Analysis', de: 'Analyse' },
        ],
        skills: [{ name: { en: 'SQL', de: 'SQL' } }, { name: { en: 'Python', de: 'Python' } }],
      },
    };
    const structured = {
      skillDomains: {
        raw_items: ['Führung', 'Analyse'],
        summary_text: { en: 'EN sum', de: 'DE sum' },
      },
      skills: {
        raw_items: ['SQL', 'Python'],
        summary_text: { en: 's', de: 's' },
      },
    };
    const en = overlayStructuredUserInfoListsWithCvLocalization(structured, cvRoot, 'en');
    expect(en.skillDomains.raw_items).toEqual(['Leadership', 'Analysis']);
    expect(en.skills.raw_items).toEqual(['SQL', 'Python']);
    const de = overlayStructuredUserInfoListsWithCvLocalization(structured, cvRoot, 'de');
    expect(de.skillDomains.raw_items).toEqual(['Führung', 'Analyse']);
  });

  test('overlayStructuredUserInfoListsWithCvLocalization skills emits string raw_items (not { name } objects)', () => {
    const cvRoot = {
      structuredUserInfo: {
        skills: [{ name: { en: 'Analytics', de: 'Analytik' } }],
      },
    };
    const structured = {
      skills: {
        raw_items: [{ name: 'Analytics' }],
        summary_text: { en: 's', de: 's' },
      },
    };
    const out = overlayStructuredUserInfoListsWithCvLocalization(structured, cvRoot, 'de');
    expect(out.skills.raw_items).toEqual(['Analytik']);
    expect(typeof out.skills.raw_items[0]).toBe('string');
  });
});
