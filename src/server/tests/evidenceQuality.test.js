/**
 * Unit tests for evidence match quality gates.
 */

const {
  hasLexicalTraitSupport,
  shouldAcceptTraitMatch,
  STRONG_MATCH_STRENGTH,
} = require('../services/careerIdentity/evidenceQuality');

describe('evidenceQuality', () => {
  it('detects lexical support from keywords and trait names', () => {
    expect(hasLexicalTraitSupport('I enjoy helping patients', 'helping_others')).toBe(true);
    expect(hasLexicalTraitSupport('Digitale Trends erkunden', 'sustainability_topics')).toBe(false);
    expect(hasLexicalTraitSupport('Teamorientierte Projekte', 'teamwork')).toBe(true);
  });

  it('rejects weak matches without lexical support', () => {
    expect(
      shouldAcceptTraitMatch(
        'Kreative Lösungen eigenständig entwickeln',
        'fast_paced_work',
        0.5
      )
    ).toBe(false);
  });

  it('accepts strong semantic matches even without keywords', () => {
    expect(
      shouldAcceptTraitMatch('completely unrelated phrasing', 'fast_paced_work', STRONG_MATCH_STRENGTH)
    ).toBe(true);
  });

  it('accepts moderate matches when keywords align', () => {
    expect(shouldAcceptTraitMatch('dynamic environment with rapid change', 'fast_paced_work', 0.5)).toBe(
      true
    );
  });
});
