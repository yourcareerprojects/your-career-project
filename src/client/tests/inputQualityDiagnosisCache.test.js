const {
  qualityDiagnosisFingerprint,
  qualityDiagnosisInputFromProfile,
  inputQualityDiagnosisPrefetchDebounceMs,
  diagnosisCacheMapToDraft,
  diagnosisCacheMapFromDraft,
  trimDiagnosisCacheMap,
} = require('../utils/inputQualityDiagnosisCache');

describe('inputQualityDiagnosisCache', () => {
  test('qualityDiagnosisInputFromProfile extracts identity and two structured lists', () => {
    const input = qualityDiagnosisInputFromProfile({
      userIdentity: { workEnjoyMost: '  design  ' },
      structuredUserInfo: {
        keyResponsibilities: [' Lead '],
        skillsInDevelopment: [''],
        skillDomains: ['ignored'],
        domains: ['ignored'],
        skills: [{ name: 'ignored' }],
      },
    });
    expect(input.userIdentity.workEnjoyMost).toBe('design');
    expect(input.structuredUserInfo.keyResponsibilities).toEqual(['Lead']);
    expect(input.structuredUserInfo.skillsInDevelopment).toEqual([]);
  });

  test('qualityDiagnosisFingerprint changes when diagnosis fields change', () => {
    const base = {
      userIdentity: { workEnjoyMost: 'a' },
      structuredUserInfo: { keyResponsibilities: ['r'], skillsInDevelopment: ['g'] },
    };
    const fp1 = qualityDiagnosisFingerprint(base, 'en');
    const fp2 = qualityDiagnosisFingerprint(
      {
        ...base,
        structuredUserInfo: { ...base.structuredUserInfo, keyResponsibilities: ['r2'] },
      },
      'en'
    );
    const fpSeniority = qualityDiagnosisFingerprint(
      { ...base, seniority: { yearsOfExperience: 10 } },
      'en'
    );
    expect(fp1).not.toBe(fp2);
    expect(fp1).toBe(fpSeniority);
  });

  test('qualityDiagnosisFingerprint includes language', () => {
    const profile = {
      userIdentity: { workEnjoyMost: 'a' },
      structuredUserInfo: { keyResponsibilities: [], skillsInDevelopment: [] },
    };
    expect(qualityDiagnosisFingerprint(profile, 'de')).not.toBe(qualityDiagnosisFingerprint(profile, 'en'));
  });

  test('inputQualityDiagnosisPrefetchDebounceMs debounces step 3 only', () => {
    expect(inputQualityDiagnosisPrefetchDebounceMs(3)).toBe(250);
    expect(inputQualityDiagnosisPrefetchDebounceMs(4)).toBe(0);
    expect(inputQualityDiagnosisPrefetchDebounceMs(2)).toBe(0);
  });

  test('diagnosisCacheMapToDraft round-trips through diagnosisCacheMapFromDraft', () => {
    const map = new Map([
      ['fp-a', { followUps: [{ field: 'userIdentity.workEnjoyMost', follow_up_question: 'Q?' }] }],
    ]);
    const restored = diagnosisCacheMapFromDraft(diagnosisCacheMapToDraft(map));
    expect(restored.get('fp-a').followUps[0].field).toBe('userIdentity.workEnjoyMost');
  });

  test('trimDiagnosisCacheMap caps entry count', () => {
    const map = new Map();
    for (let i = 0; i < 20; i += 1) map.set(`k${i}`, { followUps: [{ field: 'x' }] });
    trimDiagnosisCacheMap(map, 5);
    expect(map.size).toBe(5);
  });
});
