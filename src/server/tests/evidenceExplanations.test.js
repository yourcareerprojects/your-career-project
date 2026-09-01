/**
 * Unit tests for evidence explanation copy.
 */

const {
  formatEvidenceExcerpt,
  pickRelevantExcerpt,
  explainReflectionEvidence,
  explainStructuredProfileEvidence,
  explainCvEvidence,
} = require('../services/careerIdentity/evidenceExplanations');

describe('evidenceExplanations', () => {
  it('truncates long excerpts at word boundaries', () => {
    const long =
      'I enjoy mentoring junior designers, running design critiques, and shaping visual systems for digital products across teams.';
    const excerpt = formatEvidenceExcerpt(long, 60);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(61);
  });

  it('prefers trait-relevant segments when picking excerpts', () => {
    const text =
      'Project management and budgeting. I love helping patients recover and supporting families through difficult moments.';
    const excerpt = pickRelevantExcerpt(text, 'helping_others');
    expect(excerpt.toLowerCase()).toContain('help');
  });

  it('does not quote unrelated openings or JSON blobs', () => {
    expect(
      pickRelevantExcerpt(
        'Kreative Lösungen eigenständig entwickeln Abwechslungsreiche Aufgaben',
        'fast_paced_work'
      )
    ).toBe('');
    expect(
      pickRelevantExcerpt('{"personalInfo":{"email":"katrin.winter@email.at"}}', 'fast_paced_work')
    ).toBe('');
  });

  it('uses a short quoted form for reflections', () => {
    const explanation = explainReflectionEvidence(
      'teamwork',
      {
        en: 'Reflection: what you enjoy most at work',
        de: 'Reflexion: was dir bei der Arbeit am meisten Freude macht',
      },
      'Lösungen im Team entwickeln'
    );
    expect(explanation.de).toBe('Dort schreibst du passend: „Lösungen im Team entwickeln“');
    expect(explanation.en).toBe('There you wrote fittingly: "Lösungen im Team entwickeln"');
  });

  it('uses a short quoted form for structured profile evidence', () => {
    const explanation = explainStructuredProfileEvidence(
      'creativity',
      { en: 'Skills in development', de: 'Fähigkeiten in Entwicklung' },
      'UX prototyping, visual storytelling, motion design'
    );
    expect(explanation.de).toMatch(/^Dort schreibst du passend: „/);
    expect(explanation.de).toMatch(/UX prototyping|visual storytelling/);
    expect(explanation.de).not.toContain('Kreativität');
    expect(explanation.de).not.toContain('Fähigkeiten in Entwicklung');
  });

  it('uses a short quoted form for CV evidence', () => {
    const explanation = explainCvEvidence(
      'customer_focus',
      'CV_Katrin-Winter_de_2026.pdf',
      'Vielfältige Kundenprojekte betreuen'
    );
    expect(explanation.de).toBe(
      'In deinem Lebenslauf schreibst du passend: „Vielfältige Kundenprojekte betreuen“'
    );
    expect(explanation.en).toBe(
      'In your CV you write fittingly: "Vielfältige Kundenprojekte betreuen"'
    );
    expect(explanation.de).not.toContain('CV_Katrin');
    expect(explanation.de).not.toContain('Kundenorientierung');
  });
});
