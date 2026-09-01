const { redactCvContactPii, PLACEHOLDER } = require('../services/cv/redactCvContactPii');
const { extractProfileDataFromDocumentTextHeuristic } = require('../services/cv/cvHeuristicExtract');

describe('redactCvContactPii', () => {
  test('replaces email, phone, address, and profile URLs with placeholders', () => {
    const cv = `
Jane Doe
jane.doe@example.com
+49 176 12345678
Address: Musterstraße 12, 10115 Berlin
https://www.linkedin.com/in/jane-doe
Software Engineer at Acme Corp
2019 - 2023
`;
    const redacted = redactCvContactPii(cv);
    expect(redacted).not.toContain('jane.doe@example.com');
    expect(redacted).not.toContain('176 12345678');
    expect(redacted).not.toContain('Musterstraße 12');
    expect(redacted).not.toContain('linkedin.com/in/jane-doe');
    expect(redacted).toContain(PLACEHOLDER.EMAIL);
    expect(redacted).toContain(PLACEHOLDER.PHONE);
    expect(redacted).toContain(PLACEHOLDER.ADDRESS);
    expect(redacted).toContain(PLACEHOLDER.URL);
    expect(redacted).toContain('Jane Doe');
    expect(redacted).toContain('Software Engineer at Acme Corp');
    expect(redacted).toContain('2019 - 2023');
  });

  test('redacts English street and US city/state/ZIP without removing job location country', () => {
    const redacted = redactCvContactPii(
      'Lived at 123 Main Street, Springfield, IL 62704\nWorked in Berlin, Germany'
    );
    expect(redacted).not.toContain('123 Main Street');
    expect(redacted).not.toContain('Springfield, IL 62704');
    expect(redacted).toContain(PLACEHOLDER.ADDRESS);
    expect(redacted).toContain('Berlin, Germany');
  });

  test('redacts labeled phones and compact German mobiles', () => {
    const redacted = redactCvContactPii('Phone: 030 12345678\nMobil: 01761234567');
    expect(redacted).not.toMatch(/030 12345678/);
    expect(redacted).not.toContain('01761234567');
    expect(redacted).toContain(`Phone: ${PLACEHOLDER.PHONE}`);
    expect(redacted).toContain(PLACEHOLDER.PHONE);
  });

  test('does not redact employment years or skill names', () => {
    const cv = 'React, Node.js\nProduct Manager at ExampleCorp\nJan 2019 - Dec 2023\nTeam of 12';
    const redacted = redactCvContactPii(cv);
    expect(redacted).toContain('React, Node.js');
    expect(redacted).toContain('Product Manager at ExampleCorp');
    expect(redacted).toContain('Jan 2019');
    expect(redacted).toContain('Dec 2023');
    expect(redacted).toContain('Team of 12');
    expect(redacted).not.toContain(PLACEHOLDER.PHONE);
  });

  test('returns empty or whitespace-only input unchanged', () => {
    expect(redactCvContactPii('')).toBe('');
    expect(redactCvContactPii('   ')).toBe('   ');
  });
});

describe('CV contact PII stays available for local heuristics', () => {
  test('heuristics still extract email and phone from the original text', () => {
    const cv = `
Jane Doe
jane.doe@example.com
+49 176 12345678
Software Engineer at Acme Corp
`;
    const heuristic = extractProfileDataFromDocumentTextHeuristic(cv);
    expect(heuristic.profile.personalInfo.email).toBe('jane.doe@example.com');
    expect(heuristic.profile.personalInfo.phoneNumber).toMatch(/176/);
    expect(heuristic.profile.name).toMatch(/Jane Doe/i);

    const redacted = redactCvContactPii(cv);
    expect(redacted).not.toContain('jane.doe@example.com');
    expect(redacted).toContain(PLACEHOLDER.EMAIL);
  });
});
