const { inferCurrentEmploymentStatusFromText, sanitizeCurrentEmploymentStatus } = require('../../constants/currentEmploymentStatus');
const { inferHighestDegreeFromText } = require('../../constants/highestDegree');
const {
  inferMostSeniorRoleFromText,
  inferMostSeniorFromJobTitles,
} = require('../../constants/senioritySelectOptions');

describe('inferCurrentEmploymentStatusFromText', () => {
  test('passes through canonical slugs', () => {
    expect(sanitizeCurrentEmploymentStatus('student')).toBe('student');
    expect(inferCurrentEmploymentStatusFromText('student')).toBe('student');
  });

  test('maps German education and training wording', () => {
    expect(inferCurrentEmploymentStatusFromText('Schülerin an der Realschule')).toBe('pupil');
    expect(inferCurrentEmploymentStatusFromText('Werkstudent im Marketing')).toBe('student');
    expect(inferCurrentEmploymentStatusFromText('Praktikum bei ACME')).toBe('intern');
  });

  test('defaults to employed only when work experience flag is set and no other signal', () => {
    expect(inferCurrentEmploymentStatusFromText('Software Engineer at ACME', { hasWorkExperience: true })).toBe('employed');
    expect(inferCurrentEmploymentStatusFromText('', { hasWorkExperience: false })).toBe('');
  });
});

describe('inferHighestDegreeFromText', () => {
  test('passes through canonical slugs', () => {
    expect(inferHighestDegreeFromText('masters')).toBe('masters');
    expect(inferHighestDegreeFromText('bachelors')).toBe('bachelors');
  });

  test('maps Abitur without matching fachabitur', () => {
    expect(inferHighestDegreeFromText('Abitur 2018')).toBe('high_school');
    expect(inferHighestDegreeFromText('Fachabitur')).toBe('fachabitur');
  });
});

describe('inferMostSeniorRoleFromText', () => {
  test('treats IC manager titles as mid_level', () => {
    expect(inferMostSeniorRoleFromText('Product Manager')).toBe('mid_level');
    expect(inferMostSeniorRoleFromText('Project Manager')).toBe('mid_level');
  });

  test('keeps people/org management as manager', () => {
    expect(inferMostSeniorRoleFromText('Engineering Manager')).toBe('manager');
    expect(inferMostSeniorRoleFromText('Head of Sales')).toBe('manager');
  });

  test('maps Director of Product via director-of pattern', () => {
    expect(inferMostSeniorRoleFromText('Director of Product')).toBe('director');
  });

  test('picks peak across job titles', () => {
    expect(
      inferMostSeniorFromJobTitles(['Intern', 'Junior Developer', 'Product Manager'])
    ).toBe('mid_level');
    expect(
      inferMostSeniorFromJobTitles(['Intern', 'Engineering Manager'])
    ).toBe('manager');
  });
});
