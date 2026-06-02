jest.mock('../services/ai/translateText', () => ({
  translateCvExtractBatch: jest.fn(),
}));

const { translateCvExtractBatch } = require('../services/ai/translateText');
const {
  mergeCvExtractLocalizationPatch,
  overlayIdentityAnswersWithCvLocalization,
  overlayStructuredUserInfoListsWithCvLocalization,
  syncCvExtractUserIdentityFromFlat,
  localizeCvExtractedProfile,
  __testables,
} = require('../services/documents/cvExtractLocalization');

const { collectCvExtractLocalizationItems, buildCvI18nFromBatchResults } = __testables;

describe('cvExtractLocalization', () => {
  beforeEach(() => {
    translateCvExtractBatch.mockReset();
  });

  test('collectCvExtractLocalizationItems gathers identity and structured rows with stable ids', () => {
    const items = collectCvExtractLocalizationItems({
      userIdentity: { workEnjoyMost: 'Building products' },
      structuredUserInfo: {
        skillDomains: ['Leadership'],
        domains: [],
        keyResponsibilities: ['Ship features'],
        skillsInDevelopment: [],
        skills: [{ name: 'Python' }],
      },
    });
    expect(items).toEqual([
      { id: 'identity.workEnjoyMost', text: 'Building products' },
      { id: 'structured.skillDomains.0', text: 'Leadership' },
      { id: 'structured.keyResponsibilities.0', text: 'Ship features' },
      { id: 'structured.skills.0', text: 'Python' },
    ]);
  });

  test('buildCvI18nFromBatchResults maps EN document language to bilingual pairs', () => {
    const translations = new Map([
      ['identity.workEnjoyMost', 'Produkte entwickeln'],
      ['structured.skillDomains.0', 'Führung'],
    ]);
    const cvI18n = buildCvI18nFromBatchResults(
      {
        userIdentity: { workEnjoyMost: 'Building products' },
        structuredUserInfo: { skillDomains: ['Leadership'], domains: [], keyResponsibilities: [], skillsInDevelopment: [], skills: [] },
      },
      translations,
      'en',
      { partial: false }
    );
    expect(cvI18n.userIdentity.workEnjoyMost).toEqual({ en: 'Building products', de: 'Produkte entwickeln' });
    expect(cvI18n.structuredUserInfo.skillDomains[0]).toEqual({ en: 'Leadership', de: 'Führung' });
  });

  test('localizeCvExtractedProfile makes one batch translation call', async () => {
    translateCvExtractBatch.mockResolvedValue(
      new Map([
        ['identity.workEnjoyMost', 'Dinge schaffen'],
        ['structured.skillDomains.0', 'Führung'],
      ])
    );

    const profile = {
      userIdentity: { workEnjoyMost: 'Build things' },
      structuredUserInfo: {
        skillDomains: ['Leadership'],
        domains: [],
        keyResponsibilities: [],
        skillsInDevelopment: [],
        skills: [],
      },
    };

    const result = await localizeCvExtractedProfile(profile, 'en', 'en');

    expect(translateCvExtractBatch).toHaveBeenCalledTimes(1);
    expect(translateCvExtractBatch).toHaveBeenCalledWith(
      [
        { id: 'identity.workEnjoyMost', text: 'Build things' },
        { id: 'structured.skillDomains.0', text: 'Leadership' },
      ],
      'en'
    );
    expect(result.localizationStatus).toBe('complete');
    expect(result.profile.userIdentity.workEnjoyMost).toBe('Build things');
    expect(result.cvI18n.userIdentity.workEnjoyMost).toEqual({ en: 'Build things', de: 'Dinge schaffen' });
    expect(result.cvI18n.structuredUserInfo.skillDomains[0]).toEqual({ en: 'Leadership', de: 'Führung' });
  });

  test('localizeCvExtractedProfile skips batch call when nothing to translate', async () => {
    const result = await localizeCvExtractedProfile(
      { userIdentity: {}, structuredUserInfo: { skillDomains: [], domains: [], keyResponsibilities: [], skillsInDevelopment: [], skills: [] } },
      'en',
      'de'
    );
    expect(translateCvExtractBatch).not.toHaveBeenCalled();
    expect(result.localizationStatus).toBe('complete');
  });

  test('localizeCvExtractedProfile marks partial when batch throws', async () => {
    translateCvExtractBatch.mockRejectedValue(new Error('upstream'));
    const result = await localizeCvExtractedProfile(
      {
        userIdentity: { workEnjoyMost: 'Build' },
        structuredUserInfo: { skillDomains: [], domains: [], keyResponsibilities: [], skillsInDevelopment: [], skills: [] },
      },
      'en',
      'en'
    );
    expect(translateCvExtractBatch).toHaveBeenCalledTimes(1);
    expect(result.localizationStatus).toBe('partial');
    expect(result.cvI18n.userIdentity.workEnjoyMost).toEqual({ en: 'Build', de: 'Build' });
  });

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
