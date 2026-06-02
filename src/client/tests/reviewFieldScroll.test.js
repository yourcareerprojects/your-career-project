const {
  buildReviewFieldScrollQueue,
  firstEmptyUserIdentityFieldKey,
  firstEmptyFollowUpFieldKey,
  seniorityReviewFieldKey,
  REVIEW_FIELD_ATTR,
  reviewFieldAnchorProps,
} = require('../utils/reviewFieldScroll');

describe('reviewFieldScroll helpers', () => {
  test('buildReviewFieldScrollQueue puts firstField first', () => {
    expect(
      buildReviewFieldScrollQueue('structuredUserInfo.skills', {
        'structuredUserInfo.domains': {},
        'structuredUserInfo.skills': {},
      })
    ).toEqual(['structuredUserInfo.skills', 'structuredUserInfo.domains']);
  });

  test('firstEmptyUserIdentityFieldKey returns first blank identity path', () => {
    const key = firstEmptyUserIdentityFieldKey(
      { workEnjoyMost: 'yes', topicsIndustriesInterest: '' },
      [{ key: 'workEnjoyMost' }, { key: 'topicsIndustriesInterest' }]
    );
    expect(key).toBe('userIdentity.topicsIndustriesInterest');
  });

  test('firstEmptyFollowUpFieldKey returns first unanswered follow-up field', () => {
    const key = firstEmptyFollowUpFieldKey(
      [{ field: 'userIdentity.workEnjoyMost' }, { field: 'structuredUserInfo.skills' }],
      { 'userIdentity.workEnjoyMost': 'filled' }
    );
    expect(key).toBe('structuredUserInfo.skills');
  });

  test('seniorityReviewFieldKey prefixes seniority path', () => {
    expect(seniorityReviewFieldKey('highestDegree')).toBe('seniority.highestDegree');
  });

  test('reviewFieldAnchorProps sets data attribute', () => {
    expect(reviewFieldAnchorProps('userIdentity.workEnjoyMost')).toEqual({
      [REVIEW_FIELD_ATTR]: 'userIdentity.workEnjoyMost',
    });
  });
});
