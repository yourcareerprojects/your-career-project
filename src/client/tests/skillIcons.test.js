const {
  resolveSkillIconCategory,
  getSkillIconColor,
  DEFAULT_SKILL_ICON_COLOR,
} = require('../constants/skillIconMatching');

describe('skillIcons', () => {
  it('resolves communication-related skills', () => {
    expect(resolveSkillIconCategory('public_speaking', 'Public Speaking')).toBe('communication');
    expect(resolveSkillIconCategory('negotiation', 'Negotiation')).toBe('communication');
  });

  it('resolves data and software skills', () => {
    expect(resolveSkillIconCategory('data_analysis', 'Data Analysis')).toBe('data');
    expect(resolveSkillIconCategory('computer_engineering', 'Computer Engineering')).toBe('software');
  });

  it('resolves health and construction skills', () => {
    expect(resolveSkillIconCategory('transfer_medical_information', 'Transfer Medical Information')).toBe('health');
    expect(resolveSkillIconCategory('construction_work', 'Construction Work')).toBe('construction');
  });

  it('falls back to default color for unknown skills', () => {
    expect(resolveSkillIconCategory('xyzzy_unknown', 'Xyzzy Unknown')).toBeNull();
    expect(getSkillIconColor(null)).toBe(DEFAULT_SKILL_ICON_COLOR);
  });

  it('matches localized German labels', () => {
    expect(resolveSkillIconCategory('projektmanagement', 'Projektmanagement')).toBe('leadership');
    expect(resolveSkillIconCategory('datenanalyse', 'Datenanalyse')).toBe('data');
  });

  it('matches common skill domain labels', () => {
    expect(resolveSkillIconCategory('collaboration_and_communication', 'Collaboration and Communication')).toBe('communication');
    expect(resolveSkillIconCategory('technical_proficiency', 'Technical Proficiency')).toBe('software');
    expect(resolveSkillIconCategory('problem_solving', 'Problem Solving')).toBe('engineering');
    expect(resolveSkillIconCategory('quality_assurance', 'Quality Assurance')).toBe('quality');
  });
});
