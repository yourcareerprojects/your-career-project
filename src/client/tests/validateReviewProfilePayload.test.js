const {
  validateReviewProfileInDialog,
  validateReviewIdentityStep,
  validateReviewSavePayload,
  parseReviewSaveValidationErrors,
  translateReviewFieldErrors,
  buildStructuredGoodAtFromReview,
  resolveReviewFocusStep,
} = require('../utils/validateReviewProfilePayload');

const identity = {
  workEnjoyMost: 'ok',
  topicsIndustriesInterest: 'ok',
  naturallyGoodAt: 'ok',
  workEnvironmentFit: 'ok',
  workingLifeAchievement: 'ok',
};

const fullStructured = {
  skillDomains: ['Analytics'],
  domains: ['Finance'],
  keyResponsibilities: ['Lead projects'],
  skills: [{ name: 'JavaScript' }],
  skillsInDevelopment: ['Rust'],
};

describe('resolveReviewFocusStep', () => {
  test('maps field keys to wizard steps', () => {
    expect(resolveReviewFocusStep('userIdentity.workEnjoyMost')).toBe(2);
    expect(resolveReviewFocusStep('structuredUserInfo.skills.0')).toBe(3);
    expect(resolveReviewFocusStep('seniority.highestDegree')).toBe(5);
    expect(resolveReviewFocusStep('customFollowUp')).toBe(4);
  });
});

describe('validateReviewIdentityStep', () => {
  test('flags each empty identity field', () => {
    const result = validateReviewIdentityStep({
      userIdentity: {
        workEnjoyMost: 'filled',
        topicsIndustriesInterest: '',
        naturallyGoodAt: 'ok',
        workEnvironmentFit: 'ok',
        workingLifeAchievement: 'ok',
      },
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors['userIdentity.topicsIndustriesInterest']).toBeDefined();
    expect(result.focusStep).toBe(2);
  });

  test('translates identity required with question text', () => {
    const translated = translateReviewFieldErrors(
      {
        'userIdentity.workEnjoyMost': {
          i18nKey: 'documentUpload.review.errors.identityRequired',
          params: { questionKey: 'identityQuestions.workEnjoyMost' },
        },
      },
      (key, params = {}) =>
        params.question ? `${key}:${params.question}` : key
    );
    expect(translated['userIdentity.workEnjoyMost']).toMatch(/identityRequired:identityQuestions/);
  });
});

describe('validateReviewProfileInDialog', () => {
  test('flags identity field over max length', () => {
    const long = 'x'.repeat(2001);
    const result = validateReviewProfileInDialog(
      { userIdentity: { ...identity, workEnjoyMost: long }, structuredUserInfo: {} },
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.fieldErrors['userIdentity.workEnjoyMost']).toBeDefined();
    expect(result.focusStep).toBe(2);
  });

  test('flags accepted structured row over max length', () => {
    const result = validateReviewProfileInDialog(
      {
        userIdentity: identity,
        structuredUserInfo: {
          skills: [{ name: 'x'.repeat(101) }],
        },
      },
      { 'structuredUserInfo.skills.0': true }
    );
    expect(result.ok).toBe(false);
    expect(result.fieldErrors['structuredUserInfo.skills.0']).toBeDefined();
    expect(result.focusStep).toBe(3);
  });

  test('ignores unchecked structured rows', () => {
    const result = validateReviewProfileInDialog(
      {
        userIdentity: identity,
        structuredUserInfo: {
          skills: [{ name: 'x'.repeat(101) }],
        },
      },
      { 'structuredUserInfo.skills.0': false }
    );
    expect(result.ok).toBe(true);
  });
});

describe('requireGoodAt — all subcategories filled', () => {
  test('allows continue when every subcategory has an accepted entry', () => {
    const result = validateReviewProfileInDialog(
      { userIdentity: identity, structuredUserInfo: fullStructured },
      {},
      { requireGoodAt: true }
    );
    expect(result.ok).toBe(true);
  });

  test('blocks when any subcategory is empty', () => {
    const result = validateReviewProfileInDialog(
      {
        userIdentity: identity,
        structuredUserInfo: {
          ...fullStructured,
          domains: [],
        },
      },
      {},
      { requireGoodAt: true }
    );
    expect(result.ok).toBe(false);
    expect(result.fieldErrors['structuredUserInfo.domains']).toBeDefined();
    expect(result.focusStep).toBe(3);
  });

  test('does not require good at when requireGoodAt is false', () => {
    const result = validateReviewProfileInDialog(
      {
        userIdentity: identity,
        structuredUserInfo: { skills: [{ name: '' }] },
      },
      { 'structuredUserInfo.skills.0': true },
      { requireGoodAt: false }
    );
    expect(result.ok).toBe(true);
  });

  test('empty category with only unchecked rows fails', () => {
    const result = validateReviewProfileInDialog(
      {
        userIdentity: identity,
        structuredUserInfo: {
          ...fullStructured,
          skills: [{ name: 'Go' }],
        },
      },
      { 'structuredUserInfo.skills.0': false },
      { requireGoodAt: true }
    );
    expect(result.ok).toBe(false);
    expect(result.fieldErrors['structuredUserInfo.skills']).toBeDefined();
  });

  test('buildStructuredGoodAtFromReview respects accepted checkboxes', () => {
    const profile = {
      structuredUserInfo: {
        skills: [{ name: 'Go' }, { name: '' }],
        skillDomains: ['ignored'],
      },
    };
    expect(
      buildStructuredGoodAtFromReview(profile, {
        'structuredUserInfo.skills.1': false,
        'structuredUserInfo.skillDomains.0': false,
      })
    ).toEqual({
      skillDomains: [],
      domains: [],
      keyResponsibilities: [],
      skillsInDevelopment: [],
      skills: ['Go'],
    });
  });

  test('buildStructuredGoodAtFromReview caps each category to its own limit', () => {
    const profile = {
      structuredUserInfo: {
        skillDomains: ['a', 'b', 'c', 'd', 'e', 'f'],
        domains: ['x', 'y', 'z', 'w', 'v', 'u'],
        keyResponsibilities: Array.from({ length: 30 }, (_, i) => `task ${i}`),
        skills: Array.from({ length: 30 }, (_, i) => ({ name: `skill ${i}` })),
        skillsInDevelopment: Array.from({ length: 30 }, (_, i) => `learn ${i}`),
      },
    };
    const built = buildStructuredGoodAtFromReview(profile);
    expect(built.skillDomains).toHaveLength(5);
    expect(built.domains).toHaveLength(5);
    expect(built.keyResponsibilities).toHaveLength(25);
    expect(built.skills).toHaveLength(25);
    expect(built.skillsInDevelopment).toHaveLength(25);
  });
});

describe('validateReviewSavePayload', () => {
  test('rejects payload when any subcategory is empty', () => {
    const result = validateReviewSavePayload({
      userIdentity: identity,
      structuredUserInfo: {
        skills: ['JavaScript'],
        skillDomains: [],
        domains: [],
        keyResponsibilities: [],
        skillsInDevelopment: [],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors['structuredUserInfo.skillDomains']).toBeDefined();
  });

  test('flags key responsibility over 300 characters', () => {
    const result = validateReviewSavePayload({
      userIdentity: identity,
      structuredUserInfo: {
        ...fullStructured,
        keyResponsibilities: ['x'.repeat(301)],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors['structuredUserInfo.keyResponsibilities.0']).toBeDefined();
  });
});

describe('parseReviewSaveValidationErrors', () => {
  test('maps per-category required server message', () => {
    const parsed = parseReviewSaveValidationErrors([
      {
        path: 'structuredUserInfo.domains',
        msg: 'Domains requires at least one entry',
      },
    ]);
    expect(parsed.fieldErrors['structuredUserInfo.domains']).toBeDefined();
  });

  test('maps express-validator paths to field keys', () => {
    const parsed = parseReviewSaveValidationErrors([
      {
        path: 'userIdentity.workEnjoyMost',
        msg: 'Must be at most 2000 characters',
      },
      {
        path: 'structuredUserInfo.skills.1',
        msg: 'Skills item must be 1-100 characters',
      },
    ]);
    expect(parsed.fieldErrors['userIdentity.workEnjoyMost']).toBeDefined();
    expect(parsed.fieldErrors['structuredUserInfo.skills.1']).toBeDefined();
  });
});

describe('translateReviewFieldErrors', () => {
  test('translates category param via goodAtCategories keys', () => {
    const translated = translateReviewFieldErrors(
      {
        'structuredUserInfo.skills.0': {
          i18nKey: 'documentUpload.review.errors.structuredItemMaxLength',
          params: { category: 'skills', index: 1, max: 100, length: 150 },
        },
      },
      (key, params = {}) => `${key}:${params.category || ''}`
    );
    expect(translated['structuredUserInfo.skills.0']).toContain('skills');
  });
});
