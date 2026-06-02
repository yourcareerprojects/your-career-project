const {
  normalizeSeniorityPayload,
  validateSeniorityPayload,
  seniorityPayloadsMatch,
} = require('../utils/validateSeniorityPayload');

describe('validateSeniorityPayload', () => {
  test('accepts complete seniority payload', () => {
    const result = validateSeniorityPayload({
      currentStatus: 'employed',
      yearsOfExperience: 5,
      highestDegree: 'bachelors',
      mostSeniorWorkExperience: 'mid_level',
    });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      currentStatus: 'employed',
      yearsOfExperience: 5,
      highestDegree: 'bachelors',
      mostSeniorWorkExperience: 'mid_level',
    });
  });

  test('rejects missing highest degree', () => {
    const result = validateSeniorityPayload({
      currentStatus: 'student',
      yearsOfExperience: 0,
      highestDegree: '',
      mostSeniorWorkExperience: 'intern',
    });
    expect(result).toEqual({ ok: false, field: 'highestDegree' });
  });

  test('normalizes null years to null', () => {
    const result = normalizeSeniorityPayload({
      currentStatus: 'pupil',
      yearsOfExperience: null,
      highestDegree: 'realschulabschluss',
      mostSeniorWorkExperience: 'intern',
    });
    expect(result.yearsOfExperience).toBeNull();
  });

  test('seniorityPayloadsMatch compares normalized values', () => {
    expect(seniorityPayloadsMatch(
      { currentStatus: 'employed', yearsOfExperience: 3, highestDegree: 'bachelors', mostSeniorWorkExperience: 'mid_level' },
      { currentStatus: 'employed', yearsOfExperience: 3, highestDegree: 'bachelors', mostSeniorWorkExperience: 'mid_level' },
    )).toBe(true);
    expect(seniorityPayloadsMatch(
      { currentStatus: 'employed', yearsOfExperience: 3, highestDegree: 'bachelors', mostSeniorWorkExperience: 'mid_level' },
      { currentStatus: 'employed', yearsOfExperience: null, highestDegree: 'bachelors', mostSeniorWorkExperience: 'mid_level' },
    )).toBe(false);
  });
});
