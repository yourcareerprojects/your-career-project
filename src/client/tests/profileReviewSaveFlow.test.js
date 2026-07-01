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
  warmReviewNarrativeCacheForStep,
  buildReviewSaveUserMessage,
  isReviewUserIdentityComplete,
  ProfileReviewSaveError,
  flushNarrativeWarmRegistryForTests,
  computeNarrativeWarmProgressEstimate,
} = require('../utils/profileReviewSaveFlow');

afterEach(async () => {
  await flushNarrativeWarmRegistryForTests();
});

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
    const fetchImpl = jest.fn().mockResolvedValueOnce({
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/profile/review-save?lang=en');
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

  test('save joins completed wizard warm without blocking on narrative cache', async () => {
    let warmPutCount = 0;
    let statusChecks = 0;
    const fetchImpl = jest.fn((url) => {
      if (String(url).includes('/review-narrative-cache')) {
        warmPutCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, ready: true, updated: true }),
        });
      }
      if (String(url).includes('/review-save')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            seniority: validSeniority,
            usedNarrativeCacheFastPath: true,
            who_are_you: { raw_answers: [], summary_text: '' },
            structuredUserInfo: {},
            documents: [],
          }),
        });
      }
      statusChecks += 1;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          ready: warmPutCount > 0,
          fingerprintMatches: warmPutCount > 0,
        }),
      });
    });

    const payload = buildProfilePayload({ documentId: 'doc-1' });
    await warmReviewNarrativeCacheForStep({
      documentId: 'doc-1',
      reviewProfile: {
        userIdentity: payload.userIdentity,
        structuredUserInfo: payload.structuredUserInfo,
      },
      acceptedFields: {},
      step: 4,
      langQuery: 'lang=en',
      fetchImpl,
      getAuthToken: () => 'token-1',
      awaitReady: true,
    });
    expect(warmPutCount).toBe(1);

    await saveExtractedProfileReview({
      profileData: payload,
      fetchImpl,
      getAuthToken: () => 'token-1',
      langQuery: 'lang=en',
      documentCacheWarmTimeoutMs: 0,
    });
    expect(warmPutCount).toBe(1);
    expect(fetchImpl.mock.calls.filter((call) => String(call[0]).includes('/review-save'))).toHaveLength(1);
  });

  test('proceeds directly to review-save without pre-save narrative warm', async () => {
    const fetchImpl = jest.fn((url) => {
      if (String(url).includes('/review-save')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            seniority: validSeniority,
            narrativesReady: false,
            narrativePending: ['who_are_you'],
            usedNarrativeCacheFastPath: false,
            who_are_you: { raw_answers: [], summary_text: '' },
            structuredUserInfo: {},
            documents: [],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, ready: false, fingerprintMatches: false }),
      });
    });

    const result = await saveExtractedProfileReview({
      profileData: buildProfilePayload({ documentId: 'doc-1' }),
      refreshUser: async () => ({ success: true }),
      fetchImpl,
      getAuthToken: () => 'token-1',
      langQuery: 'lang=en',
      documentCacheWarmTimeoutMs: 0,
    });

    expect(result.reviewSaveData.success).toBe(true);
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('/review-save'))).toBe(true);
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('/review-narrative-cache'))).toBe(false);
  });

  test('does not pre-check document narrative cache before review-save', async () => {
    const fetchImpl = jest.fn((url) => {
      if (String(url).includes('/review-save')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            seniority: validSeniority,
            who_are_you: { raw_answers: [], summary_text: '' },
            structuredUserInfo: {},
            documents: [],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, ready: true, fingerprintMatches: false }),
      });
    });

    await saveExtractedProfileReview({
      profileData: buildProfilePayload({ documentId: 'doc-1' }),
      refreshUser: async () => ({ success: true }),
      fetchImpl,
      getAuthToken: () => 'token-1',
      langQuery: 'lang=en',
      documentCacheWarmTimeoutMs: 15000,
    });

    const statusCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes('/narrative-cache-status'));
    expect(statusCalls.length).toBe(0);
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('/review-save'))).toBe(true);
  });

  test('seeds structured lists from review snapshot when server response omits raw_items', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          seniority: validSeniority,
          structuredUserInfo: {
            skills: { summary_text: 'Polished skills summary' },
          },
          who_are_you: { raw_answers: [], summary_text: '' },
          documents: [],
        }),
      });

    await saveExtractedProfileReview({
      profileData: buildProfilePayload({
        structuredUserInfo: {
          skills: ['TypeScript', 'React'],
          skillDomains: ['Software engineering'],
          domains: ['Technology'],
          keyResponsibilities: ['Ship features'],
          skillsInDevelopment: ['Leadership'],
        },
      }),
      refreshUser: async () => ({ success: true }),
      fetchImpl,
      getAuthToken: () => 'token-1',
      langQuery: 'lang=en',
    });

    const seeded = queryClient.setQueryData.mock.calls.at(-1)?.[1];
    expect(seeded.profile.structuredUserInfo.skills.raw_items).toEqual(['TypeScript', 'React']);
    expect(seeded.profile.structuredUserInfo.skillDomains.raw_items).toEqual(['Software engineering']);
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

describe('computeNarrativeWarmProgressEstimate', () => {
  test('returns 100 when cache is ready and fingerprint matches', () => {
    expect(
      computeNarrativeWarmProgressEstimate({
        ready: true,
        fingerprintMatches: true,
      })
    ).toBe(100);
  });

  test('uses pending dimensions for server-side progress when partial cache exists', () => {
    expect(
      computeNarrativeWarmProgressEstimate({
        ready: false,
        pending: ['structuredUserInfo.skills', 'who_are_you'],
      })
    ).toBe(61);
  });

  test('ramps linearly over expected warm duration when only coarse pending is available', () => {
    expect(
      computeNarrativeWarmProgressEstimate(
        { ready: false, pending: ['narrativeEnrichment'], inFlight: true },
        0
      )
    ).toBe(8);
    expect(
      computeNarrativeWarmProgressEstimate(
        { ready: false, pending: ['narrativeEnrichment'], inFlight: true },
        15000
      )
    ).toBe(49);
  });
});

describe('warmReviewNarrativeCacheForStep', () => {
  test('awaitReady returns immediately when cache status is already ready', async () => {
    const fetchImpl = jest.fn((url) => {
      if (String(url).includes('/narrative-cache-status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, ready: true, fingerprintMatches: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, ready: true }),
      });
    });

    await warmReviewNarrativeCacheForStep({
      documentId: 'doc-1',
      reviewProfile: {
        userIdentity: validIdentity,
        structuredUserInfo: { skills: ['JavaScript'] },
      },
      acceptedFields: {},
      step: 4,
      langQuery: 'lang=en',
      fetchImpl,
      getAuthToken: () => 'token-1',
      awaitReady: true,
    });

    const warmCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes('/review-narrative-cache'));
    expect(warmCalls.length).toBe(0);
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('/narrative-cache-status'))).toBe(true);
  });

  test('background warm PUTs and completes when cache becomes ready', async () => {
    let statusChecks = 0;
    const fetchImpl = jest.fn((url) => {
      if (String(url).includes('/narrative-cache-status')) {
        statusChecks += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            ready: statusChecks >= 2,
            fingerprintMatches: statusChecks >= 2,
          }),
        });
      }
      if (String(url).includes('/review-narrative-cache')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, reason: 'warming' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await warmReviewNarrativeCacheForStep({
      documentId: 'doc-1',
      reviewProfile: {
        userIdentity: validIdentity,
        structuredUserInfo: { skills: ['JavaScript'] },
      },
      acceptedFields: {},
      step: 4,
      langQuery: 'lang=en',
      fetchImpl,
      getAuthToken: () => 'token-1',
      awaitReady: false,
    });
    await flushNarrativeWarmRegistryForTests();

    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('/review-narrative-cache'))).toBe(true);
    expect(statusChecks).toBeGreaterThanOrEqual(2);
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
