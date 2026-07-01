const {
  detectPendingNarrativesFromProfile,
  resolveNarrativePendingFromProfileResponse,
} = require('../utils/profileNarrativePolling');

describe('profile narrative polling helpers', () => {
  it('detects missing who_are_you narratives when identity answers exist', () => {
    const pending = detectPendingNarrativesFromProfile({
      profile: {
        userIdentity: {
          workEnjoyMost: 'Building products',
        },
        who_are_you: {
          summary_text: JSON.stringify([
            'No personal profile information available yet.',
            'No personal profile information available yet.',
            'No personal profile information available yet.',
            'No personal profile information available yet.',
            'No personal profile information available yet.',
          ]),
        },
      },
    }, 'en');
    expect(pending).toEqual(['who_are_you']);
  });

  it('prefers API narrativePending from GET /api/profile', () => {
    expect(resolveNarrativePendingFromProfileResponse({
      narrativesReady: false,
      narrativePending: ['who_are_you'],
      profile: { userIdentity: {} },
    })).toEqual(['who_are_you']);
  });

  it('returns empty pending when narrativesReady is true and display narratives exist', () => {
    expect(resolveNarrativePendingFromProfileResponse({
      narrativesReady: true,
      narrativePending: ['who_are_you'],
      profile: {},
    })).toEqual([]);
  });

  it('detects missing narratives even when narrativesReady is true', () => {
    expect(resolveNarrativePendingFromProfileResponse({
      narrativesReady: true,
      profile: {
        userIdentity: {
          workEnjoyMost: 'Building products',
        },
        who_are_you: {
          summary_text: JSON.stringify([
            'No personal profile information available yet.',
            'No personal profile information available yet.',
            'No personal profile information available yet.',
            'No personal profile information available yet.',
            'No personal profile information available yet.',
          ]),
        },
      },
    }, 'en')).toEqual(['who_are_you']);
  });
});
