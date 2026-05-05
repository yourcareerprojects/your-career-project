const { detectCvDocumentLanguage } = require('../services/documents/detectCvDocumentLanguage');

describe('detectCvDocumentLanguage', () => {
  test('detects German from headings and vocabulary', () => {
    const text = `
      Lebenslauf
      Berufserfahrung bei einer Firma in München
      Ausbildung und Studium
      Sprachen: Deutsch und Englisch
    `;
    expect(detectCvDocumentLanguage(text)).toBe('de');
  });

  test('detects English as default for Latin CV without German cues', () => {
    const text = `
      Resume
      Professional Summary
      Work experience with stakeholders across North America
      Education and certifications
    `;
    expect(detectCvDocumentLanguage(text)).toBe('en');
  });

  test('detects English when common CV headings (qualifications, achievements) dominate', () => {
    const text = `
      John Smith
      Career overview
      Key achievements and qualifications in software delivery
      Employment history · Skills · References
    `;
    expect(detectCvDocumentLanguage(text)).toBe('en');
  });

  test('empty input defaults to English', () => {
    expect(detectCvDocumentLanguage('')).toBe('en');
    expect(detectCvDocumentLanguage('   ')).toBe('en');
  });
});
