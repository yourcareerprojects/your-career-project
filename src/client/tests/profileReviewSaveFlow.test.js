jest.mock('../hooks/useProfileQueries', () => ({
  getProfileFullQueryKeyFull: (lang) => ['profile', 'full', lang],
  invalidateProfileCompletionQuery: jest.fn(),
  invalidateFullProfileQuery: jest.fn(() => Promise.resolve()),
  fetchFullProfile: jest.fn(),
}));

jest.mock('../queryClient', () => ({
  queryClient: {
    getQueryData: jest.fn(() => undefined),
    setQueryData: jest.fn(),
  },
}));

const { queryClient } = require('../queryClient');
const { invalidateFullProfileQuery } = require('../hooks/useProfileQueries');
const {
  saveExtractedProfileReview,
  buildReviewSaveUserMessage,
  isReviewUserIdentityComplete,
  ProfileReviewSaveError,
} = require('../utils/profileReviewSaveFlow');

const validSeniority = {
  currentStatus: 'employed',
  yearsOfExperience: 5,
  highestDegree: 'bachelors',
  mostSeniorWorkExperience: 'mid_level',
};

const validIdentity = {
  workEnjoyMost: 'Building products',
  topicsIndustriesInterest: 'Healthcare',
  naturallyGoodAt: 'Communication',
  workEnvironmentFit: 'Collaborative teams',
  workingLifeAchievement: 'Shipped a major release',
};

function buildProfilePayload(overrides = {}) {
  return {
    structuredUserInfo: {
      skills: ['JavaScript'],
      skillDomains: ['Software engineering'],
      domains: ['Technology'],
      keyResponsibilities: ['Ship features'],
      skillsInDevelopment: ['Leadership'],
    },
    userIdentity: { ...validIdentity },
    seniority: { ...validSeniority },
    __reviewOptions: { mode: 'merge' },
    ...overrides,
  };
}

function mockFetchOk(body = { success: true, seniority: validSeniority }) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

describe('isReviewUserIdentityComplete', () => {
  test('returns false when any identity field is blank', () => {
    expect(isReviewUserIdentityComplete(validIdentity)).toBe(true);
    expect(isReviewUserIdentityComplete({ ...validIdentity, workEnjoyMost: '  ' })).toBe(false);
    expect(isReviewUserIdentityComplete({})).toBe(false);
  });
});

describe('saveExtractedProfileReview', () => {
  test('resolves on successful save when narratives are ready', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          ready: true,
          fingerprintMatches: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          seniority: validSeniority,
          narrativesReady: true,
          usedNarrativeCacheFastPath: true,
          who_are_you: { raw_answers: [], summary_text: '' },
          structuredUserInfo: {},
          documents: [{ id: 'doc-1', name: 'resume.pdf', type: 'resume' }],
        }),
      });
    const result = await saveExtractedProfileReview({
      profileData: buildProfilePayload({ documentId: 'doc-1' }),
      refreshUser: async () => ({ success: true }),
      fetchImpl,
      getAuthToken: () => 'token-1',
      langQuery: 'lang=en',
      prefetchProfile: false,
    });

    expect(result.reviewSaveData.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain('/narrative-cache-status');
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/profile/review-save?lang=en');
    expect(invalidateFullProfileQuery).not.toHaveBeenCalled();
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      ['profile', 'full', 'en'],
      expect.objectContaining({
        _seededFromReviewSave: true,
        profile: expect.objectContaining({
          documents: [{ id: 'doc-1', name: 'resume.pdf', type: 'resume' }],
        }),
      })
    );
  });

  test('proceeds to review-save when narrative cache warm times out', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, ready: false, reason: 'warming' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          seniority: validSeniority,
          narrativesReady: true,
          usedNarrativeCacheFastPath: false,
          who_are_you: { raw_answers: [], summary_text: '' },
          structuredUserInfo: {},
          documents: [],
        }),
      });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await saveExtractedProfileReview({
      profileData: buildProfilePayload({ documentId: 'doc-1' }),
      refreshUser: async () => ({ success: true }),
      fetchImpl,
      getAuthToken: () => 'token-1',
      langQuery: 'lang=en',
      documentCacheWarmTimeoutMs: 0,
    });

    expect(result.reviewSaveData.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain('/review-narrative-cache');
    expect(fetchImpl.mock.calls[1][0]).toContain('/review-save');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('document narrative cache not ready before save')
    );
    warnSpy.mockRestore();
  });

  test('rejects on seniority validation failure without calling API', async () => {
    const fetchImpl = mockFetchOk();

    await expect(
      saveExtractedProfileReview({
        profileData: buildProfilePayload({ seniority: { ...validSeniority, currentStatus: '' } }),
        refreshUser: async () => ({ success: true }),
        fetchImpl,
        langQuery: 'lang=en',
        translate: (key) => key,
      })
    ).rejects.toBeInstanceOf(ProfileReviewSaveError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects on session refresh failure without calling API', async () => {
    const fetchImpl = mockFetchOk();

    await expect(
      saveExtractedProfileReview({
        profileData: buildProfilePayload(),
        refreshUser: async () => ({ success: false, skipped: false }),
        fetchImpl,
        langQuery: 'lang=en',
        translate: (key) => key,
      })
    ).rejects.toMatchObject({
      userMessage: 'profileCreation.errors.sessionExpired',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects on identity validation failure without calling API', async () => {
    const fetchImpl = mockFetchOk();

    await expect(
      saveExtractedProfileReview({
        profileData: buildProfilePayload({
          userIdentity: { ...validIdentity, workEnjoyMost: '  ' },
        }),
        refreshUser: async () => ({ success: true }),
        fetchImpl,
        langQuery: 'lang=en',
        translate: (key) => key,
      })
    ).rejects.toMatchObject({
      userMessage: 'documentUpload.review.errors.fixHighlightedFields',
      fieldErrors: expect.objectContaining({
        'userIdentity.workEnjoyMost': expect.any(String),
      }),
      focusStep: 2,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects on empty structured subcategory without calling API', async () => {
    const fetchImpl = mockFetchOk();

    await expect(
      saveExtractedProfileReview({
        profileData: buildProfilePayload({
          structuredUserInfo: {
            skills: ['JavaScript'],
            skillDomains: [],
            domains: [],
            keyResponsibilities: [],
            skillsInDevelopment: [],
          },
        }),
        refreshUser: async () => ({ success: true }),
        fetchImpl,
        langQuery: 'lang=en',
        translate: (key) => key,
      })
    ).rejects.toMatchObject({
      name: 'ProfileReviewSaveError',
      userMessage: 'documentUpload.review.errors.fixHighlightedFields',
      fieldErrors: expect.objectContaining({
        'structuredUserInfo.skillDomains': expect.any(String),
      }),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects on client length validation without calling API', async () => {
    const fetchImpl = mockFetchOk();
    const long = 'x'.repeat(2001);

    await expect(
      saveExtractedProfileReview({
        profileData: buildProfilePayload({
          userIdentity: { ...validIdentity, workEnjoyMost: long },
        }),
        refreshUser: async () => ({ success: true }),
        fetchImpl,
        langQuery: 'lang=en',
        translate: (key) => key,
      })
    ).rejects.toMatchObject({
      name: 'ProfileReviewSaveError',
      fieldErrors: expect.objectContaining({
        'userIdentity.workEnjoyMost': expect.any(String),
      }),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects on API validation errors with fieldErrors', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        message: 'Validation failed',
        errors: [
          {
            path: 'structuredUserInfo.skills.0',
            msg: 'Skills item must be 1-100 characters',
          },
        ],
      }),
    });

    await expect(
      saveExtractedProfileReview({
        profileData: buildProfilePayload(),
        refreshUser: async () => ({ success: true }),
        fetchImpl,
        getAuthToken: () => 'token-1',
        langQuery: 'lang=en',
        translate: (key) => key,
      })
    ).rejects.toMatchObject({
      name: 'ProfileReviewSaveError',
      fieldErrors: expect.objectContaining({
        'structuredUserInfo.skills.0': expect.any(String),
      }),
    });
  });

  test('rejects on API failure', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Invalid profile payload' }),
    });

    await expect(
      saveExtractedProfileReview({
        profileData: buildProfilePayload(),
        refreshUser: async () => ({ success: true }),
        fetchImpl,
        getAuthToken: () => 'token-1',
        langQuery: 'lang=en',
      })
    ).rejects.toThrow('Invalid profile payload');
  });

  test('rejects when persisted seniority does not match request', async () => {
    const fetchImpl = mockFetchOk({
      success: true,
      seniority: { ...validSeniority, highestDegree: 'masters' },
    });

    await expect(
      saveExtractedProfileReview({
        profileData: buildProfilePayload(),
        refreshUser: async () => ({ success: true }),
        fetchImpl,
        getAuthToken: () => 'token-1',
        langQuery: 'lang=en',
      })
    ).rejects.toThrow('Seniority fields were not persisted correctly');
  });
});

describe('buildReviewSaveUserMessage', () => {
  test('returns validation message without saveFailed prefix', () => {
    const err = new ProfileReviewSaveError('Identity validation failed', {
      userMessage: 'Please complete identity questions',
    });
    expect(buildReviewSaveUserMessage(err, (key) => key)).toBe('Please complete identity questions');
  });

  test('prefixes generic API errors with saveFailed translation', () => {
    const message = buildReviewSaveUserMessage(new Error('Server unavailable'), (key) => {
      if (key === 'profileCreation.errors.saveFailed') return 'Save failed.';
      return key;
    });
    expect(message).toBe('Save failed. Server unavailable');
  });
});

/** Mirrors DocumentUploadForm.handleReviewSave post-callback behavior. */
describe('review dialog stays open when parent save rejects', () => {
  async function simulateReviewSave(onExtractedProfileReview) {
    let dialogOpen = true;
    try {
      await onExtractedProfileReview(buildProfilePayload());
      dialogOpen = false;
    } catch (_) {
      /* keep dialog open */
    }
    return dialogOpen;
  }

  test('dialog closes only after successful parent save', async () => {
    const openAfterSuccess = await simulateReviewSave(async () => undefined);
    expect(openAfterSuccess).toBe(false);
  });

  test('dialog stays open when parent save rejects', async () => {
    const openAfterFailure = await simulateReviewSave(async () => {
      throw new ProfileReviewSaveError('Identity validation failed', {
        userMessage: 'profileCreation.errors.identityQuestionsRequired',
      });
    });
    expect(openAfterFailure).toBe(true);
  });
});
