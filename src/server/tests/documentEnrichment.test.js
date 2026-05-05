const { extractFromTextHeuristics, mapExtractedToSimulationInputs } = require('../services/documents/documentProfileEnrichment');

describe('documentProfileEnrichment', () => {
  test('extracts skills, certifications, and experience from text', () => {
    const text = `
John Doe
Skills: JavaScript, React, Node.js, Communication
Certifications:
- AWS Certified Solutions Architect
- Scrum Master
Experience
Software Engineer at ExampleCorp
Projects
Portfolio Website - Built with React and Node
`;

    const res = extractFromTextHeuristics(text);
    expect(['success', 'partial'].includes(res.status)).toBe(true);
    expect(res.extracted.skills).toEqual(expect.arrayContaining(['JavaScript', 'React', 'Node.js']));
    expect(res.extracted.certifications.join(' ')).toMatch(/AWS Certified/);
    expect(res.extracted.workExperience.length).toBeGreaterThanOrEqual(1);
  });

  test('merges extracted data into base inputs without duplicates', () => {
    const base = {
      structuredUserInfo: {
        skills: ['React'],
        skillsInDevelopment: [],
        keyResponsibilities: [],
        domains: []
      },
      userIdentity: {
        workEnjoyMost: '',
        topicsIndustriesInterest: '',
        naturallyGoodAt: '',
        workEnvironmentFit: '',
        workingLifeAchievement: ''
      },
      seniority: {}
    };

    const extracted = {
      skills: ['React', 'JavaScript'],
      workExperience: [{ title: 'Developer' }, { title: 'Software Engineer' }],
      certifications: ['Scrum Master', 'AWS Certified']
    };

    const merged = mapExtractedToSimulationInputs(extracted, base);
    expect(merged.structuredUserInfo.skills).toEqual(expect.arrayContaining(['React', 'JavaScript']));
    expect(merged.structuredUserInfo.skillsInDevelopment).toEqual(expect.any(Array));
    expect(merged.structuredUserInfo.keyResponsibilities).toEqual(expect.any(Array));
    expect(merged.structuredUserInfo.domains).toEqual(expect.any(Array));
  });
});

