const {
  extractFromTextHeuristics,
  mapExtractedToSimulationInputs,
  extractEducationInstitutionsFromText,
  extractWorkExperienceDescriptionLinesFromText,
} = require('../services/documents/documentProfileEnrichment');

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
    expect(merged.structuredUserInfo.skills).toEqual(['React', 'JavaScript']);
    expect(merged.structuredUserInfo.skillsInDevelopment).toEqual(expect.any(Array));
    expect(merged.structuredUserInfo.keyResponsibilities).toEqual(expect.any(Array));
    expect(merged.structuredUserInfo.domains).toEqual(expect.any(Array));
  });

  test('preserves narrative-shaped domains when merging extracted skills', () => {
    const base = {
      structuredUserInfo: {
        skills: { raw_items: ['React'], summary_text: 'React skills' },
        domains: { raw_items: ['Tech', 'Education'], summary_text: 'Tech and education' },
        skillDomains: { raw_items: ['Marketing'], summary_text: 'Marketing' },
      },
    };

    const merged = mapExtractedToSimulationInputs({ skills: ['JavaScript'] }, base);

    expect(merged.structuredUserInfo.domains).toEqual({
      raw_items: ['Tech', 'Education'],
      summary_text: 'Tech and education',
    });
    expect(merged.structuredUserInfo.skillDomains).toEqual({
      raw_items: ['Marketing'],
      summary_text: 'Marketing',
    });
    expect(merged.structuredUserInfo.skills).toEqual({
      raw_items: ['React', 'JavaScript'],
      summary_text: 'React skills',
    });
  });

  test('merges extracted skills into bilingual narrative without corrupting summary_text', () => {
    const summaryField = {
      original_language: 'en',
      original: 'React skills',
      translations: { en: 'React skills', de: 'React-Fähigkeiten' },
    };
    const base = {
      structuredUserInfo: {
        skills: {
          raw_items: ['React'],
          summary_text: summaryField,
        },
      },
    };

    const merged = mapExtractedToSimulationInputs({ skills: ['JavaScript', 'React'] }, base);

    expect(merged.structuredUserInfo.skills.raw_items).toEqual(['React', 'JavaScript']);
    expect(merged.structuredUserInfo.skills.summary_text).toEqual(summaryField);
  });

  test('does not treat every CV line as a skill when no Skills section exists', () => {
    const text = `
John Smith
Product Manager
john@example.com

Summary
Experienced product manager with strong leadership skills.

Work Experience
Senior PM at Acme Corp
2019 - Present
Led cross-functional teams

Education
MBA, Harvard Business School
`;
    const res = extractFromTextHeuristics(text);
    expect(res.extracted.skills).toEqual([]);
  });

  test('does not treat "soft skills" in prose as a Skills section header', () => {
    const text = `
John Smith
Summary
Experienced leader with soft skills in negotiation and communication.

Work Experience
Senior PM at Acme Corp
`;
    const res = extractFromTextHeuristics(text);
    expect(res.extracted.skills).toEqual([]);
  });

  test('extractEducationInstitutionsFromText returns unique institutions', () => {
    const text = `
Education
MBA, Harvard Business School
BSc, MIT University
Experience
Developer
`;
    const entries = extractEducationInstitutionsFromText(text, { maxEntries: 5, maxSectionLen: 500 });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]).toHaveProperty('institution');
  });

  test('extractWorkExperienceDescriptionLinesFromText captures long lines without title pattern', () => {
    const text = `
Experience
Led platform modernization across three product teams over eighteen months
Managed vendor relationships and budget planning for engineering org
Education
State University
`;
    const lines = extractWorkExperienceDescriptionLinesFromText(text, { maxLines: 4, maxSectionLen: 1000 });
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toMatch(/platform modernization/i);
  });

  test('extracts skills only from an explicit Skills section header', () => {
    const text = `
John Smith
Skills: JavaScript, React, Node.js
Experience
Software Engineer at ExampleCorp
`;
    const res = extractFromTextHeuristics(text);
    expect(res.extracted.skills).toEqual(expect.arrayContaining(['JavaScript', 'React', 'Node.js']));
  });
});

