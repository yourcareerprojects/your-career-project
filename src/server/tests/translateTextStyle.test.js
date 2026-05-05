const { __testables } = require('../services/ai/translateText');

describe('translateText German style guardrails', () => {
  test('adds inclusive, non-formal, and simple-language instructions for German', () => {
    const prompt = __testables.buildTranslatorSystemPrompt('de');
    expect(prompt).toContain('gender-inclusive wording');
    expect(prompt).toContain('"Sie", "Ihnen", "Ihr"');
    expect(prompt).toContain('"*in"');
    expect(prompt).toContain('plain and easy German');
  });

  test('does not add German-specific style instructions for English', () => {
    const prompt = __testables.buildTranslatorSystemPrompt('en');
    expect(prompt).not.toContain('German style rules');
    expect(prompt).not.toContain('"Sie", "Ihnen", "Ihr"');
    expect(prompt).not.toContain('"*in"');
  });

  test('appends custom style hints when provided', () => {
    const hint = 'Use simple short sentences.';
    const prompt = __testables.buildTranslatorSystemPrompt('de', hint);
    expect(prompt).toContain('German style rules');
    expect(prompt).toContain(hint);
  });
});
