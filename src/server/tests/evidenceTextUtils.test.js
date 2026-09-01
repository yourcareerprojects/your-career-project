/**
 * Unit tests for evidence text helpers used before semantic matching.
 */

const {
  splitEvidenceChunks,
  isJunkEvidenceText,
  extractCvEvidenceTexts,
  narrativeItems,
} = require('../services/careerIdentity/evidenceTextUtils');

describe('evidenceTextUtils quality helpers', () => {
  it('splits concatenated German title-case phrases', () => {
    const chunks = splitEvidenceChunks(
      'Kreative Lösungen eigenständig entwickeln Abwechslungsreiche Aufgaben mit Konzentrationsphasen Teamorientierte Projekte'
    );
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.some((c) => /Teamorientierte/i.test(c))).toBe(true);
    expect(chunks.some((c) => /Kreative Lösungen/i.test(c))).toBe(true);
  });

  it('treats JSON and contact strings as junk', () => {
    expect(isJunkEvidenceText('{"personalInfo":{"email":"a@b.com"}}')).toBe(true);
    expect(isJunkEvidenceText('katrin.winter@email.at')).toBe(true);
    expect(isJunkEvidenceText('Teamorientierte Projekte mit kreativen Aufgaben')).toBe(false);
  });

  it('extracts readable CV text and skips personalInfo', () => {
    const texts = extractCvEvidenceTexts({
      name: 'CV.pdf',
      extractedProfileData: {
        personalInfo: {
          email: 'katrin.winter@email.at',
          phoneNumber: '+43 650 123 4567',
        },
        userIdentity: {
          workEnjoyMost: 'Helping patients recover in a team',
        },
        structuredUserInfo: {
          skills: ['patient care', 'teamwork'],
        },
      },
    });

    const joined = texts.join(' ').toLowerCase();
    expect(joined).toContain('helping patients');
    expect(joined).toContain('teamwork');
    expect(joined).not.toContain('katrin.winter@email.at');
    expect(joined).not.toContain('personalinfo');
  });

  it('picks a single localized role title instead of concatenating en+de', () => {
    const { localizedTitles } = require('../services/careerIdentity/evidenceTextUtils');
    const titles = localizedTitles({
      en: 'digital media designer',
      de: 'Digital Media Designer*in',
    });
    expect(titles.en).toBe('digital media designer');
    expect(titles.de).toBe('Digital Media Designer*in');
  });

  it('returns discrete narrative items from structured profile dimensions', () => {
    expect(
      narrativeItems({
        raw_items: ['teamwork', 'collaboration'],
        summary_text: 'works well with others',
      })
    ).toEqual(['teamwork', 'collaboration']);
  });

  it('detects overlapping narrative fragments already covered by reflections', () => {
    const {
      isTextCoveredByExisting,
    } = require('../services/careerIdentity/evidenceTextUtils');

    const reflections = [
      'Herausforderungen meistern und komplexe Probleme lösen',
      'Teamorientierte Projekte',
    ];
    expect(isTextCoveredByExisting('Herausforderungen', reflections)).toBe(true);
    expect(isTextCoveredByExisting('kreative Konzepte entwickeln', reflections)).toBe(false);
  });
});
